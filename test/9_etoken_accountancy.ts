import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("EToken accounting (mint, burn & accrueEarnings)", () => {
  let bob: SignerWithAddress;
  let laura: SignerWithAddress;
  let tito: SignerWithAddress;
  let eDAI: Contract;

  const { AddressZero } = ethers.constants;

  beforeEach(async () => {
    [bob, laura, tito] = await ethers.getSigners();

    const MockEToken = await ethers.getContractFactory("EToken");
    eDAI = await MockEToken.deploy("eFake DAI", "eFDAI", 18);
    await eDAI.deployed();
  });

  describe("GIVEN an already initialized eDAI", () => {
    beforeEach(async () => {
      // We simulate that the address of user bob is the fixedLender and the auditor contract (auditor is not relevant because we are not testing transfers here)
      await eDAI.initialize(bob.address, bob.address);
    });
    it("THEN it should revert with CONTRACT_ALREADY_INITIALIZED error when trying to set again", async () => {
      await expect(eDAI.initialize(laura.address, laura.address)).to.be.revertedWith("AlreadyInitialized()");
    });
    it("AND WHEN trying to initialize from third parties, THEN it should revert with AccessControl error", async () => {
      await expect(eDAI.connect(laura).initialize(laura.address, AddressZero)).to.be.revertedWith("AccessControl");
    });
    describe("AND GIVEN bob mints 1000 eDAI", () => {
      beforeEach(async () => {
        await eDAI.mint(bob.address, parseUnits("1000"));
      });

      it("THEN balance of eDAI in bob's address is 1000", async () => {
        let bobBalance = await eDAI.balanceOf(bob.address);

        expect(bobBalance).to.equal(parseUnits("1000"));
      });
      it("THEN balance of eDAI in laura's address is 0", async () => {
        let lauraBalance = await eDAI.balanceOf(laura.address);

        expect(lauraBalance).to.equal(parseUnits("0"));
      });
      it("THEN total supply in contract is 1000", async () => {
        let totalSupply = await eDAI.totalSupply();

        expect(totalSupply).to.equal(parseUnits("1000"));
      });
      it("AND WHEN bob mints 100 eDAI more, THEN his balance increases & event Transfer is emitted", async () => {
        await expect(await eDAI.mint(bob.address, parseUnits("100"))).to.emit(eDAI, "Transfer");
        let bobBalance = await eDAI.balanceOf(bob.address);

        expect(bobBalance).to.equal(parseUnits("1100"));
      });
      describe("AND GIVEN an accrue of earnings by 1000 eDAI", () => {
        beforeEach(async () => {
          await eDAI.accrueEarnings(parseUnits("1000"));
        });
        it("THEN total supply in contract is 2000", async () => {
          let totalSupply = await eDAI.totalSupply();

          expect(totalSupply).to.equal(parseUnits("2000"));
        });
        it("THEN balance of eDAI in bob's address is 2000", async () => {
          let bobBalance = await eDAI.balanceOf(bob.address);

          expect(bobBalance).to.equal(parseUnits("2000"));
        });
        describe("AND GIVEN laura mints 1000 eDAI", () => {
          beforeEach(async () => {
            await eDAI.mint(laura.address, parseUnits("1000"));
          });
          it("THEN balance of laura is still 1000", async () => {
            let lauraBalance = await eDAI.balanceOf(laura.address);

            expect(lauraBalance).to.equal(parseUnits("1000"));
          });
          describe("AND GIVEN an accrue of earnings by 600 eDAI", () => {
            beforeEach(async () => {
              await eDAI.accrueEarnings(parseUnits("600"));
            });

            it("THEN total supply in contract is 3600", async () => {
              let totalSupply = await eDAI.totalSupply();

              expect(totalSupply).to.equal(parseUnits("3600"));
            });
            it("THEN balance of eDAI in bob's address is 2400", async () => {
              let bobBalance = await eDAI.balanceOf(bob.address);

              expect(bobBalance).to.equal(parseUnits("2400"));
            });
            it("THEN balance of eDAI in laura's address is 1200", async () => {
              let lauraBalance = await eDAI.balanceOf(laura.address);

              expect(lauraBalance).to.equal(parseUnits("1200"));
            });
          });
        });
      });
      describe("AND GIVEN laura mints 1000 eDAI", () => {
        beforeEach(async () => {
          await eDAI.mint(laura.address, parseUnits("1000"));
        });
        it("THEN balance of eDAI in laura's address is 1000", async () => {
          let lauraBalance = await eDAI.balanceOf(laura.address);

          expect(lauraBalance).to.be.closeTo(parseUnits("1000"), 1);
        });
        it("THEN balance of eDAI in bob's address is still 1000", async () => {
          let bobBalance = await eDAI.balanceOf(bob.address);

          expect(bobBalance).to.equal(parseUnits("1000"));
        });
        it("THEN total supply in contract is 2000", async () => {
          let totalSupply = await eDAI.totalSupply();

          expect(totalSupply).to.equal(parseUnits("2000"));
        });
        describe("AND GIVEN an accrue of earnings by 500 eDAI", () => {
          beforeEach(async () => {
            await eDAI.accrueEarnings(parseUnits("500"));
          });
          it("THEN total supply in contract is 2500", async () => {
            let totalSupply = await eDAI.totalSupply();

            expect(totalSupply).to.equal(parseUnits("2500"));
          });
          it("THEN balance of eDAI in laura's address is 1250", async () => {
            let lauraBalance = await eDAI.balanceOf(laura.address);

            expect(lauraBalance).to.equal(parseUnits("1250"));
          });
          it("THEN balance of eDAI in bob's address is 1250", async () => {
            let bobBalance = await eDAI.balanceOf(bob.address);

            expect(bobBalance).to.equal(parseUnits("1250"));
          });
          it("AND WHEN an accrue of earnings is made, THEN event EarningsAccrued is emitted", async () => {
            let earningsAmount = parseUnits("100");
            await expect(await eDAI.accrueEarnings(earningsAmount))
              .to.emit(eDAI, "EarningsAccrued")
              .withArgs(earningsAmount);
          });
          describe("AND GIVEN bob burns 625 eDAI", () => {
            beforeEach(async () => {
              await eDAI.burn(bob.address, parseUnits("625"));
            });
            it("THEN balance of eDAI in bob's address is 625", async () => {
              let bobBalance = await eDAI.balanceOf(bob.address);

              expect(bobBalance).to.equal(parseUnits("625"));
            });
            it("THEN total supply in contract is 1875", async () => {
              let totalSupply = await eDAI.totalSupply();

              expect(totalSupply).to.equal(parseUnits("1875"));
            });
            it("AND WHEN bob burns 625 eDAI more, THEN his balance is 0", async () => {
              await eDAI.burn(bob.address, parseUnits("625"));
              let bobBalance = await eDAI.balanceOf(bob.address);

              expect(bobBalance).to.equal(parseUnits("0"));
            });
            it("AND WHEN bob burns more than his balance, THEN it reverts with error ERC20 burn error", async () => {
              await expect(eDAI.burn(bob.address, parseUnits("1000"))).to.be.revertedWith("ERC20: balance exceeded");
            });
            it("AND WHEN another burn is made, THEN event Transfer is emitted", async () => {
              await expect(await eDAI.burn(laura.address, parseUnits("100"))).to.emit(eDAI, "Transfer");
            });
            describe("AND GIVEN tito mints 1250 eDAI", () => {
              beforeEach(async () => {
                await eDAI.mint(tito.address, parseUnits("1250"));
              });
              describe("AND GIVEN an accrue of earnings by 1000 eDAI", () => {
                beforeEach(async () => {
                  await eDAI.accrueEarnings(parseUnits("1000"));
                });
                it("THEN total supply in contract is 4125", async () => {
                  let totalSupply = await eDAI.totalSupply();

                  expect(totalSupply).to.equal(parseUnits("4125"));
                });
                it("THEN balance of eDAI in tito's and laura's address is 1650", async () => {
                  let titoBalance = await eDAI.balanceOf(tito.address);
                  let lauraBalance = await eDAI.balanceOf(laura.address);

                  expect(titoBalance).to.equal(parseUnits("1650"));
                  expect(lauraBalance).to.equal(parseUnits("1650"));
                });
                it("THEN balance of eDAI in bob's address is 825", async () => {
                  let bobBalance = await eDAI.balanceOf(bob.address);

                  expect(bobBalance).to.equal(parseUnits("825"));
                });
              });
            });
          });
        });
      });
    });
    describe("AND GIVEN a mint from the zero address", () => {
      it("THEN it reverts with an ERC20 mint error", async () => {
        await expect(eDAI.mint(AddressZero, parseUnits("100"))).to.be.revertedWith("ERC20: zero address");
      });
      it("THEN balance of address should return zero if never minted", async () => {
        let userBalance = await eDAI.balanceOf(AddressZero);

        expect(userBalance).to.equal("0");
      });
    });
  });

  describe("GIVEN a not initialized eDAI", () => {
    it("THEN it should emit Initialized event when initialized", async () => {
      await expect(await eDAI.initialize(bob.address, bob.address)).to.emit(eDAI, "Initialized");
    });
    it("WHEN initialized with only a fixedLender address it should be able to be called again", async () => {
      await eDAI.initialize(bob.address, AddressZero);
      await expect(eDAI.initialize(bob.address, bob.address)).to.not.be.reverted;
    });
    it("WHEN initialized with only an auditor address it should be able to be called again", async () => {
      await eDAI.initialize(AddressZero, bob.address);
      await expect(eDAI.initialize(bob.address, bob.address)).to.not.be.reverted;
    });
  });

  describe("GIVEN function calls not being the FixedLender contract", () => {
    it("AND invoking mint, THEN it should revert with error CALLER_MUST_BE_FIXED_LENDER", async () => {
      await expect(eDAI.connect(laura).mint(laura.address, "100")).to.be.revertedWith("NotFixedLender()");
    });
    it("AND invoking accrueEarnings, THEN it should revert with error CALLER_MUST_BE_FIXED_LENDER", async () => {
      await expect(eDAI.connect(laura).accrueEarnings("100")).to.be.revertedWith("NotFixedLender()");
    });
    it("AND invoking burn, THEN it should revert with error CALLER_MUST_BE_FIXED_LENDER", async () => {
      await expect(eDAI.connect(laura).burn(laura.address, "100")).to.be.revertedWith("NotFixedLender()");
    });
  });
});
