import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { Auditor, ETHFixedLender, FixedLender, MockChainlinkFeedRegistry, MockToken, WETH } from "../types";
import timelockExecute from "./utils/timelockExecute";
import futurePools from "./utils/futurePools";
import USD_ADDRESS from "./utils/USD_ADDRESS";

const {
  utils: { parseUnits },
  getUnnamedSigners,
  getNamedSigner,
  getContract,
} = ethers;

describe("Auditor from User Space", function () {
  let dai: MockToken;
  let weth: WETH;
  let auditor: Auditor;
  let feedRegistry: MockChainlinkFeedRegistry;
  let fixedLenderDAI: FixedLender;
  let fixedLenderWETH: ETHFixedLender;

  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    owner = await getNamedSigner("multisig");
    [user] = await getUnnamedSigners();
  });

  beforeEach(async () => {
    await deployments.fixture(["Markets"]);

    dai = await getContract<MockToken>("DAI", user);
    weth = await getContract<WETH>("WETH", user);
    auditor = await getContract<Auditor>("Auditor", user);
    feedRegistry = await getContract<MockChainlinkFeedRegistry>("FeedRegistry", user);
    fixedLenderDAI = await getContract<FixedLender>("FixedLenderDAI", user);
    fixedLenderWETH = await getContract<ETHFixedLender>("FixedLenderWETH", user);

    await dai.connect(owner).transfer(user.address, parseUnits("100000"));
  });

  it("We enter market twice without failing", async () => {
    await auditor.enterMarkets([fixedLenderDAI.address]);
    await expect(auditor.enterMarkets([fixedLenderDAI.address])).to.not.be.reverted.and.to.not.emit(
      auditor,
      "MarketEntered",
    );
  });

  it("We enter WETH market (market index 1) twice without failing", async () => {
    await auditor.enterMarkets([fixedLenderWETH.address]);
    await expect(auditor.enterMarkets([fixedLenderWETH.address])).to.not.be.reverted.and.to.not.emit(
      auditor,
      "MarketEntered",
    );
  });

  it("EnterMarkets should emit event", async () => {
    await expect(auditor.enterMarkets([fixedLenderDAI.address]))
      .to.emit(auditor, "MarketEntered")
      .withArgs(fixedLenderDAI.address, user.address);
  });

  it("ExitMarket should emit event", async () => {
    await auditor.enterMarkets([fixedLenderDAI.address]);
    await expect(auditor.exitMarket(fixedLenderDAI.address))
      .to.emit(auditor, "MarketExited")
      .withArgs(fixedLenderDAI.address, user.address);
  });

  it("validateBorrowMP should fail for when oracle gets weird", async () => {
    await dai.approve(fixedLenderDAI.address, 666);
    await fixedLenderDAI.deposit(666, user.address);
    await auditor.enterMarkets([fixedLenderDAI.address]);
    await feedRegistry.setPrice(dai.address, USD_ADDRESS, 0);
    await expect(fixedLenderDAI.borrowFromMaturityPool(1, futurePools(1)[0], 1)).to.be.revertedWith("InvalidPrice()");
  });

  it("SeizeAllowed should fail when liquidator is borrower", async () => {
    await expect(
      auditor.seizeAllowed(fixedLenderDAI.address, fixedLenderDAI.address, owner.address, owner.address),
    ).to.be.revertedWith("LiquidatorNotBorrower()");
  });

  it("LiquidateAllowed should revert with INSUFFICIENT_SHORTFALL if user has no shortfall", async () => {
    await expect(
      auditor.liquidateAllowed(fixedLenderDAI.address, fixedLenderDAI.address, owner.address, user.address, 100),
    ).to.be.revertedWith("InsufficientShortfall()"); // Any failure except MARKET_NOT_LISTED
  });

  it("Auto-adding a market should only be allowed from a fixedLender", async () => {
    // we supply Dai to the protocol
    await dai.approve(fixedLenderDAI.address, 100);
    await fixedLenderDAI.deposit(100, user.address);

    // we make it count as collateral (DAI)
    await expect(auditor.validateBorrowMP(fixedLenderDAI.address, owner.address)).to.be.revertedWith(
      "NotFixedLender()",
    );
  });

  it("SetBorrowCap should block borrowing more than the cap on a listed market", async () => {
    await timelockExecute(owner, auditor, "setMarketBorrowCaps", [[fixedLenderDAI.address], [10]]);
    await dai.approve(fixedLenderDAI.address, 1000);
    await fixedLenderDAI.deposit(1000, user.address);
    await expect(
      // user tries to borrow more than the cap
      fixedLenderDAI.borrowFromMaturityPool(20, futurePools(1)[0], 22),
    ).to.be.revertedWith("BorrowCapReached()");
  });

  it("LiquidateCalculateSeizeAmount should fail when oracle is acting weird", async () => {
    await feedRegistry.setPrice(dai.address, USD_ADDRESS, 0);
    await expect(
      auditor.liquidateCalculateSeizeAmount(fixedLenderDAI.address, fixedLenderDAI.address, 100),
    ).to.be.revertedWith("InvalidPrice()");
  });

  it("Future pools should match JS generated ones", async () => {
    await timelockExecute(owner, fixedLenderDAI, "setMaxFuturePools", [24]);
    expect(await fixedLenderDAI.getFuturePools()).to.deep.equal(futurePools(24));
  });

  it("we deposit dai & eth to the protocol and we use them both for collateral to take a loan", async () => {
    // we supply Dai to the protocol
    const amountDAI = parseUnits("100");
    await dai.approve(fixedLenderDAI.address, amountDAI);
    await fixedLenderDAI.deposit(amountDAI, user.address);
    expect(await dai.balanceOf(fixedLenderDAI.address)).to.equal(amountDAI);
    // we make it count as collateral (DAI)
    await auditor.enterMarkets([fixedLenderDAI.address]);

    // we supply ETH to the protocol
    const amountETH = parseUnits("1");
    await fixedLenderWETH.depositETH(user.address, { value: amountETH });
    expect(await weth.balanceOf(fixedLenderWETH.address)).to.equal(amountETH);
    // we make it count as collateral (WETH)
    await auditor.enterMarkets([fixedLenderWETH.address]);

    const [liquidity] = await auditor.getAccountLiquidity(user.address);
    const [, , , collateralRateDAI] = await auditor.getMarketData(fixedLenderDAI.address);
    const [, , , collateralRateWETH] = await auditor.getMarketData(fixedLenderWETH.address);
    const collateralDAI = amountDAI.mul(collateralRateDAI).div(parseUnits("1"));
    const collateralETH = amountETH.mul(collateralRateWETH).div(parseUnits("1")).mul(1_000);
    expect(liquidity).to.equal(collateralDAI.add(collateralETH));
  });

  it("Contract's state variable accountAssets should correctly add and remove the asset which the user entered and exited as collateral", async () => {
    await auditor.enterMarkets([fixedLenderDAI.address, fixedLenderWETH.address]);

    await expect(auditor.exitMarket(fixedLenderDAI.address)).to.not.be.reverted;
    await expect(auditor.exitMarket(fixedLenderWETH.address)).to.not.be.reverted;
  });

  it("Auditor reverts if Oracle acts weird", async () => {
    // we supply Dai to the protocol
    await dai.approve(fixedLenderDAI.address, 100);
    await fixedLenderDAI.depositToMaturityPool(100, futurePools(1)[0], 100);
    // we make it count as collateral (DAI)
    await auditor.enterMarkets([fixedLenderDAI.address]);
    await feedRegistry.setPrice(dai.address, USD_ADDRESS, 0);
    await expect(auditor.getAccountLiquidity(user.address)).to.revertedWith("InvalidPrice()");
  });

  it("Get data from correct market", async () => {
    const [symbol, name, isListed, collateralFactor, decimals] = await auditor.getMarketData(fixedLenderDAI.address);

    expect(collateralFactor).to.equal(parseUnits("0.8"));
    expect(symbol).to.equal("DAI");
    expect(name).to.equal("DAI");
    expect(isListed).to.equal(true);
    expect(decimals).to.equal(18);
  });

  it("Try to get data from wrong address", async () => {
    await expect(auditor.getMarketData(user.address)).to.be.revertedWith("MarketNotListed()");
  });
});
