// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.13;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Pausable } from "@openzeppelin/contracts/security/Pausable.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@rari-capital/solmate/src/utils/ReentrancyGuard.sol";
import { FixedPointMathLib } from "@rari-capital/solmate/src/utils/FixedPointMathLib.sol";
import { ERC4626, ERC20, SafeTransferLib } from "@rari-capital/solmate/src/mixins/ERC4626.sol";
import { PoolLib, InsufficientProtocolLiquidity } from "./utils/PoolLib.sol";
import { Auditor, InvalidParameter } from "./Auditor.sol";
import { InterestRateModel } from "./InterestRateModel.sol";
import { PoolAccounting } from "./PoolAccounting.sol";
import { TSUtils } from "./utils/TSUtils.sol";

contract FixedLender is ERC4626, AccessControl, PoolAccounting, ReentrancyGuard, Pausable {
  using FixedPointMathLib for uint256;
  using SafeTransferLib for ERC20;

  bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
  uint256 public constant CLOSE_FACTOR = 5e17;

  string public assetSymbol;
  Auditor public immutable auditor;

  uint8 public maxFuturePools; // If value is 12 and INTERVAL 7 days, then furthest maturity is in 3 months
  uint256 public accumulatedEarningsSmoothFactor;
  uint256 public lastAccumulatedEarningsAccrual;

  uint256 public smartPoolBalance;

  // Total borrows in all maturities
  uint256 public totalMpBorrows;

  /// @notice Event emitted when a user deposits an amount of an asset to a certain maturity date collecting a fee at
  /// the end of the period.
  /// @param maturity dateID/poolID/maturity in which the user will be able to collect his deposit + his fee.
  /// @param caller address which deposited the asset.
  /// @param owner address which received the shares.
  /// @param assets amount of the asset that were deposited.
  /// @param fee is the extra amount that it will be collected at maturity.
  event DepositAtMaturity(
    uint256 indexed maturity,
    address indexed caller,
    address indexed owner,
    uint256 assets,
    uint256 fee
  );

  /// @notice Event emitted when a user collects its deposits after maturity.
  /// @param maturity poolID where the user collected its deposits.
  /// @param receiver address which will be collecting the asset.
  /// @param assets amount of the asset that were deposited.
  /// @param assetsDiscounted amount of the asset that were deposited (in case of early withdrawal).
  event WithdrawAtMaturity(
    uint256 indexed maturity,
    address caller,
    address indexed receiver,
    address indexed owner,
    uint256 assets,
    uint256 assetsDiscounted
  );

  /// @notice Event emitted when a user borrows amount of an asset from a certain maturity date.
  /// @param maturity dateID/poolID/maturity in which the user will have to repay the loan.
  /// @param caller address which borrowed the asset.
  /// @param borrower address which will be collecting the asset.
  /// @param assets amount of the asset that were borrowed.
  /// @param fee amount extra that it will need to be paid at maturity.
  event BorrowAtMaturity(
    uint256 indexed maturity,
    address caller,
    address indexed receiver,
    address indexed borrower,
    uint256 assets,
    uint256 fee
  );

  /// @notice Event emitted when a user repays its borrows after maturity.
  /// @param maturity poolID where the user repaid its borrowed amounts.
  /// @param caller address which repaid the previously borrowed amount.
  /// @param borrower address which had the original debt.
  /// @param assets amount that was repaid.
  /// @param positionAssets amount of the debt that was covered in this repayment (penalties could have been repaid).
  event RepayAtMaturity(
    uint256 indexed maturity,
    address indexed caller,
    address indexed borrower,
    uint256 assets,
    uint256 positionAssets
  );

  /// @notice Event emitted when a user's position had a liquidation.
  /// @param receiver address which repaid the previously borrowed amount.
  /// @param borrower address which had the original debt.
  /// @param assets amount of the asset that were repaid.
  /// @param collateralFixedLender address of the asset that were seized by the liquidator.
  /// @param seizedAssets amount seized of the collateral.
  event LiquidateBorrow(
    address indexed receiver,
    address indexed borrower,
    uint256 assets,
    FixedLender indexed collateralFixedLender,
    uint256 seizedAssets
  );

  /// @notice Event emitted when a user's collateral has been seized.
  /// @param liquidator address which seized this collateral.
  /// @param borrower address which had the original debt.
  /// @param assets amount seized of the collateral.
  event AssetSeized(address indexed liquidator, address indexed borrower, uint256 assets);

  /// @notice Event emitted when earnings are accrued to the smart pool.
  /// @param previousAssets previous balance of the smart pool, denominated in assets (underlying).
  /// @param earnings new smart pool earnings, denominated in assets (underlying).
  event SmartPoolEarningsAccrued(uint256 previousAssets, uint256 earnings);

  /// @notice emitted when the accumulatedEarningsSmoothFactor is changed by admin.
  /// @param newAccumulatedEarningsSmoothFactor factor represented with 1e18 decimals.
  event AccumulatedEarningsSmoothFactorUpdated(uint256 newAccumulatedEarningsSmoothFactor);

  /// @notice emitted when the maxFuturePools is changed by admin.
  /// @param newMaxFuturePools represented with 1e18 decimals.
  event MaxFuturePoolsUpdated(uint256 newMaxFuturePools);

  constructor(
    ERC20 asset_,
    string memory assetSymbol_,
    uint8 maxFuturePools_,
    uint256 accumulatedEarningsSmoothFactor_,
    Auditor auditor_,
    InterestRateModel interestRateModel_,
    uint256 penaltyRate_,
    uint256 smartPoolReserveFactor_,
    DampSpeed memory dampSpeed_
  )
    ERC4626(asset_, string(abi.encodePacked("EToken", assetSymbol_)), string(abi.encodePacked("e", assetSymbol_)))
    PoolAccounting(interestRateModel_, penaltyRate_, smartPoolReserveFactor_, dampSpeed_)
  {
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

    assetSymbol = assetSymbol_;
    auditor = auditor_;
    maxFuturePools = maxFuturePools_;
    accumulatedEarningsSmoothFactor = accumulatedEarningsSmoothFactor_;
  }

  function totalAssets() public view override returns (uint256) {
    unchecked {
      uint256 memMaxFuturePools = maxFuturePools;
      uint256 smartPoolEarnings = 0;

      uint256 lastAccrual;
      uint256 unassignedEarnings;
      uint256 latestMaturity = block.timestamp - (block.timestamp % TSUtils.INTERVAL);
      uint256 maxMaturity = latestMaturity + memMaxFuturePools * TSUtils.INTERVAL;

      assembly {
        mstore(0x20, maturityPools.slot) // hashing scratch space, second word for storage location hashing
      }

      for (uint256 maturity = latestMaturity; maturity <= maxMaturity; maturity += TSUtils.INTERVAL) {
        assembly {
          mstore(0x00, maturity) // hashing scratch space, first word for storage location hashing
          let location := keccak256(0x00, 0x40) // struct storage location: keccak256([maturity, maturityPools.slot])
          unassignedEarnings := sload(add(location, 2)) // third word
          lastAccrual := sload(add(location, 3)) // forth word
        }

        if (maturity > lastAccrual) {
          smartPoolEarnings += unassignedEarnings.mulDivDown(block.timestamp - lastAccrual, maturity - lastAccrual);
        }
      }

      return smartPoolBalance + smartPoolEarnings + smartPoolAccumulatedEarnings();
    }
  }

  function withdraw(
    uint256 assets,
    address receiver,
    address owner
  ) public override returns (uint256) {
    auditor.validateAccountShortfall(this, owner, assets);
    return super.withdraw(assets, receiver, owner);
  }

  function redeem(
    uint256 shares,
    address receiver,
    address owner
  ) public override returns (uint256) {
    auditor.validateAccountShortfall(this, owner, previewMint(shares));
    return super.redeem(shares, receiver, owner);
  }

  function beforeWithdraw(uint256 assets, uint256) internal override {
    uint256 memSPBalance = smartPoolBalance;
    updateSmartPoolAssetsAverage(memSPBalance);
    uint256 earnings = smartPoolAccumulatedEarnings();
    lastAccumulatedEarningsAccrual = block.timestamp;
    smartPoolEarningsAccumulator -= earnings;
    emit SmartPoolEarningsAccrued(memSPBalance, earnings);
    memSPBalance = memSPBalance + earnings - assets;
    smartPoolBalance = memSPBalance;
    // we check if the underlying liquidity that the user wants to withdraw is borrowed
    if (memSPBalance < smartPoolBorrowed) revert InsufficientProtocolLiquidity();
  }

  function afterDeposit(uint256 assets, uint256) internal virtual override whenNotPaused {
    uint256 memSPBalance = smartPoolBalance;
    updateSmartPoolAssetsAverage(memSPBalance);
    uint256 earnings = smartPoolAccumulatedEarnings();
    lastAccumulatedEarningsAccrual = block.timestamp;
    smartPoolEarningsAccumulator -= earnings;
    emit SmartPoolEarningsAccrued(memSPBalance, earnings);
    smartPoolBalance = memSPBalance + earnings + assets;
  }

  function smartPoolAccumulatedEarnings() internal view returns (uint256 earnings) {
    uint256 elapsed = block.timestamp - lastAccumulatedEarningsAccrual;
    if (elapsed == 0) return 0;
    earnings = smartPoolEarningsAccumulator.mulDivDown(
      elapsed,
      elapsed + accumulatedEarningsSmoothFactor.mulWadDown(maxFuturePools * TSUtils.INTERVAL)
    );
  }

  function transfer(address to, uint256 shares) public virtual override returns (bool) {
    auditor.validateAccountShortfall(this, msg.sender, previewMint(shares));
    return super.transfer(to, shares);
  }

  function transferFrom(
    address from,
    address to,
    uint256 shares
  ) public virtual override returns (bool) {
    auditor.validateAccountShortfall(this, from, previewMint(shares));
    return super.transferFrom(from, to, shares);
  }

  /// @notice Sets the protocol's max future weekly pools for borrowing and lending.
  /// @dev Value can not be 0.
  /// @param futurePools number of pools to be active at the same time (4 weekly pools ~= 1 month).
  function setMaxFuturePools(uint8 futurePools) external onlyRole(DEFAULT_ADMIN_ROLE) {
    if (futurePools == 0) revert InvalidParameter();
    maxFuturePools = futurePools;
    emit MaxFuturePoolsUpdated(futurePools);
  }

  /// @notice Sets the factor used when smoothly accruing earnings to the smart pool.
  /// @dev Value can only be lower than 4. If set at 0, then all remaining accumulated earnings are
  /// distributed in following operation to the smart pool.
  /// @param accumulatedEarningsSmoothFactor_ represented with 18 decimals.
  function setAccumulatedEarningsSmoothFactor(uint256 accumulatedEarningsSmoothFactor_)
    external
    onlyRole(DEFAULT_ADMIN_ROLE)
  {
    if (accumulatedEarningsSmoothFactor_ > 4e18) revert InvalidParameter();
    accumulatedEarningsSmoothFactor = accumulatedEarningsSmoothFactor_;
    emit AccumulatedEarningsSmoothFactorUpdated(accumulatedEarningsSmoothFactor_);
  }

  /// @notice Sets the _pause state to true in case of emergency, triggered by an authorized account.
  function pause() external onlyRole(PAUSER_ROLE) {
    _pause();
  }

  /// @notice Sets the _pause state to false when threat is gone, triggered by an authorized account.
  function unpause() external onlyRole(PAUSER_ROLE) {
    _unpause();
  }

  /// @notice Function to liquidate uncollaterized position(s).
  /// @dev Msg.sender liquidates borrower's position(s) and repays a certain amount of debt for multiple maturities,
  /// seizing a part of borrower's collateral.
  /// @param borrower wallet that has an outstanding debt across all maturities.
  /// @param positionAssets amount of debt to be covered by liquidator(msg.sender).
  /// @param collateralFixedLender fixedLender from which the collateral will be seized to give the liquidator.
  function liquidate(
    address borrower,
    uint256 positionAssets,
    uint256 maxAssetsAllowed,
    FixedLender collateralFixedLender
  ) external nonReentrant whenNotPaused returns (uint256 repaidAssets) {
    // reverts on failure
    auditor.liquidateAllowed(this, collateralFixedLender, msg.sender, borrower);

    (uint256 sumBorrows, ) = getAccountBorrows(borrower, PoolLib.MATURITY_ALL);
    positionAssets = Math.min(positionAssets, CLOSE_FACTOR.mulWadDown(sumBorrows));

    uint256 encodedMaturities = userMpBorrowed[borrower];
    uint256 baseMaturity = encodedMaturities % (1 << 32);
    uint256 packedMaturities = encodedMaturities >> 32;
    for (uint224 i = 0; i < 224; ) {
      if ((packedMaturities & (1 << i)) != 0) {
        (uint256 actualRepay, uint256 coveredDebt) = noTransferRepay(
          baseMaturity + (i * TSUtils.INTERVAL),
          positionAssets,
          maxAssetsAllowed,
          borrower
        );
        repaidAssets += actualRepay;
        positionAssets -= coveredDebt;
        maxAssetsAllowed -= actualRepay;
      }
      if (positionAssets == 0) break;
      unchecked {
        ++i;
      }
      if ((1 << i) > packedMaturities) break;
    }

    // reverts on failure
    uint256 seizeTokens = auditor.liquidateCalculateSeizeAmount(this, collateralFixedLender, repaidAssets);

    // If this is also the collateral run seizeInternal to avoid re-entrancy, otherwise make an external call.
    // both revert on failure
    if (address(collateralFixedLender) == address(this)) {
      _seize(this, msg.sender, borrower, seizeTokens);
    } else {
      collateralFixedLender.seize(msg.sender, borrower, seizeTokens);
    }

    // We emit a LiquidateBorrow event
    emit LiquidateBorrow(msg.sender, borrower, repaidAssets, collateralFixedLender, seizeTokens);

    asset.safeTransferFrom(msg.sender, address(this), repaidAssets);
  }

  /// @notice Public function to seize a certain amount of tokens.
  /// @dev Public function for liquidator to seize borrowers tokens in the smart pool.
  /// This function will only be called from another FixedLender, on `liquidation` calls.
  /// That's why msg.sender needs to be passed to the private function (to be validated as a market)
  /// @param liquidator address which will receive the seized tokens.
  /// @param borrower address from which the tokens will be seized.
  /// @param assets amount to be removed from borrower's possession.
  function seize(
    address liquidator,
    address borrower,
    uint256 assets
  ) external nonReentrant whenNotPaused {
    _seize(FixedLender(msg.sender), liquidator, borrower, assets);
  }

  /// @dev Lends to a wallet for a certain maturity date/pool.
  /// @param maturity maturity date for repayment.
  /// @param assets amount to send to borrower.
  /// @param maxAssetsAllowed maximum amount of debt that the user is willing to accept.
  function borrowAtMaturity(
    uint256 maturity,
    uint256 assets,
    uint256 maxAssetsAllowed,
    address receiver,
    address borrower
  ) public nonReentrant whenNotPaused returns (uint256 assetsOwed) {
    // reverts on failure
    TSUtils.validateRequiredPoolState(maxFuturePools, maturity, TSUtils.State.VALID, TSUtils.State.NONE);

    uint256 earningsSP;
    uint256 memSPBalance = smartPoolBalance;
    (assetsOwed, earningsSP) = borrowMP(maturity, borrower, assets, maxAssetsAllowed, memSPBalance);

    if (msg.sender != borrower) {
      uint256 allowed = allowance[borrower][msg.sender]; // saves gas for limited approvals.

      if (allowed != type(uint256).max) allowance[borrower][msg.sender] = allowed - previewWithdraw(assetsOwed);
    }

    totalMpBorrows += assetsOwed;

    emit SmartPoolEarningsAccrued(memSPBalance, earningsSP);
    smartPoolBalance = memSPBalance + earningsSP;
    auditor.validateBorrowMP(this, borrower);

    asset.safeTransfer(receiver, assets);

    emit BorrowAtMaturity(maturity, msg.sender, receiver, borrower, assets, assetsOwed - assets);
  }

  /// @dev Deposits a certain amount to the protocol for a certain maturity date/pool.
  /// @param maturity maturity date / pool ID.
  /// @param assets amount to receive from the msg.sender.
  /// @param minAssetsRequired minimum amount of capital required by the depositor for the transaction to be accepted.
  function depositAtMaturity(
    uint256 maturity,
    uint256 assets,
    uint256 minAssetsRequired,
    address receiver
  ) public nonReentrant whenNotPaused returns (uint256 maturityAssets) {
    // reverts on failure
    TSUtils.validateRequiredPoolState(maxFuturePools, maturity, TSUtils.State.VALID, TSUtils.State.NONE);

    asset.safeTransferFrom(msg.sender, address(this), assets);

    uint256 earningsSP;
    (maturityAssets, earningsSP) = depositMP(maturity, receiver, assets, minAssetsRequired);

    uint256 memSPBalance = smartPoolBalance;
    emit SmartPoolEarningsAccrued(memSPBalance, earningsSP);
    smartPoolBalance = memSPBalance + earningsSP;

    emit DepositAtMaturity(maturity, msg.sender, receiver, assets, maturityAssets - assets);
  }

  /// @notice User collects a certain amount of underlying asset after supplying tokens until a certain maturity date.
  /// @dev The pool that the user is trying to retrieve the money should be matured.
  /// @param positionAssets The number of underlying tokens to extract from position.
  /// @param minAssetsRequired minimum amount required by the user (if penalty fees for early withdrawal).
  /// @param maturity The matured date for which we're trying to retrieve the funds.
  function withdrawAtMaturity(
    uint256 maturity,
    uint256 positionAssets,
    uint256 minAssetsRequired,
    address receiver,
    address owner
  ) public nonReentrant returns (uint256 assetsDiscounted) {
    if (positionAssets == 0) revert ZeroWithdraw();

    // reverts on failure
    TSUtils.validateRequiredPoolState(maxFuturePools, maturity, TSUtils.State.VALID, TSUtils.State.MATURED);

    uint256 earningsSP;
    uint256 memSPBalance = smartPoolBalance;
    // We check if there's any discount to be applied for early withdrawal
    (assetsDiscounted, earningsSP) = withdrawMP(maturity, owner, positionAssets, minAssetsRequired, memSPBalance);

    if (msg.sender != owner) {
      uint256 allowed = allowance[owner][msg.sender]; // saves gas for limited approvals.

      if (allowed != type(uint256).max) allowance[owner][msg.sender] = allowed - previewWithdraw(assetsDiscounted);
    }

    emit SmartPoolEarningsAccrued(memSPBalance, earningsSP);
    smartPoolBalance = memSPBalance + earningsSP;

    asset.safeTransfer(receiver, assetsDiscounted);

    emit WithdrawAtMaturity(maturity, msg.sender, receiver, owner, positionAssets, assetsDiscounted);
  }

  /// @notice Sender repays an amount of borrower's debt for a maturity date.
  /// @dev The pool that the user is trying to repay to should be matured.
  /// @param maturity The matured date where the debt is located.
  /// @param borrower The address of the account that has the debt.
  /// @param positionAssets amount to be paid for the borrower's debt.
  /// @return actualRepayAssets the actual amount that was transferred into the protocol.
  function repayAtMaturity(
    uint256 maturity,
    uint256 positionAssets,
    uint256 maxAssetsAllowed,
    address borrower
  ) public nonReentrant whenNotPaused returns (uint256 actualRepayAssets) {
    // reverts on failure
    TSUtils.validateRequiredPoolState(maxFuturePools, maturity, TSUtils.State.VALID, TSUtils.State.MATURED);

    (actualRepayAssets, ) = noTransferRepay(maturity, positionAssets, maxAssetsAllowed, borrower);
    asset.safeTransferFrom(msg.sender, address(this), actualRepayAssets);
  }

  /// @dev Gets current snapshot for a wallet in certain maturity.
  /// @param who wallet to return status snapshot in the specified maturity date.
  /// @param maturity maturity. `PoolLib.MATURITY_ALL` (`type(uint256).max`) for all maturities.
  /// @return the amount the user deposited to the smart pool and the total money he owes from maturities.
  function getAccountSnapshot(address who, uint256 maturity) public view returns (uint256, uint256) {
    (uint256 position, uint256 penalties) = getAccountBorrows(who, maturity);
    return (maxWithdraw(who), position + penalties);
  }

  /// @notice This function allows to (partially) repay a position. It does not transfer tokens.
  /// @dev Internal repay function, allows partial repayment.
  /// @param maturity the maturity to access the pool.
  /// @param positionAssets the amount of debt of the pool that should be paid.
  /// @param borrower the address of the account that has the debt.
  /// @return actualRepayAssets the actual amount that should be transferred into the protocol.
  function noTransferRepay(
    uint256 maturity,
    uint256 positionAssets,
    uint256 maxAssetsAllowed,
    address borrower
  ) internal returns (uint256 actualRepayAssets, uint256 debtCovered) {
    if (positionAssets == 0) revert ZeroRepay();

    uint256 earningsSP;
    (actualRepayAssets, debtCovered, earningsSP) = repayMP(maturity, borrower, positionAssets, maxAssetsAllowed);

    uint256 memSPBalance = smartPoolBalance;
    emit SmartPoolEarningsAccrued(memSPBalance, earningsSP);
    smartPoolBalance = memSPBalance + earningsSP;

    totalMpBorrows -= debtCovered;

    emit RepayAtMaturity(maturity, msg.sender, borrower, actualRepayAssets, debtCovered);
  }

  /// @notice Private function to seize a certain amount of tokens.
  /// @dev Private function for liquidator to seize borrowers tokens in the smart pool.
  /// Will only be called from this FixedLender on `liquidation` or through `seize` calls from another FixedLender.
  /// That's why msg.sender needs to be passed to the private function (to be validated as a market).
  /// @param seizerFixedLender address which is calling the seize function (see `seize` public function).
  /// @param liquidator address which will receive the seized tokens.
  /// @param borrower address from which the tokens will be seized.
  /// @param assets amount to be removed from borrower's possession.
  function _seize(
    FixedLender seizerFixedLender,
    address liquidator,
    address borrower,
    uint256 assets
  ) internal {
    if (assets == 0) revert ZeroWithdraw();

    // reverts on failure
    auditor.seizeAllowed(this, seizerFixedLender, liquidator, borrower);

    uint256 shares = previewWithdraw(assets);
    beforeWithdraw(assets, shares);
    _burn(borrower, shares);
    emit Withdraw(msg.sender, liquidator, borrower, assets, shares);

    asset.safeTransfer(liquidator, assets);
    emit AssetSeized(liquidator, borrower, assets);
  }
}

error NotFixedLender();
error ZeroWithdraw();
error ZeroRepay();
