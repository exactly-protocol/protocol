import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits } from "@ethersproject/units";
import { BigNumber, Contract } from "ethers";
import {
  ProtocolError,
  ExactlyEnv,
  ExaTime,
  errorGeneric,
  DefaultEnv,
} from "./exactlyUtils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Liquidations", function () {
  let auditor: Contract;
  let exactlyEnv: DefaultEnv;
  let nextPoolID = new ExaTime().nextPoolID();

  let bob: SignerWithAddress;
  let alice: SignerWithAddress;

  let fixedLenderETH: Contract;
  let eth: Contract;
  let fixedLenderDAI: Contract;
  let dai: Contract;
  let fixedLenderWBTC: Contract;
  let wbtc: Contract;

  let mockedTokens = new Map([
    [
      "DAI",
      {
        decimals: 18,
        collateralRate: parseUnits("0.8"),
        usdPrice: parseUnits("1"),
      },
    ],
    [
      "ETH",
      {
        decimals: 18,
        collateralRate: parseUnits("0.7"),
        usdPrice: parseUnits("3000"),
      },
    ],
    [
      "WBTC",
      {
        decimals: 8,
        collateralRate: parseUnits("0.6"),
        usdPrice: parseUnits("63000"),
      },
    ],
  ]);

  let amountToBorrowDAI: BigNumber;
  let owedDAI: BigNumber;

  let snapshot: any;
  beforeEach(async () => {
    snapshot = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    [alice, bob] = await ethers.getSigners();

    exactlyEnv = await ExactlyEnv.create(mockedTokens);
    auditor = exactlyEnv.auditor;

    fixedLenderETH = exactlyEnv.getFixedLender("ETH");
    eth = exactlyEnv.getUnderlying("ETH");
    fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    dai = exactlyEnv.getUnderlying("DAI");
    fixedLenderWBTC = exactlyEnv.getFixedLender("WBTC");
    wbtc = exactlyEnv.getUnderlying("WBTC");

    // From alice to bob
    await dai.transfer(bob.address, parseUnits("100000"));
  });

  describe("GIVEN alice supplies USD63k worth of WBTC, USD3k worth of ETH (66k total) AND bob supplies 65kDAI", () => {
    beforeEach(async () => {
      // we supply Eth to the protocol
      const amountETH = parseUnits("1");
      await eth.approve(fixedLenderETH.address, amountETH);
      await fixedLenderETH.supply(alice.address, amountETH, nextPoolID);

      // we supply WBTC to the protocol
      const amountWBTC = parseUnits("1", 8);
      await wbtc.approve(fixedLenderWBTC.address, amountWBTC);
      await fixedLenderWBTC.supply(alice.address, amountWBTC, nextPoolID);

      // bob supplies DAI to the protocol to have money in the pool
      const amountDAI = parseUnits("65000");
      await dai.connect(bob).approve(fixedLenderDAI.address, amountDAI);
      await fixedLenderDAI
        .connect(bob)
        .supply(bob.address, amountDAI, nextPoolID);
    });

    describe("AND GIVEN Alice takes the biggest loan she can (39850 DAI), collaterallization 1.65", () => {
      beforeEach(async () => {
        // we make ETH & WBTC count as collateral
        await auditor.enterMarkets(
          [fixedLenderETH.address, fixedLenderWBTC.address],
          nextPoolID
        );
        // this works because 1USD (liquidity) = 1DAI (asset to borrow)
        amountToBorrowDAI = parseUnits("39850");

        // alice borrows all liquidity
        await fixedLenderDAI.borrow(amountToBorrowDAI, nextPoolID);
        [, owedDAI] = await fixedLenderDAI.getAccountSnapshot(
          alice.address,
          nextPoolID
        );
      });
      describe("AND GIVEN ETH price halves (Alices collateral goes from 66k to 38.5k), collaterallization: 0.96", () => {
        beforeEach(async () => {
          await exactlyEnv.setOracleMockPrice("WBTC", "32500");
        });

        it("THEN alices liquidity is zero", async () => {
          // We expect liquidity to be equal to zero
          let liquidityAfterOracleChange = (
            await auditor.getAccountLiquidity(alice.address, nextPoolID)
          )[0];
          expect(liquidityAfterOracleChange).to.be.lt("1");
        });
        it("AND alice has a liquidity shortfall", async () => {
          let shortfall = (
            await auditor.getAccountLiquidity(alice.address, nextPoolID)
          )[1];
          expect(shortfall).to.be.gt(0);
        });
        it("AND trying to repay an amount of zero fails", async () => {
          // We try to get all the ETH we can
          // We expect trying to repay zero to fail
          await expect(
            fixedLenderDAI.liquidate(
              alice.address,
              0,
              fixedLenderETH.address,
              nextPoolID
            )
          ).to.be.revertedWith(errorGeneric(ProtocolError.REPAY_ZERO));
        });
        it("AND the position cant be liquidated by the borrower", async () => {
          // We expect self liquidation to fail
          await expect(
            fixedLenderDAI.liquidate(
              alice.address,
              owedDAI,
              fixedLenderETH.address,
              nextPoolID
            )
          ).to.be.revertedWith(
            errorGeneric(ProtocolError.LIQUIDATOR_NOT_BORROWER)
          );
        });

        describe("GIVEN an insufficient allowance on the liquidator", () => {
          beforeEach(async () => {
            await dai
              .connect(bob)
              .approve(fixedLenderDAI.address, owedDAI.div(2).sub(100000));
          });
          it("WHEN trying to liquidate, THEN it reverts with a ERC20 transfer error", async () => {
            // We expect liquidation to fail because trying to liquidate
            // and take over a collateral that bob doesn't have enough
            await expect(
              fixedLenderDAI
                .connect(bob)
                .liquidate(
                  alice.address,
                  owedDAI.div(2).sub(100),
                  fixedLenderETH.address,
                  nextPoolID
                )
            ).to.be.revertedWith("ERC20");
          });
        });

        describe("GIVEN a sufficient allowance on the liquidator", () => {
          beforeEach(async () => {
            await dai
              .connect(bob)
              .approve(fixedLenderDAI.address, owedDAI.mul(1000));
          });
          it("WHEN trying to liquidate 39850 DAI for ETH (of which there is only 3000usd), THEN it reverts with a TOKENS_MORE_THAN_BALANCE error", async () => {
            // We expect liquidation to fail because trying to liquidate
            // and take over a collateral that bob doesn't have enough
            await expect(
              fixedLenderDAI
                .connect(bob)
                .liquidate(
                  alice.address,
                  owedDAI.div(2).sub(100),
                  fixedLenderETH.address,
                  nextPoolID
                )
            ).to.be.revertedWith(
              errorGeneric(ProtocolError.TOKENS_MORE_THAN_BALANCE)
            );
          });
          it("WHEN liquidating slightly more than the close factor(0.5), THEN it reverts", async () => {
            // We expect liquidation to fail because trying to liquidate too much (more than close factor of the borrowed asset)
            await expect(
              fixedLenderDAI
                .connect(bob)
                .liquidate(
                  alice.address,
                  owedDAI.div(2).add(1000),
                  fixedLenderWBTC.address,
                  nextPoolID
                )
            ).to.be.revertedWith(errorGeneric(ProtocolError.TOO_MUCH_REPAY));
          });
          it("AND WHEN liquidating slightly more than the close factor, THEN it succeeds", async () => {
            let closeToMaxRepay = owedDAI
              .mul(parseUnits("0.3"))
              .div(parseUnits("1"))
              .sub(100000);
            await fixedLenderDAI
              .connect(bob)
              .liquidate(
                alice.address,
                closeToMaxRepay,
                fixedLenderWBTC.address,
                nextPoolID
              );
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
