// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import "../utils/Poollib.sol";

interface IInterestRateModel {

    function getRateToBorrow(
        uint256 amount,
        uint256 maturityDate,
        PoolLib.Pool memory poolMaturity,
        PoolLib.Pool memory poolPot
    ) external view returns (uint256);

    function getRateToSupply(
        uint256 amount,
        uint256 maturityDate,
        PoolLib.Pool memory poolMaturity,
        PoolLib.Pool memory poolPot
    ) external view returns (uint256);
 
}
