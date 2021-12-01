// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.4;
import "../utils/TSUtils.sol";

interface IAuditor {
    function beforeSupplySP(address fixedLenderAddress, address supplier)
        external;

    function beforeWithdrawSP(address fixedLenderAddress, address supplier)
        external;

    function beforeDepositMP(
        address fixedLenderAddress,
        address borrower,
        uint256 maturityDate
    ) external;

    function beforeBorrowMP(
        address fixedLenderAddress,
        address borrower,
        uint256 borrowAmount,
        uint256 maturityDate
    ) external;

    function beforeWithdrawMP(
        address fixedLenderAddress,
        address redeemer,
        uint256 redeemTokens,
        uint256 maturityDate
    ) external;

    function beforeRepayMP(address fixedLenderAddress, address borrower)
        external;

    function liquidateAllowed(
        address fixedLenderBorrowed,
        address fixedLenderCollateral,
        address liquidator,
        address borrower,
        uint256 repayAmount,
        uint256 maturityDate
    ) external;

    function seizeAllowed(
        address fixedLenderCollateral,
        address fixedLenderBorrowed,
        address liquidator,
        address borrower
    ) external;

    function liquidateCalculateSeizeAmount(
        address fixedLenderBorrowed,
        address fixedLenderCollateral,
        uint256 actualRepayAmount
    ) external view returns (uint256);

    function getFuturePools() external view returns (uint256[] memory);

    function getMarketAddresses() external view returns (address[] memory);

    function getAccountLiquidity(address account, uint256 maturityDate)
        external
        view
        returns (uint256, uint256);

    function requirePoolState(uint256 maturityDate, TSUtils.State requiredState)
        external
        view;
}
