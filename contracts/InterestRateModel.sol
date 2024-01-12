// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { FixedPointMathLib } from "solmate/src/utils/FixedPointMathLib.sol";
import { FixedLib } from "./utils/FixedLib.sol";
import { Market } from "./Market.sol";

contract InterestRateModel {
  using FixedPointMathLib for uint256;
  using FixedPointMathLib for int256;
  using SafeCast for uint256;
  using SafeCast for int256;

  /// @notice Scale factor of the floating curve.
  uint256 public immutable floatingCurveA;
  /// @notice Origin intercept of the floating curve.
  int256 public immutable floatingCurveB;
  /// @notice Asymptote of the floating curve.
  uint256 public immutable floatingMaxUtilization;

  /// @notice natural level of floating utilization, represented with 18 decimals.
  uint256 public immutable floatingNaturalUtilization;
  /// @notice natural level of fixed utilization, represented with 18 decimals.
  uint256 public immutable fixedNaturalUtilization;
  /// @notice speed of growth for the base rate, represented with 18 decimals.
  int256 public immutable growthSpeed;
  /// @notice speed of the sigmoid curve, represented with 18 decimals.
  int256 public immutable sigmoidSpeed;
  /// @notice maximum interest rate, represented with 18 decimals.
  uint256 public immutable maxRate;
  /// @notice spread factor for the fixed rate, represented with 18 decimals.
  int256 public immutable spreadFactor;
  /// @notice time preference for the fixed rate, represented with 18 decimals.
  int256 public immutable timePreference;
  /// @notice speed of maturity for the fixed rate, represented with 18 decimals.
  int256 public immutable maturitySpeed;

  /// @dev maximum input value for expWad, ~ln(2^256), represented with 18 decimals.
  int256 internal constant EXP_THRESHOLD = 135305999368893231588;
  /// @dev auxiliary variable to save an extra operation.
  int256 internal immutable auxUNat;

  constructor(
    Market market_,
    uint256 curveA_,
    int256 curveB_,
    uint256 maxUtilization_,
    uint256 floatingNaturalUtilization_,
    int256 sigmoidSpeed_,
    int256 growthSpeed_,
    uint256 maxRate_,
    int256 spreadFactor_,
    int256 timePreference_,
    int256 maturitySpeed_
  ) {
    assert(
      curveA_ != 0 &&
        maxUtilization_ > 1e18 &&
        floatingNaturalUtilization_ != 0 &&
        floatingNaturalUtilization_ < 1e18 &&
        sigmoidSpeed_ > 0 &&
        growthSpeed_ > 0 &&
        maxRate_ != 0 &&
        maxRate_ <= 15_000e16 &&
        spreadFactor_ > 0 &&
        maturitySpeed_ > 0
    );

    market = market_;

    fixedCurveA = curveA_;
    fixedCurveB = curveB_;
    fixedMaxUtilization = maxUtilization_;

    floatingCurveA = curveA_;
    floatingCurveB = curveB_;
    floatingMaxUtilization = maxUtilization_;

    floatingNaturalUtilization = floatingNaturalUtilization_;
    fixedNaturalUtilization = 1e18 - floatingNaturalUtilization;

    auxUNat = (floatingNaturalUtilization.divWadDown(fixedNaturalUtilization)).toInt256().lnWad();
    sigmoidSpeed = sigmoidSpeed_;
    growthSpeed = growthSpeed_;
    maxRate = maxRate_;
    spreadFactor = spreadFactor_;
    timePreference = timePreference_;
    maturitySpeed = maturitySpeed_;

    // reverts if it's an invalid curve (such as one yielding a negative interest rate).
    fixedRate(block.timestamp + FixedLib.INTERVAL - (block.timestamp % FixedLib.INTERVAL), 1, 1, 1, 2);
    baseRate(1e18 - 1, 1e18 - 1);
  }

  struct FixedVars {
    uint256 sqFNatPools;
    uint256 fNatPools;
    uint256 fixedFactor;
    int256 natPools;
    uint256 maturityFactor;
  }

  /// @notice fixed rate with given conditions, represented with 18 decimals.
  /// @param maturity maturity of the pool.
  /// @param maxPools number of pools available in the time horizon.
  /// @param uFixed fixed utilization of the pool.
  /// @param uFloating floating utilization of the pool.
  /// @param uGlobal global utilization of the pool.
  /// @return the minimum between `floatingRate` and `maxRate` with given conditions.
  function fixedRate(
    uint256 maturity,
    uint256 maxPools,
    uint256 uFixed,
    uint256 uFloating,
    uint256 uGlobal
  ) public view returns (uint256) {
    if (block.timestamp >= maturity) revert AlreadyMatured();
    if (uFixed > uGlobal) revert UtilizationExceeded();
    if (uFixed == 0) return floatingRate(uFloating, uGlobal);

    FixedVars memory v;
    v.sqFNatPools = (maxPools * 1e18).divWadDown(fixedNaturalUtilization);
    v.fNatPools = (v.sqFNatPools * 1e18).sqrt();
    v.fixedFactor = (maxPools * uFixed).mulDivDown(1e36, uGlobal * fixedNaturalUtilization);
    v.natPools =
      ((2e18 - v.sqFNatPools.toInt256()) * 1e36) /
      (v.fNatPools.toInt256() * (1e18 - v.fNatPools.toInt256()));
    v.maturityFactor = (maturity - block.timestamp).divWadDown(
      maxPools * FixedLib.INTERVAL - (block.timestamp % FixedLib.INTERVAL)
    );

    uint256 spread = (1e18 +
      (((maturitySpeed * (v.maturityFactor).toInt256().lnWad()) / 1e18).expWad() *
        (timePreference +
          (spreadFactor *
            ((v.natPools * (v.fixedFactor * 1e18).sqrt().toInt256()) /
              1e18 +
              ((1e18 - v.natPools) * v.fixedFactor.toInt256()) /
              1e18 -
              1e18)) /
          1e18)) /
      1e18).toUint256();
    uint256 base = baseRate(uFloating, uGlobal);

    if (base >= maxRate.divWadDown(spread)) return maxRate;
    return base.mulWadUp(spread);
  }

  /// @notice base rate with given conditions, represented with 18 decimals.
  /// @param uFloating floating utilization of the pool.
  /// @param uGlobal global utilization of the pool.
  /// @return the base rate, without capping.
  function baseRate(uint256 uFloating, uint256 uGlobal) internal view returns (uint256) {
    if (uFloating > uGlobal) revert UtilizationExceeded();
    if (uGlobal >= 1e18) return type(uint256).max;

    uint256 r = ((floatingCurveA.divWadDown(floatingMaxUtilization - uFloating)).toInt256() + floatingCurveB)
      .toUint256();

    if (uGlobal == 0) return r;

    int256 x = -((sigmoidSpeed * ((uGlobal.divWadDown(1e18 - uGlobal)).toInt256().lnWad() - auxUNat)) / 1e18);
    uint256 sigmoid = x > EXP_THRESHOLD ? 1e18 : x.expWad().toUint256();
    x =
      (-growthSpeed * (1e18 - uint256(1e18).divWadDown(1e18 + sigmoid).mulWadDown(uGlobal)).toInt256().lnWad()) /
      1e18;
    uint256 globalFactor = ((x > EXP_THRESHOLD ? EXP_THRESHOLD : x).expWad()).toUint256();

    if (globalFactor > type(uint256).max / r) return type(uint256).max;

    return r.mulWadUp(globalFactor);
  }

  /// @notice floating rate with given conditions, represented with 18 decimals.
  /// @param uFloating floating utilization of the pool.
  /// @param uGlobal global utilization of the pool.
  /// @return the minimum between `baseRate` and `maxRate` with given conditions.
  function floatingRate(uint256 uFloating, uint256 uGlobal) public view returns (uint256) {
    return Math.min(baseRate(uFloating, uGlobal), maxRate);
  }

  // Legacy interface, kept for compatibility.

  /// @notice Market where the interest rate model is used. Keeps compatibility with legacy interest rate model.
  Market public immutable market;
  uint256 public immutable fixedCurveA;
  int256 public immutable fixedCurveB;
  uint256 public immutable fixedMaxUtilization;

  /// @dev Deprecated in favor of `floatingRate(uFloating, uGlobal)`.
  function floatingRate(uint256) public view returns (uint256) {
    uint256 floatingAssets = market.floatingAssets();
    uint256 floatingDebt = market.floatingDebt();
    return
      floatingRate(
        floatingAssets != 0 ? floatingDebt.divWadUp(floatingAssets) : 0,
        globalUtilization(floatingAssets, floatingDebt, market.floatingBackupBorrowed())
      );
  }

  /// @dev Deprecated in favor of `fixedRate(maturity, maxPools, uFixed, uFloating, uGlobal)`
  function fixedBorrowRate(
    uint256 maturity,
    uint256 amount,
    uint256 borrowed,
    uint256 supplied,
    uint256
  ) external view returns (uint256) {
    if (block.timestamp >= maturity) revert AlreadyMatured();
    uint256 floatingAssets = previewFloatingAssetsAverage(maturity);
    uint256 backupBorrowed = market.floatingBackupBorrowed();
    uint256 floatingDebt = totalFloatingBorrowAssets(
      floatingAssets,
      market.floatingDebt(),
      backupBorrowed,
      market.lastFloatingDebtUpdate()
    );
    uint256 newBorrowed = borrowed + amount;
    uint256 backupDebtAddition = newBorrowed - Math.min(Math.max(borrowed, supplied), newBorrowed);

    return
      fixedRate(
        maturity,
        market.maxFuturePools(),
        fixedUtilization(supplied, newBorrowed, floatingAssets),
        floatingAssets != 0 ? floatingDebt.divWadUp(floatingAssets) : 0,
        globalUtilization(floatingAssets, floatingDebt, backupBorrowed + backupDebtAddition)
      );
  }

  /// @dev deprecated in favor of `fixedRate(maturity, maxPools, uFixed, uFloating, uGlobal)`
  function minFixedRate(uint256, uint256, uint256) external view returns (uint256 rate, uint256 utilization) {
    uint256 floatingAssets = market.floatingAssetsAverage();
    uint256 backupBorrowed = market.floatingBackupBorrowed();
    uint256 floatingDebt = totalFloatingBorrowAssets(
      floatingAssets,
      market.floatingDebt(),
      backupBorrowed,
      market.lastFloatingDebtUpdate()
    );
    utilization = globalUtilization(floatingAssets, floatingDebt, backupBorrowed);
    rate = baseRate(floatingAssets != 0 ? floatingDebt.divWadUp(floatingAssets) : 0, utilization);
  }

  function previewFloatingAssetsAverage(uint256 maturity) internal view returns (uint256) {
    FixedLib.Pool memory pool;
    (pool.borrowed, pool.supplied, pool.unassignedEarnings, pool.lastAccrual) = market.fixedPools(maturity);
    uint256 memFloatingAssets = market.floatingAssets() +
      pool.unassignedEarnings.mulDivDown(block.timestamp - pool.lastAccrual, maturity - pool.lastAccrual);
    uint256 memFloatingAssetsAverage = market.floatingAssetsAverage();
    uint256 averageFactor = (1e18 -
      (
        -(
          memFloatingAssets < memFloatingAssetsAverage
            ? market.dampSpeedDown()
            : market.dampSpeedUp() * (block.timestamp - market.lastAverageUpdate())
        ).toInt256()
      ).expWad()).toUint256();
    return memFloatingAssetsAverage.mulWadDown(1e18 - averageFactor) + averageFactor.mulWadDown(memFloatingAssets);
  }

  function totalFloatingBorrowAssets(
    uint256 floatingAssets,
    uint256 floatingDebt,
    uint256 backupBorrowed,
    uint256 lastFloatingDebtUpdate
  ) internal view returns (uint256) {
    return
      floatingDebt +
      floatingDebt.mulWadDown(
        floatingRate(
          floatingAssets != 0 ? floatingDebt.divWadUp(floatingAssets) : 0,
          globalUtilization(floatingAssets, floatingDebt, backupBorrowed)
        ).mulDivDown(block.timestamp - lastFloatingDebtUpdate, 365 days)
      );
  }

  function globalUtilization(
    uint256 floatingAssets,
    uint256 floatingDebt,
    uint256 backupBorrowed
  ) internal pure returns (uint256) {
    return floatingAssets != 0 ? (floatingDebt + backupBorrowed).divWadUp(floatingAssets) : 0;
  }

  function fixedUtilization(
    uint256 supplied,
    uint256 borrowed,
    uint256 floatingAssets
  ) internal pure returns (uint256) {
    return floatingAssets != 0 && borrowed > supplied ? (borrowed - supplied).divWadUp(floatingAssets) : 0;
  }
}

error AlreadyMatured();
error UtilizationExceeded();
