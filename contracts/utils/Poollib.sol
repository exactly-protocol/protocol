// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

library PoolLib {

    struct Pool {
        uint256 borrowed;
        uint256 supplied;
    }

}
