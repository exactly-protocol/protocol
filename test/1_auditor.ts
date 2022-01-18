import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, formatUnits } from "@ethersproject/units";
import { Contract } from "ethers";
import { BigNumber } from "@ethersproject/bignumber";
import {
  ProtocolError,
  ExactlyEnv,
  ExaTime,
  errorGeneric,
  applyMinFee,
  applyMaxFee,
} from "./exactlyUtils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DefaultEnv } from "./defaultEnv";

describe("Auditor from User Space", function () {
  let auditor: Contract;
  let exactlyEnv: DefaultEnv;
  let nextPoolID: number;

  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  let snapshot: any;

  beforeEach(async () => {
    snapshot = await ethers.provider.send("evm_snapshot", []);

    [owner, user] = await ethers.getSigners();

    exactlyEnv = await ExactlyEnv.create({});
    auditor = exactlyEnv.auditor;
    nextPoolID = new ExaTime().nextPoolID();

    // From Owner to User
    await exactlyEnv
      .getUnderlying("DAI")
      .transfer(user.address, parseUnits("100000"));
  });

  it("We try to enter an unlisted market and fail", async () => {
    await expect(
      auditor.enterMarkets([exactlyEnv.notAnFixedLenderAddress])
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("We enter market twice without failing", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await auditor.enterMarkets([fixedLenderDAI.address]);
    let tx = auditor.enterMarkets([fixedLenderDAI.address]);

    await expect(tx).to.not.to.emit(auditor, "MarketEntered");
    await expect(tx).to.not.be.reverted;
  });

  it("EnterMarkets should emit event", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");

    await expect(auditor.enterMarkets([fixedLenderDAI.address]))
      .to.emit(auditor, "MarketEntered")
      .withArgs(fixedLenderDAI.address, owner.address);
  });

  it("ExitMarket should emit event", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await auditor.enterMarkets([fixedLenderDAI.address]);

    await expect(auditor.exitMarket(fixedLenderDAI.address))
      .to.emit(auditor, "MarketExited")
      .withArgs(fixedLenderDAI.address, owner.address);
  });

  it("We try to exit an unlisted market and fail", async () => {
    await expect(
      auditor.exitMarket(exactlyEnv.notAnFixedLenderAddress)
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("BeforeDepositSP should fail for an unlisted market", async () => {
    await expect(
      auditor.beforeDepositSP(exactlyEnv.notAnFixedLenderAddress, owner.address)
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("BeforeWithdrawSP should fail for an unlisted market", async () => {
    await expect(
      auditor.beforeWithdrawSP(
        exactlyEnv.notAnFixedLenderAddress,
        owner.address,
        "0"
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("BeforeDepositMP should fail for an unlisted market", async () => {
    await expect(
      auditor.beforeDepositMP(
        exactlyEnv.notAnFixedLenderAddress,
        owner.address,
        nextPoolID
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("BeforeTransferSP should fail for an unlisted market", async () => {
    await expect(
      auditor.beforeTransferSP(
        exactlyEnv.notAnFixedLenderAddress,
        owner.address,
        owner.address,
        "0"
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("BorrowAllowed should fail for an unlisted market", async () => {
    await expect(
      auditor.beforeBorrowMP(
        exactlyEnv.notAnFixedLenderAddress,
        owner.address,
        nextPoolID
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("validateBorrowMP should fail for when oracle gets weird", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await auditor.enterMarkets([fixedLenderDAI.address]);

    await exactlyEnv.oracle.setPrice("DAI", 0);
    await expect(
      auditor.validateBorrowMP(fixedLenderDAI.address, owner.address)
    ).to.be.revertedWith(errorGeneric(ProtocolError.PRICE_ERROR));
  });

  it("BeforeWithdrawMP should fail for an unlisted market", async () => {
    await expect(
      auditor.beforeWithdrawMP(
        exactlyEnv.notAnFixedLenderAddress,
        owner.address,
        nextPoolID
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("BeforeRepayMP should fail for an unlisted market", async () => {
    await expect(
      auditor.beforeRepayMP(
        exactlyEnv.notAnFixedLenderAddress,
        owner.address,
        nextPoolID
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("SeizeAllowed should fail for an unlisted market", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await expect(
      auditor.seizeAllowed(
        exactlyEnv.notAnFixedLenderAddress,
        fixedLenderDAI.address,
        owner.address,
        user.address
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  it("SeizeAllowed should fail when liquidator is borrower", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await expect(
      auditor.seizeAllowed(
        fixedLenderDAI.address,
        fixedLenderDAI.address,
        owner.address,
        owner.address
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.LIQUIDATOR_NOT_BORROWER));
  });

  it("LiquidateAllowed should fail for unlisted markets", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await expect(
      auditor.liquidateAllowed(
        exactlyEnv.notAnFixedLenderAddress,
        fixedLenderDAI.address,
        owner.address,
        user.address,
        100
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
    await expect(
      auditor.liquidateAllowed(
        fixedLenderDAI.address,
        exactlyEnv.notAnFixedLenderAddress,
        owner.address,
        user.address,
        100
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
    await expect(
      auditor.liquidateAllowed(
        fixedLenderDAI.address,
        fixedLenderDAI.address,
        owner.address,
        user.address,
        100
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.INSUFFICIENT_SHORTFALL)); // Any failure except MARKET_NOT_LISTED
  });

  it("Autoadding a market should only be allowed from a fixedLender", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    const dai = exactlyEnv.getUnderlying("DAI");

    // we supply Dai to the protocol
    const amountDAI = parseUnits("100");
    await dai.approve(fixedLenderDAI.address, amountDAI);
    await fixedLenderDAI.depositToSmartPool(amountDAI);

    // we make it count as collateral (DAI)
    await expect(
      auditor.validateBorrowMP(fixedLenderDAI.address, owner.address)
    ).to.be.revertedWith(errorGeneric(ProtocolError.NOT_A_FIXED_LENDER_SENDER));
  });

  it("SetBorrowCap should emit event", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await expect(
      auditor.setMarketBorrowCaps([fixedLenderDAI.address], [10])
    ).to.emit(auditor, "NewBorrowCap");
  });

  it("SetBorrowCap should block borrowing more than the cap on a listed market", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await auditor.setMarketBorrowCaps([fixedLenderDAI.address], [10]);
    await exactlyEnv.depositSP("DAI", "100");

    await expect(
      // user tries to borrow more than the cap
      fixedLenderDAI.borrowFromMaturityPool(
        20,
        nextPoolID,
        applyMaxFee(BigNumber.from(20))
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_BORROW_CAP_REACHED));
  });

  it("LiquidateCalculateSeizeAmount should fail when oracle is acting weird", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    await exactlyEnv.setOracleMockPrice("DAI", "0");
    await expect(
      auditor.liquidateCalculateSeizeAmount(
        fixedLenderDAI.address,
        fixedLenderDAI.address,
        100
      )
    ).to.be.revertedWith(errorGeneric(ProtocolError.PRICE_ERROR));
  });

  it("Future pools should match JS generated ones", async () => {
    let exaTime = new ExaTime();
    let poolsInContract = await auditor.callStatic.getFuturePools();
    let poolsInJS = exaTime.futurePools().map((item) => BigNumber.from(item));
    for (let i = 0; i < exaTime.MAX_POOLS; i++) {
      expect(poolsInContract[i]).to.be.equal(poolsInJS[i]);
    }
  });

  it("we deposit dai & eth to the protocol and we use them both for collateral to take a loan", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    const dai = exactlyEnv.getUnderlying("DAI");

    // we supply Dai to the protocol
    const amountDAI = parseUnits("100");
    await dai.approve(fixedLenderDAI.address, amountDAI);
    await fixedLenderDAI.depositToSmartPool(amountDAI);

    expect(await dai.balanceOf(fixedLenderDAI.address)).to.equal(amountDAI);

    // we make it count as collateral (DAI)
    await auditor.enterMarkets([fixedLenderDAI.address]);

    const fixedLenderETH = exactlyEnv.getFixedLender("ETH");
    const eth = exactlyEnv.getUnderlying("ETH");

    // we supply Eth to the protocol
    const amountETH = parseUnits("1");
    await eth.approve(fixedLenderETH.address, amountETH);
    await fixedLenderETH.depositToSmartPool(amountETH);

    expect(await eth.balanceOf(fixedLenderETH.address)).to.equal(amountETH);

    // we make it count as collateral (ETH)
    await auditor.enterMarkets([fixedLenderETH.address]);

    let liquidity = (await auditor.getAccountLiquidity(owner.address))[0];

    let collaterDAI = amountDAI
      .mul(exactlyEnv.mockedTokens.get("DAI")!.collateralRate)
      .div(parseUnits("1"))
      .mul(exactlyEnv.mockedTokens.get("DAI")!.usdPrice)
      .div(parseUnits("1"));

    let collaterETH = amountETH
      .mul(exactlyEnv.mockedTokens.get("ETH")!.collateralRate)
      .div(parseUnits("1"))
      .mul(exactlyEnv.mockedTokens.get("ETH")!.usdPrice)
      .div(parseUnits("1"));

    expect(parseFloat(await formatUnits(liquidity))).to.be.equal(
      parseFloat(formatUnits(collaterDAI.add(collaterETH)))
    );
  });

  it("Contract's state variable accountAssets should correctly add and remove the asset which the user entered and exited as collateral", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    const fixedLenderETH = exactlyEnv.getFixedLender("ETH");
    await auditor.enterMarkets([
      fixedLenderDAI.address,
      fixedLenderETH.address,
    ]);

    await expect(auditor.exitMarket(fixedLenderDAI.address)).to.not.be.reverted;
    await expect(auditor.exitMarket(fixedLenderETH.address)).to.not.be.reverted;
  });

  it("Auditor reverts if Oracle acts weird", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    const dai = exactlyEnv.getUnderlying("DAI");

    // we supply Dai to the protocol
    const amountDAI = parseUnits("100");
    await dai.approve(fixedLenderDAI.address, amountDAI);
    await fixedLenderDAI.depositToMaturityPool(
      amountDAI,
      nextPoolID,
      applyMinFee(amountDAI)
    );

    // we make it count as collateral (DAI)
    await auditor.enterMarkets([fixedLenderDAI.address]);

    await exactlyEnv.oracle.setPrice("DAI", 0);
    await expect(auditor.getAccountLiquidity(owner.address)).to.revertedWith(
      errorGeneric(ProtocolError.PRICE_ERROR)
    );
  });

  it("Get data from correct market", async () => {
    const fixedLenderDAI = exactlyEnv.getFixedLender("DAI");
    const [symbol, name, isListed, collateralFactor, decimals] =
      await auditor.getMarketData(fixedLenderDAI.address);

    expect(formatUnits(collateralFactor)).to.be.equal("0.8");
    expect(symbol).to.be.equal("DAI");
    expect(name).to.be.equal("DAI");
    expect(isListed).to.be.equal(true);
    expect(decimals).to.be.equal(18);
  });

  it("Try to get data from wrong address", async () => {
    await expect(
      auditor.getMarketData(exactlyEnv.notAnFixedLenderAddress)
    ).to.be.revertedWith(errorGeneric(ProtocolError.MARKET_NOT_LISTED));
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshot]);
    await ethers.provider.send("evm_mine", []);
  });
});
