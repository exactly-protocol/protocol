import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import {
  errorGeneric,
  applyMinFee,
  ExaTime,
  ProtocolError,
} from "./exactlyUtils";
import { parseUnits } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DefaultEnv } from "./defaultEnv";

describe("FixedLender", function () {
  let exactlyEnv: DefaultEnv;

  let underlyingToken: Contract;
  let underlyingTokenETH: Contract;
  let fixedLender: Contract;
  let poolAccounting: Contract;

  let mariaUser: SignerWithAddress;
  let johnUser: SignerWithAddress;
  let owner: SignerWithAddress;
  const exaTime: ExaTime = new ExaTime();
  const nextPoolId: number = exaTime.nextPoolID();
  const laterPoolId: number = nextPoolId + exaTime.INTERVAL;
  const penaltyRate = "0.0000002315"; // Penalty Rate per second (86400 is ~= 2%)

  let snapshot: any;
  beforeEach(async () => {
    snapshot = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    [owner, mariaUser, johnUser] = await ethers.getSigners();

    exactlyEnv = await DefaultEnv.create({});

    underlyingToken = exactlyEnv.getUnderlying("DAI");
    underlyingTokenETH = exactlyEnv.getUnderlying("WETH");
    fixedLender = exactlyEnv.getFixedLender("DAI");
    poolAccounting = exactlyEnv.getPoolAccounting("DAI");

    // From Owner to User
    await underlyingToken.transfer(mariaUser.address, parseUnits("100000"));
    await underlyingTokenETH.transfer(mariaUser.address, parseUnits("100000"));
    await underlyingToken.transfer(johnUser.address, parseUnits("100000"));

    await exactlyEnv
      .getInterestRateModel()
      .setPenaltyRate(parseUnits(penaltyRate));
    exactlyEnv.switchWallet(mariaUser);
  });
  describe("small positions", () => {
    describe("WHEN depositing 2wei of a dai", () => {
      beforeEach(async () => {
        await exactlyEnv
          .getUnderlying("DAI")
          .connect(mariaUser)
          .approve(fixedLender.address, "10000");
        await exactlyEnv
          .getFixedLender("DAI")
          .connect(mariaUser)
          .depositToSmartPool("2");
        // we add liquidity to the maturity
        await exactlyEnv
          .getFixedLender("DAI")
          .connect(mariaUser)
          .depositToMaturityPool("2", nextPoolId, "0");
      });
      it("THEN the FixedLender registers a supply of 2 wei DAI for the user (exposed via getAccountSnapshot)", async () => {
        expect(
          (
            await fixedLender.getAccountSnapshot(mariaUser.address, nextPoolId)
          )[0]
        ).to.be.equal("2");
      });
      it("AND the Market Size of the smart pool is 2 wei of a dai", async () => {
        expect(await fixedLender.getSmartPoolDeposits()).to.be.equal("2");
      });
      it("AND its not possible to borrow 2 wei of a dai", async () => {
        await expect(
          exactlyEnv
            .getFixedLender("DAI")
            .connect(mariaUser)
            .borrowFromMaturityPool("2", nextPoolId, "2")
        ).to.be.revertedWith(
          errorGeneric(ProtocolError.INSUFFICIENT_LIQUIDITY)
        );
      });
      describe("AND WHEN borrowing 1 wei of DAI", () => {
        let tx: any;
        beforeEach(async () => {
          tx = exactlyEnv
            .getFixedLender("DAI")
            .connect(mariaUser)
            .borrowFromMaturityPool("1", nextPoolId, "1");
          await tx;
        });
        it("THEN a BorrowFromMaturityPool event is emmitted", async () => {
          await expect(tx)
            .to.emit(exactlyEnv.getFixedLender("DAI"), "BorrowFromMaturityPool")
            .withArgs(mariaUser.address, "1", "0", nextPoolId);
        });
        it("AND the Market Size of the smart pool remains in 2 wei of a dai", async () => {
          expect(await fixedLender.getSmartPoolDeposits()).to.be.equal("2");
        });
        it("AND a 1 wei of DAI borrow is registered", async () => {
          expect(
            await exactlyEnv.getFixedLender("DAI").getTotalMpBorrows(nextPoolId)
          ).to.equal("1");
        });
      });
    });
  });

  describe("WHEN depositing 100 DAI to a maturity pool", () => {
    let tx: any;
    beforeEach(async () => {
      tx = exactlyEnv.depositMP("DAI", nextPoolId, "100");
      await tx;
    });
    it("THEN a DepositToMaturityPool event is emitted", async () => {
      await expect(tx).to.emit(fixedLender, "DepositToMaturityPool").withArgs(
        mariaUser.address,
        parseUnits("100"),
        parseUnits("0"), // commission, its zero with the mocked rate
        nextPoolId
      );
    });
    it("AND the FixedLender contract has a balance of 100 DAI", async () => {
      expect(await underlyingToken.balanceOf(fixedLender.address)).to.equal(
        parseUnits("100")
      );
    });
    it("AND the FixedLender registers a supply of 100 DAI for the user", async () => {
      expect(
        await poolAccounting.mpUserSuppliedAmount(nextPoolId, mariaUser.address)
      ).to.be.equal(parseUnits("100"));
    });
    it("WHEN trying to borrow DAI THEN it reverts with INSUFFICIENT_LIQUIDITY since collateral was not deposited yet", async () => {
      await expect(
        exactlyEnv.borrowMP("DAI", nextPoolId, "1")
      ).to.be.revertedWith(errorGeneric(ProtocolError.INSUFFICIENT_LIQUIDITY));
    });
    describe("AND WHEN depositing 50 DAI to the same maturity, as the same user", () => {
      let tx: any;
      beforeEach(async () => {
        tx = exactlyEnv.depositMP("DAI", nextPoolId, "50");
        await tx;
      });
      it("THEN a DepositToMaturityPool event is emitted", async () => {
        await expect(tx).to.emit(fixedLender, "DepositToMaturityPool").withArgs(
          mariaUser.address,
          parseUnits("50"),
          parseUnits("0"), // commission, its zero with the mocked rate
          nextPoolId
        );
      });
      it("AND the FixedLender contract has a balance of 150 DAI", async () => {
        expect(await underlyingToken.balanceOf(fixedLender.address)).to.equal(
          parseUnits("150")
        );
      });
      it("AND the FixedLender does not register a smart pool balance deposit (exposed via getAccountSnapshot)", async () => {
        expect(
          (
            await fixedLender.getAccountSnapshot(mariaUser.address, nextPoolId)
          )[0]
        ).to.be.equal(parseUnits("0"));
      });
    });

    describe("WHEN depositing collateral and borrowing 60 DAI from the same maturity", () => {
      let tx: any;
      beforeEach(async () => {
        await exactlyEnv.depositSP("DAI", "100");
        tx = exactlyEnv.borrowMP("DAI", nextPoolId, "60");
        await tx;
      });
      it("THEN a BorrowFromMaturityPool event is emmitted", async () => {
        await expect(tx)
          .to.emit(exactlyEnv.getFixedLender("DAI"), "BorrowFromMaturityPool")
          .withArgs(
            mariaUser.address,
            parseUnits("60"),
            parseUnits("0"),
            nextPoolId
          );
      });
      it("AND a 60 DAI borrow is registered", async () => {
        expect(
          await exactlyEnv.getFixedLender("DAI").getTotalMpBorrows(nextPoolId)
        ).to.equal(parseUnits("60"));
      });
      it("AND contract's state variable userMpBorrowed registers the maturity where the user borrowed from", async () => {
        expect(
          await exactlyEnv
            .getPoolAccounting("DAI")
            .userMpBorrowed(mariaUser.address, 0)
        ).to.equal(nextPoolId);
      });
      describe("AND WHEN borrowing 60 DAI from another maturity AND repaying only first debt", () => {
        beforeEach(async () => {
          await exactlyEnv.depositSP("DAI", "1000");
          await exactlyEnv.borrowMP(
            "DAI",
            exaTime.poolIDByNumberOfWeek(2),
            "60"
          );
          await exactlyEnv.repayMP("DAI", nextPoolId, "60");
        });
        it("THEN contract's state variable userMpBorrowed registers the second maturity where the user borrowed from", async () => {
          expect(
            await exactlyEnv
              .getPoolAccounting("DAI")
              .userMpBorrowed(mariaUser.address, 0)
          ).to.equal(exaTime.poolIDByNumberOfWeek(2));
        });
      });
      describe("AND WHEN fully repaying the debt", () => {
        let tx: any;
        beforeEach(async () => {
          tx = exactlyEnv.repayMP("DAI", nextPoolId, "60");
          await tx;
        });
        it("THEN a RepayToMaturityPool event is emitted", async () => {
          await expect(tx)
            .to.emit(exactlyEnv.getFixedLender("DAI"), "RepayToMaturityPool")
            .withArgs(
              mariaUser.address,
              mariaUser.address,
              parseUnits("60"),
              parseUnits("60"),
              nextPoolId
            );
        });
        it("AND contract's state variable userMpBorrowed does not register the maturity where the user borrowed from anymore", async () => {
          await expect(
            exactlyEnv
              .getPoolAccounting("DAI")
              .userMpBorrowed(mariaUser.address, 0)
          ).to.be.reverted;
        });
        describe("AND WHEN withdrawing collateral and maturity pool deposit", () => {
          beforeEach(async () => {
            await exactlyEnv.withdrawSP("DAI", "100");
            await exactlyEnv.moveInTimeAndMine(nextPoolId);
            await exactlyEnv.withdrawMP("DAI", nextPoolId, "100");
          });
          // TODO tests for partial/excessive withdrawal?
          it("THEN the collateral is returned to Maria", async () => {
            expect(await underlyingToken.balanceOf(mariaUser.address)).to.eq(
              parseUnits("100000")
            );
            expect(await underlyingToken.balanceOf(fixedLender.address)).to.eq(
              parseUnits("0")
            );
          });
        });
      });
      describe("GIVEN the maturity pool matures", () => {
        beforeEach(async () => {
          await exactlyEnv.moveInTime(nextPoolId);
        });
        it("WHEN trying to withdraw an amount of zero THEN it reverts", async () => {
          await expect(
            exactlyEnv.withdrawMP("DAI", nextPoolId, "0")
          ).to.be.revertedWith(errorGeneric(ProtocolError.REDEEM_CANT_BE_ZERO));
        });
      });

      describe("AND WHEN partially (40DAI, 66%) repaying the debt", () => {
        let tx: any;
        beforeEach(async () => {
          tx = exactlyEnv.repayMP("DAI", nextPoolId, "40");
          await tx;
        });
        it("THEN a RepayToMaturityPool event is emitted", async () => {
          await expect(tx)
            .to.emit(exactlyEnv.getFixedLender("DAI"), "RepayToMaturityPool")
            .withArgs(
              mariaUser.address,
              mariaUser.address,
              parseUnits("40"),
              parseUnits("40"),
              nextPoolId
            );
        });
        it("AND Maria still owes 20 DAI", async () => {
          const [, amountOwed] = await exactlyEnv
            .getFixedLender("DAI")
            .getAccountSnapshot(mariaUser.address, nextPoolId);

          expect(amountOwed).to.equal(parseUnits("20"));
        });

        describe("AND WHEN moving in time to 1 day after maturity", () => {
          beforeEach(async () => {
            await exactlyEnv.moveInTimeAndMine(nextPoolId + exaTime.ONE_DAY);
          });
          it("THEN Maria owes (getAccountSnapshot) 20 DAI of principal + (20*0.02 ~= 0.0400032 ) DAI of late payment penalties", async () => {
            let penalties = exactlyEnv.calculatePenaltiesForDebt(
              20,
              exaTime.ONE_DAY,
              parseFloat(penaltyRate)
            );
            const [, amountOwed] = await exactlyEnv
              .getFixedLender("DAI")
              .getAccountSnapshot(mariaUser.address, nextPoolId);

            expect(amountOwed).to.equal(
              parseUnits((20 + penalties).toString())
            );
          });
          describe("AND WHEN repaying the rest of the 20.4 owed DAI", () => {
            beforeEach(async () => {
              let penalties = exactlyEnv.calculatePenaltiesForDebt(
                20,
                exaTime.ONE_DAY + exaTime.ONE_SECOND * 2,
                parseFloat(penaltyRate)
              );
              await exactlyEnv.repayMP(
                "DAI",
                nextPoolId,
                (20 + penalties).toString()
              );
            });
            it("THEN all debt is repaid", async () => {
              const [, amountOwed] = await exactlyEnv
                .getFixedLender("DAI")
                .getAccountSnapshot(mariaUser.address, nextPoolId);

              expect(amountOwed).to.equal(0);
            });
          });
          describe("AND WHEN repaying more than what is owed (30 DAI)", () => {
            beforeEach(async () => {
              await exactlyEnv.repayMP("DAI", nextPoolId, "30");
            });
            it("THEN all debt is repaid", async () => {
              const [, amountOwed] = await exactlyEnv
                .getFixedLender("DAI")
                .getAccountSnapshot(mariaUser.address, nextPoolId);

              expect(amountOwed).to.equal(0);
            });
          });
        });
      });
    });

    describe("AND WHEN moving in time to maturity AND withdrawing from the maturity pool", () => {
      let tx: any;
      beforeEach(async () => {
        await exactlyEnv.moveInTimeAndMine(nextPoolId);
        tx = await exactlyEnv.withdrawMP("DAI", nextPoolId, "100");
      });
      it("THEN 100 DAI are returned to Maria", async () => {
        expect(await underlyingToken.balanceOf(mariaUser.address)).to.eq(
          parseUnits("100000")
        );
        expect(await underlyingToken.balanceOf(fixedLender.address)).to.eq(
          parseUnits("0")
        );
      });
      it("AND a WithdrawFromMaturityPool event is emitted", async () => {
        await expect(tx)
          .to.emit(fixedLender, "WithdrawFromMaturityPool")
          .withArgs(mariaUser.address, parseUnits("100"), nextPoolId);
      });
    });
  });

  describe("simple validations:", () => {
    describe("invalid pool ids", () => {
      it("WHEN calling getAccountSnapshot on an invalid pool, THEN it reverts with INVALID_POOL_ID", async () => {
        let invalidPoolID = nextPoolId + 3;
        await expect(
          fixedLender.getAccountSnapshot(owner.address, invalidPoolID)
        ).to.be.revertedWith(errorGeneric(ProtocolError.INVALID_POOL_ID));
      });

      it("WHEN calling getTotalMpBorrows on an invalid pool, THEN it reverts with INVALID_POOL_ID", async () => {
        let invalidPoolID = nextPoolId + 3;
        await expect(
          fixedLender.getTotalMpBorrows(invalidPoolID)
        ).to.be.revertedWith(errorGeneric(ProtocolError.INVALID_POOL_ID));
      });
    });

    it("WHEN calling setProtocolSpreadFee from a regular (non-admin) user, THEN it reverts with an AccessControl error", async () => {
      await expect(
        fixedLender.connect(mariaUser).setProtocolSpreadFee(parseUnits("0.04"))
      ).to.be.revertedWith("AccessControl");
    });

    it("WHEN calling setProtocolLiquidationFee from a regular (non-admin) user, THEN it reverts with an AccessControl error", async () => {
      await expect(
        fixedLender
          .connect(mariaUser)
          .setProtocolLiquidationFee(parseUnits("0.04"))
      ).to.be.revertedWith("AccessControl");
    });

    it("WHEN calling setMpDepositDistributionWeighter from a regular (non-admin) user, THEN it reverts with an AccessControl error", async () => {
      await expect(
        fixedLender
          .connect(mariaUser)
          .setMpDepositDistributionWeighter(parseUnits("0.04"))
      ).to.be.revertedWith("AccessControl");
    });

    it("WHEN calling withdrawEarnings from a regular (non-admin) user, THEN it reverts with an AccessControl error", async () => {
      await expect(
        fixedLender
          .connect(mariaUser)
          .withdrawFromTreasury(owner.address, parseUnits("0.04"))
      ).to.be.revertedWith("AccessControl");
    });

    it("WHEN trying to withdrawEarnings with an amount bigger than the current available funds, THEN it reverts with overflow", async () => {
      await expect(
        fixedLender.withdrawFromTreasury(
          owner.address,
          parseUnits("100000000000")
        )
      ).to.be.revertedWith("reverted with panic code 0x11");
    });
  });

  describe("GIVEN an interest rate of 2%", () => {
    beforeEach(async () => {
      await exactlyEnv.setBorrowRate("0.02");

      await exactlyEnv.depositSP("DAI", "1");
      await exactlyEnv.enterMarkets(["DAI"]);
      // we add liquidity to the maturity
      await exactlyEnv.depositMP("DAI", nextPoolId, "1");
    });
    it("WHEN trying to borrow 0.8 DAI with a max amount of debt of 0.8 DAI, THEN it reverts with TOO_MUCH_SLIPPAGE", async () => {
      await expect(
        exactlyEnv.borrowMP("DAI", nextPoolId, "0.8", "0.8")
      ).to.be.revertedWith(errorGeneric(ProtocolError.TOO_MUCH_SLIPPAGE));
    });

    it("WHEN trying to deposit 100 DAI with a minimum required amount to be received of 103, THEN 102 are received instead AND the transaction reverts with TOO_MUCH_SLIPPAGE", async () => {
      let tx = exactlyEnv.depositMP("DAI", nextPoolId, "100", "103");
      await expect(tx).to.be.revertedWith(
        errorGeneric(ProtocolError.TOO_MUCH_SLIPPAGE)
      );
    });
  });

  describe("GIVEN Maria has 10ETH collateral", () => {
    beforeEach(async () => {
      await exactlyEnv.depositSP("WETH", "20");
      await exactlyEnv.enterMarkets(["WETH"]);
    });
    it("WHEN Maria tries to borrow 50 DAI on an empty maturity, THEN it fails with INSUFFICIENT_PROTOCOL_LIQUIDITY", async () => {
      await expect(
        exactlyEnv.borrowMP("DAI", nextPoolId, "10")
      ).to.be.revertedWith(
        errorGeneric(ProtocolError.INSUFFICIENT_PROTOCOL_LIQUIDITY)
      );
    });
    describe("AND John deposited 2400 DAI to the smart pool", () => {
      beforeEach(async () => {
        exactlyEnv.switchWallet(johnUser);
        await exactlyEnv.depositSP("DAI", "2400");
        exactlyEnv.switchWallet(mariaUser);
      });
      it("WHEN Maria tries to borrow 2500 DAI, THEN it fails with INSUFFICIENT_PROTOCOL_LIQUIDITY", async () => {
        await expect(
          exactlyEnv.borrowMP("DAI", nextPoolId, "2500", "5000")
        ).to.be.revertedWith(
          errorGeneric(ProtocolError.INSUFFICIENT_PROTOCOL_LIQUIDITY)
        );
      });
      it("WHEN Maria tries to borrow 150 DAI, THEN it succeeds", async () => {
        await expect(exactlyEnv.borrowMP("DAI", nextPoolId, "150")).to.not.be
          .reverted;
      });
    });
    describe("AND John deposited 100 DAI to maturity", () => {
      beforeEach(async () => {
        exactlyEnv.switchWallet(johnUser);
        await exactlyEnv.depositMP("DAI", nextPoolId, "100");
        exactlyEnv.switchWallet(mariaUser);
      });
      it("WHEN Maria tries to borrow 150 DAI, THEN it fails with INSUFFICIENT_PROTOCOL_LIQUIDITY", async () => {
        await expect(
          exactlyEnv.borrowMP("DAI", nextPoolId, "150")
        ).to.be.revertedWith(
          errorGeneric(ProtocolError.INSUFFICIENT_PROTOCOL_LIQUIDITY)
        );
      });
      describe("AND John deposited 1200 DAI to the smart pool", () => {
        beforeEach(async () => {
          exactlyEnv.switchWallet(johnUser);
          await exactlyEnv.depositSP("DAI", "1200");
          exactlyEnv.switchWallet(mariaUser);
        });
        it("WHEN Maria tries to borrow 1350 DAI, THEN it fails with INSUFFICIENT_PROTOCOL_LIQUIDITY", async () => {
          await expect(
            exactlyEnv.borrowMP("DAI", nextPoolId, "1350", "2000")
          ).to.be.revertedWith(
            errorGeneric(ProtocolError.INSUFFICIENT_PROTOCOL_LIQUIDITY)
          );
        });
        it("WHEN Maria tries to borrow 200 DAI, THEN it succeeds", async () => {
          await expect(exactlyEnv.borrowMP("DAI", nextPoolId, "200")).to.not.be
            .reverted;
        });
        it("WHEN Maria tries to borrow 150 DAI, THEN it succeeds", async () => {
          await expect(exactlyEnv.borrowMP("DAI", nextPoolId, "150")).to.not.be
            .reverted;
        });
      });
    });
  });

  describe("GIVEN maria has plenty of WETH collateral", () => {
    beforeEach(async () => {
      await exactlyEnv.depositSP("WETH", "4");
      await exactlyEnv.enterMarkets(["DAI", "WETH"]);
    });
    describe("AND GIVEN she deposits 1000DAI into the next two maturity pools AND other 500 into the smart pool", () => {
      beforeEach(async () => {
        await exactlyEnv.depositMP("DAI", nextPoolId, "1000");
        await exactlyEnv.depositMP("DAI", laterPoolId, "1000");
        await exactlyEnv.depositSP("DAI", "6000");
      });
      describe("WHEN borrowing 1200 in the current maturity", () => {
        let maturityPool: any;
        let smartPool: any;
        beforeEach(async () => {
          await exactlyEnv.borrowMP("DAI", nextPoolId, "1200");
          maturityPool = await poolAccounting.maturityPools(nextPoolId);
          smartPool = await exactlyEnv.smartPoolState("DAI");
        });
        it("THEN all of the maturity pools funds are in use", async () => {
          expect(maturityPool.borrowed).to.gt(maturityPool.supplied);
        });
        it("AND 200 are borrowed from the smart pool", async () => {
          expect(smartPool.borrowed).to.eq(parseUnits("200"));
          expect(maturityPool.suppliedSP).to.eq(parseUnits("200"));
        });
        it("AND WHEN trying to withdraw 300 ==(500 available, 200 borrowed to MP) from the smart pool, THEN it succeeds", async () => {
          await expect(exactlyEnv.withdrawSP("DAI", "300")).to.not.be.reverted;
        });
        it("AND WHEN trying to withdraw 5900 >(6000 total, 200 borrowed to MP) from the smart pool, THEN it reverts because 100 of those 5900 are still lent to the maturity pool", async () => {
          await expect(exactlyEnv.withdrawSP("DAI", "5900")).to.be.revertedWith(
            errorGeneric(ProtocolError.INSUFFICIENT_PROTOCOL_LIQUIDITY)
          );
        });
        describe("AND borrowing 1100 in a later maturity ", () => {
          beforeEach(async () => {
            await exactlyEnv.borrowMP("DAI", laterPoolId, "1100");
            maturityPool = await poolAccounting.maturityPools(laterPoolId);
            smartPool = await exactlyEnv.smartPoolState("DAI");
          });
          it("THEN all of the maturity pools funds are in use", async () => {
            expect(maturityPool.borrowed).to.gt(maturityPool.supplied);
          });
          it("THEN the later maturity owes 100 to the smart pool", async () => {
            expect(maturityPool.suppliedSP).to.eq(parseUnits("100"));
          });
          it("THEN the smart pool has lent 300 (100 from the later maturity one, 200 from the first one)", async () => {
            expect(smartPool.borrowed).to.eq(parseUnits("300"));
          });
          describe("AND WHEN repaying 50 DAI in the later maturity", () => {
            beforeEach(async () => {
              await exactlyEnv.repayMP("DAI", laterPoolId, "50");
              maturityPool = await poolAccounting.maturityPools(laterPoolId);
              smartPool = await exactlyEnv.smartPoolState("DAI");
            });
            it("THEN 1050 DAI are borrowed", async () => {
              expect(maturityPool.borrowed).to.eq(parseUnits("1050"));
            });
            it("THEN the maturity pool doesnt have funds available", async () => {
              expect(maturityPool.borrowed).to.gt(maturityPool.supplied);
            });
            it("THEN the maturity pool still owes 100 to the smart pool", async () => {
              expect(maturityPool.suppliedSP).to.eq(parseUnits("100"));
            });
            it("THEN the smart pool was NOT repaid 50 DAI", async () => {
              expect(smartPool.borrowed).to.eq(parseUnits("300"));
            });
          });
          describe("AND WHEN john deposits 800 to the later maturity", () => {
            beforeEach(async () => {
              exactlyEnv.switchWallet(johnUser);
              await exactlyEnv.depositMP("DAI", laterPoolId, "800");
              maturityPool = await poolAccounting.maturityPools(laterPoolId);
              smartPool = await exactlyEnv.smartPoolState("DAI");
            });
            it("THEN 1100 DAI are still borrowed", async () => {
              expect(maturityPool.borrowed).to.eq(parseUnits("1100"));
            });
            it("THEN the later maturity has 700 DAI available for borrowing", async () => {
              expect(maturityPool.supplied.sub(maturityPool.borrowed)).to.eq(
                parseUnits("700")
              );
            });
            it("THEN the later maturity still owes 100 DAI to the smart pool", async () => {
              expect(maturityPool.suppliedSP).to.eq(parseUnits("100"));
            });
            it("THEN the smart pool was NOT repaid 100 DAI from the later maturity, and is still owed 300 from the current one", async () => {
              expect(smartPool.borrowed).to.eq(parseUnits("300"));
            });
          });
        });
        describe("AND WHEN john deposits 100 to the same maturity", () => {
          beforeEach(async () => {
            exactlyEnv.switchWallet(johnUser);
            await exactlyEnv.depositMP("DAI", nextPoolId, "100");
            maturityPool = await poolAccounting.maturityPools(nextPoolId);
            smartPool = await exactlyEnv.smartPoolState("DAI");
          });
          it("THEN 1200 DAI are still borrowed", async () => {
            expect(maturityPool.borrowed).to.eq(parseUnits("1200"));
          });
          it("THEN the maturity pool still doesnt have funds available", async () => {
            expect(maturityPool.borrowed).to.gt(maturityPool.supplied);
          });
          it("THEN the maturity pool still owes 200 to the smart pool", async () => {
            expect(maturityPool.suppliedSP).to.eq(parseUnits("200"));
          });
          it("THEN the smart pool was NOT repaid the other 100 (is owed still 200)", async () => {
            expect(smartPool.borrowed).to.eq(parseUnits("200"));
          });
        });
        describe("AND WHEN john deposits 300 to the same maturity", () => {
          beforeEach(async () => {
            exactlyEnv.switchWallet(johnUser);
            await exactlyEnv.depositMP("DAI", nextPoolId, "300");
            maturityPool = await poolAccounting.maturityPools(nextPoolId);
            smartPool = await exactlyEnv.smartPoolState("DAI");
          });
          it("THEN 1200 DAI are still borrowed", async () => {
            expect(maturityPool.borrowed).to.eq(parseUnits("1200"));
          });
          it("THEN the maturity pool has 100 DAI available", async () => {
            expect(maturityPool.supplied.sub(maturityPool.borrowed)).to.eq(
              parseUnits("100")
            );
          });
          it("THEN the maturity pool still owes 200 to the smart pool", async () => {
            expect(maturityPool.suppliedSP).to.eq(parseUnits("200"));
          });
        });
        describe("AND WHEN repaying 100 DAI", () => {
          beforeEach(async () => {
            await exactlyEnv.repayMP("DAI", nextPoolId, "100");
            maturityPool = await poolAccounting.maturityPools(nextPoolId);
            smartPool = await exactlyEnv.smartPoolState("DAI");
          });
          it("THEN 1100 DAI are still borrowed", async () => {
            expect(maturityPool.borrowed).to.eq(parseUnits("1100"));
          });
          it("THEN the maturity pool doesnt have funds available", async () => {
            expect(maturityPool.borrowed).to.gt(maturityPool.supplied);
          });
          it("THEN the maturity pool still owes 200 to the smart pool", async () => {
            expect(maturityPool.suppliedSP).to.eq(parseUnits("200"));
          });
        });
        describe("AND WHEN repaying 300 DAI", () => {
          beforeEach(async () => {
            await exactlyEnv.repayMP("DAI", nextPoolId, "300");
            maturityPool = await poolAccounting.maturityPools(nextPoolId);
            smartPool = await exactlyEnv.smartPoolState("DAI");
          });
          it("THEN 900 DAI are still borrowed", async () => {
            expect(maturityPool.borrowed).to.eq(parseUnits("900"));
          });
          it("THEN the maturity pool has 100 DAI available", async () => {
            expect(maturityPool.supplied.sub(maturityPool.borrowed)).to.eq(
              parseUnits("100")
            );
          });
          it("THEN the maturity pool still owes 200 to the smart pool", async () => {
            expect(maturityPool.suppliedSP).to.eq(parseUnits("200"));
          });
        });
        describe("AND WHEN repaying in full (1200 DAI)", () => {
          beforeEach(async () => {
            await exactlyEnv.repayMP("DAI", nextPoolId, "1200");
            maturityPool = await poolAccounting.maturityPools(nextPoolId);
            smartPool = await exactlyEnv.smartPoolState("DAI");
          });
          it("THEN the maturity pool has 1000 DAI available", async () => {
            expect(maturityPool.supplied.sub(maturityPool.borrowed)).to.eq(
              parseUnits("1000")
            );
          });
        });
      });
    });
    describe("AND GIVEN she borrows 5k DAI", () => {
      const depositAmount = 5000;
      beforeEach(async () => {
        // we first fund the maturity pool so it has liquidity to borrow
        await exactlyEnv.depositMP("DAI", nextPoolId, depositAmount.toString());
        await exactlyEnv.borrowMP("DAI", nextPoolId, depositAmount.toString());
      });
      describe("AND WHEN moving in time to 20 days after maturity", () => {
        beforeEach(async () => {
          await exactlyEnv.moveInTimeAndMine(nextPoolId + exaTime.ONE_DAY * 20);
        });
        it("THEN Maria owes (getAccountSnapshot) 5k + aprox 2.8k DAI in penalties", async () => {
          let penalties = exactlyEnv.calculatePenaltiesForDebt(
            depositAmount,
            exaTime.ONE_DAY * 20,
            parseFloat(penaltyRate)
          );
          const [, amountOwed] = await exactlyEnv
            .getFixedLender("DAI")
            .getAccountSnapshot(mariaUser.address, nextPoolId);

          expect(amountOwed).to.equal(
            parseUnits((depositAmount + penalties).toString())
          );
        });
      });
      describe("AND WHEN moving in time to 20 days after maturity but repaying really small amounts within some days", () => {
        beforeEach(async () => {
          await exactlyEnv.moveInTimeAndMine(nextPoolId + exaTime.ONE_DAY * 5);
          await exactlyEnv.repayMP("DAI", nextPoolId, "0.000000001");
          await exactlyEnv.moveInTimeAndMine(nextPoolId + exaTime.ONE_DAY * 10);
          await exactlyEnv.repayMP("DAI", nextPoolId, "0.000000001");
          await exactlyEnv.moveInTimeAndMine(nextPoolId + exaTime.ONE_DAY * 15);
          await exactlyEnv.repayMP("DAI", nextPoolId, "0.000000001");
          await exactlyEnv.moveInTimeAndMine(nextPoolId + exaTime.ONE_DAY * 20);
        });
        it("THEN Maria owes (getAccountSnapshot) 5k + aprox 2.8k DAI in penalties (no debt was compounded)", async () => {
          let penalties = exactlyEnv.calculatePenaltiesForDebt(
            depositAmount,
            exaTime.ONE_DAY * 20,
            parseFloat(penaltyRate)
          );
          const [, amountOwed] = await exactlyEnv
            .getFixedLender("DAI")
            .getAccountSnapshot(mariaUser.address, nextPoolId);

          expect(amountOwed).to.closeTo(
            parseUnits((depositAmount + penalties).toString()),
            parseUnits("0.00000001").toNumber()
          );
        });
      });
    });
  });

  describe("Transfers with Commissions", () => {
    describe("GIVEN an underlying token with 10% comission", () => {
      beforeEach(async () => {
        await underlyingToken.setCommission(parseUnits("0.1"));
        await underlyingToken.transfer(johnUser.address, parseUnits("10000"));
      });

      describe("WHEN depositing 2000 DAI on a maturity pool and on a smart pool", () => {
        beforeEach(async () => {
          exactlyEnv.switchWallet(johnUser);
          await exactlyEnv.depositMP("DAI", nextPoolId, "2000", "1800");
          await exactlyEnv.depositSP("DAI", "2000");
          exactlyEnv.switchWallet(mariaUser);
        });

        it("THEN the user receives 1800 on the maturity pool deposit", async () => {
          expect(
            await poolAccounting.mpUserSuppliedAmount(
              nextPoolId,
              johnUser.address
            )
          ).to.be.equal(parseUnits("1800"));
        });

        describe("AND GIVEN john has a 900 DAI borrows on a maturity pool", () => {
          const amountBorrow = parseUnits("900");
          const maxAllowance = parseUnits("2000");
          beforeEach(async () => {
            await fixedLender
              .connect(johnUser)
              .borrowFromMaturityPool(
                amountBorrow,
                nextPoolId,
                applyMinFee(amountBorrow)
              );

            await underlyingToken
              .connect(johnUser)
              .approve(fixedLender.address, maxAllowance);
          });

          describe("AND WHEN trying to repay 1100 (too much)", () => {
            let tx: any;
            let johnBalanceBefore: any;
            beforeEach(async () => {
              exactlyEnv.switchWallet(johnUser);
              johnBalanceBefore = await underlyingToken.balanceOf(
                johnUser.address
              );
              tx = exactlyEnv.repayMP("DAI", nextPoolId, "1100");
            });

            it("THEN jhon ends up repaying all debt", async () => {
              await expect(tx).to.not.be.reverted;

              const [, amountOwed] = await fixedLender
                .connect(johnUser.address)
                .getAccountSnapshot(johnUser.address, nextPoolId);
              expect(amountOwed).to.eq(0);
            });

            it("THEN the spare amount is transferred back to him", async () => {
              await expect(tx).to.not.be.reverted;

              const johnBalanceAfter = await underlyingToken.balanceOf(
                johnUser.address
              );
              const repayedAmount = 1100 * 0.9; // 10% comission
              const returnedSpareAmount = (repayedAmount - 900) * 0.9; // 900 = debt - the transferOut also charges 10% comission

              expect(johnBalanceAfter).to.equal(
                johnBalanceBefore
                  .sub(parseUnits(repayedAmount.toString()))
                  .add(parseUnits(returnedSpareAmount.toString()))
              );
            });
          });

          describe("AND WHEN repaying the exact amount with 10% commission", () => {
            beforeEach(async () => {
              exactlyEnv.switchWallet(johnUser);
              await exactlyEnv.repayMP("DAI", nextPoolId, "1000");
            });

            it("THEN the user cancel its debt and succeeds", async () => {
              const borrowed = (
                await fixedLender
                  .connect(johnUser.address)
                  .getAccountSnapshot(johnUser.address, nextPoolId)
              )[1];
              expect(borrowed).to.eq(0);
            });
          });

          describe("AND WHEN trying to repay 1100 (too much) with no commission", () => {
            let tx: any;
            let johnBalanceBefore: any;
            beforeEach(async () => {
              exactlyEnv.switchWallet(johnUser);
              await underlyingToken.setCommission(parseUnits("0"));
              johnBalanceBefore = await underlyingToken.balanceOf(
                johnUser.address
              );
              tx = exactlyEnv.repayMP("DAI", nextPoolId, "1100");
            });

            it("THEN jhon ends up repaying all debt", async () => {
              await expect(tx).to.not.be.reverted;

              const [, amountOwed] = await fixedLender
                .connect(johnUser.address)
                .getAccountSnapshot(johnUser.address, nextPoolId);
              expect(amountOwed).to.eq(0);
            });

            it("THEN the spare amount is transferred back to him", async () => {
              await expect(tx).to.not.be.reverted;

              const johnBalanceAfter = await underlyingToken.balanceOf(
                johnUser.address
              );
              expect(johnBalanceAfter).to.equal(
                johnBalanceBefore.sub(parseUnits("900"))
              );
            });
          });
        });
      });
    });
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshot]);
    await ethers.provider.send("evm_mine", []);
  });
});
