// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.13;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAuditor } from "./IAuditor.sol";
import { IEToken } from "./IEToken.sol";

interface IFixedLender {
  function borrowFromMaturityPool(
    uint256 amount,
    uint256 maturityDate,
    uint256 maxAmountAllowed
  ) external;

  function depositToMaturityPool(
    uint256 amount,
    uint256 maturityDate,
    uint256 minAmountRequired
  ) external;

  function depositToSmartPool(uint256 amount) external;

  function withdrawFromSmartPool(uint256 amount) external;

  function withdrawFromMaturityPool(
    uint256 redeemAmount,
    uint256 minAmountRequired,
    uint256 maturityDate
  ) external;

  function repayToMaturityPool(
    address borrower,
    uint256 maturityDate,
    uint256 repayAmount,
    uint256 maxAmountAllowed
  ) external;

  function seize(
    address liquidator,
    address borrower,
    uint256 seizeTokens
  ) external;

  function liquidate(
    address borrower,
    uint256 repayAmount,
    uint256 maxAmountAllowed,
    IFixedLender fixedLenderCollateral,
    uint256 maturityDate
  ) external returns (uint256);

  function underlyingTokenSymbol() external view returns (string calldata);

  function trustedUnderlying() external view returns (IERC20);

  function getAccountSnapshot(address who, uint256 maturityDate) external view returns (uint256, uint256);

  function getTotalMpBorrows(uint256 maturityDate) external view returns (uint256);

  function getAuditor() external view returns (IAuditor);

  function eToken() external view returns (IEToken);

  function totalMpBorrows() external view returns (uint256);
}

error BalanceExceeded();
error InvalidTokenFee();
error NotFixedLender();
error ZeroRedeem();
error ZeroRepay();
