import { expect } from "chai";
import { parseUnits } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ExactlyEnv, ExaTime } from "./exactlyUtils";
import { PoolEnv } from "./poolEnv";
import { DefaultEnv } from "./defaultEnv";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Pool Management Library", () => {
  const exaTime = new ExaTime();

  let poolEnv: PoolEnv;
  let defaultEnv: DefaultEnv;
  let snapshot: any;
  let juana: SignerWithAddress;
  let walter: SignerWithAddress;
  let cindy: SignerWithAddress;

  beforeEach(async () => {
    snapshot = await ethers.provider.send("evm_snapshot", []);
  });

  describe("GIVEN a clean maturity pool", () => {
    beforeEach(async () => {
      poolEnv = await PoolEnv.create();
    });

    describe("WHEN 100 token are deposited", async () => {
      let mp: any;
      beforeEach(async () => {
        await poolEnv.addMoney(exaTime.nextPoolID(), "100");
        mp = await poolEnv.mpHarness.maturityPool();
      });

      it("THEN the pool 'borrowed' is 0", async () => {
        expect(mp.borrowed).to.equal(parseUnits("0"));
      });

      it("THEN the pool 'supplied' is 100", async () => {
        expect(mp.supplied).to.equal(parseUnits("100"));
      });

      it("THEN the pool 'unassignedEarnings' are 0", async () => {
        expect(mp.unassignedEarnings).to.equal(parseUnits("0"));
      });

      it("THEN the pool 'earningsSP' are 0", async () => {
        expect(mp.earningsSP).to.equal(parseUnits("0"));
      });

      it("THEN the smart pool total debt is 0", async () => {
        let smartPoolTotalDebt = await poolEnv.mpHarness.smartPoolTotalDebt();
        expect(smartPoolTotalDebt).to.equal(parseUnits("0"));
      });

      it("THEN the pool 'lastCommission' is 0", async () => {
        expect(await poolEnv.mpHarness.lastCommission()).to.equal(
          parseUnits("0")
        );
      });

      describe("AND WHEN 80 token are taken out, with 10 of fees to be paid", async () => {
        let mp: any;
        beforeEach(async () => {
          await poolEnv.takeMoney("80");
          await poolEnv.addFee(exaTime.nextPoolID(), "10");
          mp = await poolEnv.mpHarness.maturityPool();
        });

        it("THEN the pool 'borrowed' is 80", async () => {
          expect(mp.borrowed).to.equal(parseUnits("80"));
        });

        it("THEN the pool 'supplied' is 100", async () => {
          expect(mp.supplied).to.equal(parseUnits("100"));
        });

        it("THEN the pool 'unassignedEarnings' are 10", async () => {
          expect(mp.unassignedEarnings).to.equal(parseUnits("10"));
        });

        it("THEN the pool 'earningsSP' are 0", async () => {
          expect(mp.earningsSP).to.equal(parseUnits("0"));
        });

        it("THEN the smart pool total debt is 0", async () => {
          let smartPoolTotalDebt = await poolEnv.mpHarness.smartPoolTotalDebt();
          expect(smartPoolTotalDebt).to.equal(parseUnits("0"));
        });

        describe("AND WHEN 70 token are taken out, with 10 of fees to be paid", async () => {
          let mp: any;
          beforeEach(async () => {
            await poolEnv.takeMoney("70");
            await poolEnv.addFee(exaTime.nextPoolID(), "8");
            mp = await poolEnv.mpHarness.maturityPool();
          });

          it("THEN the pool 'borrowed' is 150", async () => {
            expect(mp.borrowed).to.equal(parseUnits("150"));
          });

          it("THEN the pool 'supplied' is 100", async () => {
            expect(mp.supplied).to.equal(parseUnits("100"));
          });

          it("THEN the pool 'earnings' at maturity are 18", async () => {
            expect(mp.unassignedEarnings).to.equal(parseUnits("18"));
          });

          it("THEN the pool 'earningsSP' are 0", async () => {
            expect(mp.earningsSP).to.equal(parseUnits("0"));
          });

          it("THEN the smart pool total debt is 50", async () => {
            let smartPoolTotalDebt =
              await poolEnv.mpHarness.smartPoolTotalDebt();
            expect(smartPoolTotalDebt).to.equal(parseUnits("50"));
          });

          describe("AND WHEN we reach maturity and go over 1 day", async () => {
            let mp: any;
            beforeEach(async () => {
              await poolEnv.moveInTime(exaTime.day(11));
              // adding a 0 fee forces accruing
              await poolEnv.addFee(exaTime.nextPoolID(), "0");
              mp = await poolEnv.mpHarness.maturityPool();
            });

            it("THEN the pool 'earnings' at maturity are 0", async () => {
              expect(mp.unassignedEarnings).to.equal(parseUnits("0"));
            });

            it("THEN the pool 'earningsSP' are 18", async () => {
              expect(mp.earningsSP).to.equal(parseUnits("18"));
            });

            it("THEN the 'lastAccrue' is equal to the maturity date", async () => {
              expect(mp.lastAccrue).to.equal(exaTime.nextPoolID());
            });

            describe("AND WHEN one more day goes by, nothing changes", async () => {
              let mp: any;
              beforeEach(async () => {
                await poolEnv.moveInTime(exaTime.day(12));
                // adding a 0 fee forces accruing
                await poolEnv.addFee(exaTime.nextPoolID(), "0");
                mp = await poolEnv.mpHarness.maturityPool();
              });

              it("THEN the pool 'earnings' at maturity are 0", async () => {
                expect(mp.unassignedEarnings).to.equal(parseUnits("0"));
              });

              it("THEN the pool 'earningsSP' are 18", async () => {
                expect(mp.earningsSP).to.equal(parseUnits("18"));
              });

              it("THEN the 'lastAccrue' is equal to the maturity date", async () => {
                expect(mp.lastAccrue).to.equal(exaTime.nextPoolID());
              });
            });
          });
        });
      });
    });

    describe("WHEN 100 token are taken out, with 10 of fees to be paid", async () => {
      let mp: any;
      beforeEach(async () => {
        await poolEnv.takeMoney("100");
        await poolEnv.addFee(exaTime.nextPoolID(), "10");
        mp = await poolEnv.mpHarness.maturityPool();
      });

      it("THEN the pool 'borrowed' is 100", async () => {
        expect(mp.borrowed).to.equal(parseUnits("100"));
      });

      it("THEN the pool 'unassignedEarnings' are 10", async () => {
        expect(mp.unassignedEarnings).to.equal(parseUnits("10"));
      });

      it("THEN the smart pool total debt is 100", async () => {
        let smartPoolTotalDebt = await poolEnv.mpHarness.smartPoolTotalDebt();
        expect(smartPoolTotalDebt).to.equal(parseUnits("100"));
      });
    });

    describe("WHEN 100 tokens are borrowed, 10 tokens are fees, and 100 token are deposited (same deposited)", async () => {
      let mp: any;
      beforeEach(async () => {
        await poolEnv.takeMoney("100");
        await poolEnv.addFee(exaTime.nextPoolID(), "10");
        await poolEnv.addMoney(exaTime.nextPoolID(), "100");
        mp = await poolEnv.mpHarness.maturityPool();
      });

      it("THEN the pool 'borrowed' is 100", async () => {
        expect(mp.borrowed).to.equal(parseUnits("100"));
      });

      it("THEN the pool 'unassignedEarnings' are 5", async () => {
        expect(mp.unassignedEarnings).to.equal(parseUnits("5"));
      });

      it("THEN the pool 'lastCommission' is 5", async () => {
        expect(await poolEnv.mpHarness.lastCommission()).to.equal(
          parseUnits("5")
        );
      });

      it("THEN the pool 'supplied' is 100", async () => {
        expect(mp.supplied).to.equal(parseUnits("100"));
      });

      it("THEN the smart pool total debt is 100", async () => {
        let smartPoolTotalDebt = await poolEnv.mpHarness.smartPoolTotalDebt();
        expect(smartPoolTotalDebt).to.equal(parseUnits("100"));
      });

      it("THEN the smart pool supply on maturity pool is 100", async () => {
        expect(mp.suppliedSP).to.equal(parseUnits("100"));
      });
    });

    describe("WHEN 100 tokens are borrowed, 15 tokens are fees, and 50 token are deposited (less deposited)", async () => {
      let mp: any;
      beforeEach(async () => {
        await poolEnv.takeMoney("100");
        await poolEnv.addFee(exaTime.nextPoolID(), "15");
        await poolEnv.addMoney(exaTime.nextPoolID(), "50");
        mp = await poolEnv.mpHarness.maturityPool();
      });

      it("THEN the pool 'borrowed' is 100", async () => {
        expect(mp.borrowed).to.equal(parseUnits("100"));
      });

      it("THEN the pool 'unassignedEarnings' are 10", async () => {
        expect(mp.unassignedEarnings).to.equal(parseUnits("10"));
      });

      it("THEN the pool 'lastCommission' is 5", async () => {
        expect(await poolEnv.mpHarness.lastCommission()).to.equal(
          parseUnits("5")
        );
      });

      it("THEN the pool 'supplied' is 50", async () => {
        expect(mp.supplied).to.equal(parseUnits("50"));
      });

      it("THEN the smart pool total debt is 100", async () => {
        let smartPoolTotalDebt = await poolEnv.mpHarness.smartPoolTotalDebt();
        expect(smartPoolTotalDebt).to.equal(parseUnits("100"));
      });

      it("THEN the smart pool 'supplied' to maturity pool is 100", async () => {
        expect(mp.suppliedSP).to.equal(parseUnits("100"));
      });
    });

    describe("WHEN 100 tokens are borrowed, 60 tokens are fees, and 500 token are deposited (more deposit)", async () => {
      let mp: any;
      beforeEach(async () => {
        await poolEnv.takeMoney("100");
        await poolEnv.addFee(exaTime.nextPoolID(), "60");
        await poolEnv.addMoney(exaTime.nextPoolID(), "500");
        mp = await poolEnv.mpHarness.maturityPool();
      });

      it("THEN the pool 'borrowed' is 100", async () => {
        expect(mp.borrowed).to.equal(parseUnits("100"));
      });

      it("THEN the pool 'unassignedEarnings' are 10", async () => {
        expect(mp.unassignedEarnings).to.equal(parseUnits("10"));
      });

      it("THEN the pool 'lastCommission' is 50", async () => {
        // all the commission went to the fixed rate deposit
        expect(await poolEnv.mpHarness.lastCommission()).to.equal(
          parseUnits("50")
        );
      });

      it("THEN the pool 'supplied' is 500", async () => {
        expect(mp.supplied).to.equal(parseUnits("500"));
      });

      it("THEN the smart pool total debt is 100", async () => {
        let smartPoolTotalDebt = await poolEnv.mpHarness.smartPoolTotalDebt();
        expect(smartPoolTotalDebt).to.equal(parseUnits("100"));
      });

      it("THEN the smart pool 'supplied' on maturity pool is 100", async () => {
        expect(mp.suppliedSP).to.equal(parseUnits("100"));
      });
    });
  });

  describe("GIVEN a loan of 100 that will pay 10 in fees in 10 days", () => {
    const fakeMaturityPool = exaTime.day(10);
    beforeEach(async () => {
      poolEnv = await PoolEnv.create();
      await poolEnv.takeMoney("100");
      await poolEnv.addFee(fakeMaturityPool, "10");
    });

    describe("WHEN 2 days go by and another user deposits 100 to the same Maturity Pool", async () => {
      let mp: any;
      beforeEach(async () => {
        await poolEnv.moveInTime(exaTime.day(2));
        await poolEnv.addMoney(fakeMaturityPool, "100");
        mp = await poolEnv.mpHarness.maturityPool();
      });

      it("THEN the pool 'earningsSP' is 2", async () => {
        expect(mp.earningsSP).to.equal(parseUnits("2"));
      });

      it("THEN the pool 'unassignedEarnings' are 4", async () => {
        expect(mp.unassignedEarnings).to.equal(parseUnits("4"));
      });

      it("THEN the pool 'lastCommission' is 4", async () => {
        expect(await poolEnv.mpHarness.lastCommission()).to.equal(
          parseUnits("4")
        );
      });

      describe("AND GIVEN more fees are generated 4 days after", () => {
        let mp: any;
        beforeEach(async () => {
          await poolEnv.moveInTime(exaTime.day(6));
          await poolEnv.takeMoney("100");
          await poolEnv.addFee(fakeMaturityPool, "10");
          mp = await poolEnv.mpHarness.maturityPool();
        });

        it("THEN the pool 'earningsSP' is 4", async () => {
          expect(mp.earningsSP).to.equal(parseUnits("4"));
        });

        it("THEN the pool 'unassignedEarnings' are 12", async () => {
          expect(mp.unassignedEarnings).to.eq(parseUnits("12"));
        });
      });

      describe("AND GIVEN that FOUR(4) more days go by and someone deposits 200", () => {
        let mp: any;
        beforeEach(async () => {
          await poolEnv.moveInTime(exaTime.day(6));
          await poolEnv.addMoney(fakeMaturityPool, "200");
          mp = await poolEnv.mpHarness.maturityPool();
        });

        it("THEN the pool 'earningsSP' is 4", async () => {
          expect(mp.earningsSP).to.equal(parseUnits("4"));
        });

        it("THEN the pool 'unassignedEarnings' are 0.666", async () => {
          expect(mp.unassignedEarnings).to.closeTo(
            parseUnits("0.6666"),
            parseUnits("0.0001").toNumber()
          );
        });

        it("THEN the pool 'lastCommission' is 1.3333", async () => {
          expect(await poolEnv.mpHarness.lastCommission()).to.closeTo(
            parseUnits("1.3333"),
            parseUnits("0.0001").toNumber()
          );
        });

        describe("AND GIVEN that maturity arrives and someone repays 100", () => {
          let mp: any;
          beforeEach(async () => {
            await poolEnv.moveInTime(exaTime.day(10));
            await poolEnv.repay(fakeMaturityPool, "100");
            mp = await poolEnv.mpHarness.maturityPool();
          });

          it("THEN the pool 'earningsSP' is 4.666", async () => {
            expect(mp.earningsSP).to.closeTo(
              parseUnits("4.6666"),
              parseUnits("0.0001").toNumber()
            );
          });

          it("THEN the pool 'unassignedEarnings' at maturity are 0", async () => {
            expect(mp.unassignedEarnings).to.eq(0);
          });

          it("THEN the pool 'lastEarningsSP' is 0 (repayment didn't cover earnings)", async () => {
            expect(await poolEnv.mpHarness.lastEarningsSP()).to.eq(0);
          });

          it("THEN the pool doesn't owe anymore the smart pool ('suppliedSP'=0)", async () => {
            expect(mp.suppliedSP).to.eq(parseUnits("0"));
          });

          it("THEN the pool have deposits to be repaid for 300", async () => {
            expect(mp.supplied).to.eq(parseUnits("300"));
          });

          describe("AND GIVEN that someone repays again for 30", () => {
            let mp: any;
            beforeEach(async () => {
              await poolEnv.repay(fakeMaturityPool, "30");
              mp = await poolEnv.mpHarness.maturityPool();
            });

            it("THEN the pool 'earningsSP' is 0 (have been repaid)", async () => {
              expect(mp.earningsSP).to.eq(0);
            });

            it("THEN the pool 'unassignedEarnings' at maturity are 0", async () => {
              expect(mp.unassignedEarnings).to.eq(0);
            });

            it("THEN the pool 'lastEarningsSP' is 0", async () => {
              // 30 repay can be a repayment with penalties. In this case, since
              // all the other debt has been repaid, it goes directly to the SP
              // earnings
              expect(await poolEnv.mpHarness.lastEarningsSP()).to.eq(
                parseUnits("30")
              );
            });

            it("THEN the pool 'suppliedSP' is 0 (debt has been repaid)", async () => {
              expect(mp.suppliedSP).to.eq(parseUnits("0"));
            });

            it("THEN the pool has all the previous deposits intact (300 total)", async () => {
              expect(mp.supplied).to.eq(parseUnits("300"));
            });

            describe("AND GIVEN that someone repays again for 40", () => {
              let mp: any;
              beforeEach(async () => {
                await poolEnv.repay(fakeMaturityPool, "40");
                mp = await poolEnv.mpHarness.maturityPool();
              });

              it("THEN the pool 'earningsSP' is 0", async () => {
                expect(mp.earningsSP).to.eq(0);
              });

              it("THEN the pool 'unassignedEarnings' at maturity are 0", async () => {
                expect(mp.unassignedEarnings).to.eq(0);
              });

              it("THEN the pool 'lastEarningsSP' is 40", async () => {
                expect(await poolEnv.mpHarness.lastEarningsSP()).to.eq(
                  parseUnits("40") // SP receives it all
                );
              });

              it("THEN the pool 'suppliedSP' is 0", async () => {
                expect(mp.suppliedSP).to.eq(parseUnits("0"));
              });

              it("THEN the pool has all the previous deposits intact (300 total)", async () => {
                expect(mp.supplied).to.eq(parseUnits("300"));
              });
            });

            describe("AND GIVEN that someone withdraws 300", () => {
              let mp: any;
              beforeEach(async () => {
                await poolEnv.takeMoney("300");
                mp = await poolEnv.mpHarness.maturityPool();
              });

              it("THEN the pool 'supplied' - 'borrowed' equals 0 (everything is 0)", async () => {
                expect(mp.supplied - mp.borrowed).to.eq(0);
                expect(mp.suppliedSP).to.eq(0);
              });
            });
          });
        });
      });
    });
  });

  describe("GIVEN that Walter deposits 60000 DAI in the Smart Pool AND 10% penalty rate", () => {
    beforeEach(async () => {
      defaultEnv = await ExactlyEnv.create({});
      [, juana, cindy, walter] = await ethers.getSigners();
      await defaultEnv.transfer("ETH", juana, "200");
      await defaultEnv.transfer("DAI", juana, "200");
      await defaultEnv.transfer("DAI", cindy, "3000");
      await defaultEnv.transfer("DAI", walter, "60000");
      await defaultEnv
        .getInterestRateModel()
        .setPenaltyRate(parseUnits("0.06"));

      defaultEnv.switchWallet(walter);
      await defaultEnv.depositSP("DAI", "60000");
      defaultEnv.switchWallet(juana);
      await defaultEnv.depositMP("ETH", exaTime.nextPoolID(), "100");
      await defaultEnv.enterMarkets(["ETH"], exaTime.nextPoolID());
    });

    describe("WHEN Juana borrows 4000 DAI in the next maturity pool", () => {
      beforeEach(async () => {
        defaultEnv.switchWallet(juana);
        await defaultEnv.borrowMP("DAI", exaTime.nextPoolID(), "4000");
      });

      it("THEN the debt of the smart pool is 4000", async () => {
        const mp = await defaultEnv.maturityPool("DAI", exaTime.nextPoolID());
        const borrowSP = await defaultEnv
          .getFixedLender("DAI")
          .smartPoolBorrowed();
        expect(mp.suppliedSP).to.equal(parseUnits("4000"));
        expect(borrowSP).to.equal(parseUnits("4000"));
      });

      describe("AND WHEN Cindy deposits 3000", () => {
        beforeEach(async () => {
          defaultEnv.switchWallet(cindy);
          await defaultEnv.depositMP("DAI", exaTime.nextPoolID(), "3000");
        });

        describe("AND WHEN Juana repays 4000 at maturity", () => {
          beforeEach(async () => {
            defaultEnv.switchWallet(juana);
            await defaultEnv.moveInTime(exaTime.nextPoolID());
            await defaultEnv.repayMP("DAI", exaTime.nextPoolID(), "4000");
          });

          it("THEN the debt of the smart pool is back to 0", async () => {
            const mp = await defaultEnv.maturityPool(
              "DAI",
              exaTime.nextPoolID()
            );
            const borrowSP = await defaultEnv
              .getFixedLender("DAI")
              .smartPoolBorrowed();
            expect(mp.suppliedSP).to.equal(0);
            expect(borrowSP).to.equal(0);
          });
        });

        describe("AND Juana repays 2000 at maturity", () => {
          beforeEach(async () => {
            defaultEnv.switchWallet(juana);
            await defaultEnv.moveInTime(exaTime.nextPoolID());
            await defaultEnv.repayMP("DAI", exaTime.nextPoolID(), "2000");
          });

          it("THEN the debt of the smart pool is 2000", async () => {
            const mp = await defaultEnv.maturityPool(
              "DAI",
              exaTime.nextPoolID()
            );
            const borrowSP = await defaultEnv
              .getFixedLender("DAI")
              .smartPoolBorrowed();
            expect(mp.suppliedSP).to.equal(parseUnits("2000"));
            expect(borrowSP).to.equal(parseUnits("2000"));
          });

          describe("AND Juana repays another 2000 at maturity", () => {
            beforeEach(async () => {
              defaultEnv.switchWallet(juana);
              await defaultEnv.repayMP("DAI", exaTime.nextPoolID(), "2000");
            });

            it("THEN the debt of the smart pool is 0", async () => {
              const mp = await defaultEnv.maturityPool(
                "DAI",
                exaTime.nextPoolID()
              );
              expect(mp.suppliedSP).to.equal(0);
            });
          });
        });
      });
    });

    describe("WHEN Cindy deposits 3000", () => {
      beforeEach(async () => {
        defaultEnv.switchWallet(cindy);
        await defaultEnv.depositMP("DAI", exaTime.nextPoolID(), "3000");
      });

      describe("AND Juana borrows 4000 at maturity", () => {
        beforeEach(async () => {
          defaultEnv.switchWallet(juana);
          await defaultEnv.borrowMP("DAI", exaTime.nextPoolID(), "4000");
        });

        it("THEN the debt of the smart pool is to 1000", async () => {
          const mp = await defaultEnv.maturityPool("DAI", exaTime.nextPoolID());
          expect(mp.suppliedSP).to.equal(parseUnits("1000"));
        });

        describe("AND Cindy withdraws 3000 at maturity", () => {
          beforeEach(async () => {
            defaultEnv.switchWallet(cindy);
            await defaultEnv.moveInTime(exaTime.nextPoolID());
            await defaultEnv.withdrawMP("DAI", exaTime.nextPoolID(), "3000");
          });

          it("THEN the debt of the smart pool is to 4000", async () => {
            const mp = await defaultEnv.maturityPool(
              "DAI",
              exaTime.nextPoolID()
            );
            expect(mp.suppliedSP).to.equal(parseUnits("4000"));
          });
        });

        describe("AND Juana repays 4000 at maturity", () => {
          beforeEach(async () => {
            defaultEnv.switchWallet(juana);
            await defaultEnv.moveInTime(exaTime.nextPoolID());
            await defaultEnv.repayMP("DAI", exaTime.nextPoolID(), "4000");
          });

          it("THEN the debt of the smart pool is back to 0", async () => {
            const mp = await defaultEnv.maturityPool(
              "DAI",
              exaTime.nextPoolID()
            );
            expect(mp.suppliedSP).to.equal(0);
          });
        });

        describe("AND Juana repays 3000 at maturity", () => {
          beforeEach(async () => {
            defaultEnv.switchWallet(juana);
            await defaultEnv.moveInTime(exaTime.nextPoolID());
            await defaultEnv.repayMP("DAI", exaTime.nextPoolID(), "3000");
          });

          it("THEN the debt of the smart pool is still 1000", async () => {
            const mp = await defaultEnv.maturityPool(
              "DAI",
              exaTime.nextPoolID()
            );
            expect(mp.suppliedSP).to.equal(parseUnits("1000"));
          });

          describe("AND Juana repays another 1000 one(1) day after maturity", () => {
            let tx: any;
            beforeEach(async () => {
              defaultEnv.switchWallet(juana);
              await defaultEnv.moveInTime(
                exaTime.nextPoolID() + exaTime.ONE_DAY
              );
              tx = defaultEnv.repayMP("DAI", exaTime.nextPoolID(), "1000");
            });

            it("THEN the debt of the smart pool is 0", async () => {
              await tx;
              const mp = await defaultEnv.maturityPool(
                "DAI",
                exaTime.nextPoolID()
              );
              expect(mp.suppliedSP).to.equal(0);
            });

            it("THEN Juana didn't get to cover the penalties", async () => {
              await expect(tx)
                .to.emit(defaultEnv.getEToken("DAI"), "EarningsAccrued")
                .withArgs(0);
            });

            describe("AND Juana repays another 60 one(1) day after maturity for penalties", () => {
              let tx2: any;
              beforeEach(async () => {
                await tx;
                defaultEnv.switchWallet(juana);
                tx2 = defaultEnv.repayMP("DAI", exaTime.nextPoolID(), "60");
              });

              it("THEN the debt of the smart pool is 0", async () => {
                await tx2;
                const mp = await defaultEnv.maturityPool(
                  "DAI",
                  exaTime.nextPoolID()
                );
                expect(mp.suppliedSP).to.equal(0);
              });

              it("THEN Juana got to cover her penalties", async () => {
                await expect(tx2)
                  .to.emit(defaultEnv.getEToken("DAI"), "EarningsAccrued")
                  .withArgs(parseUnits("60"));
              });
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
