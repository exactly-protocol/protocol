// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IEToken.sol";

contract EToken is ERC20, IEToken {
    mapping(address => uint256) private userEarningsIndex;
    mapping(address => uint256) private userBalances;
    uint256 private currentSupplyScaled;
    uint256 private liquidityReserveIndex;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
    }

    /**
    * @dev Returns the total supply of the eToken
    * @return The current total supply
    **/
    function totalSupply() public view override(ERC20, IERC20) returns (uint256) {
        return currentSupplyScaled;
    }

    /**
     * @dev Calculates the balance of the user: principal balance + interest generated by the principal
     * @param account The user whose balance is calculated
     * @return The balance of the user
     **/
    function balanceOf(address account) public view override(ERC20, IERC20) returns (uint256) {
        return userBalances[account] + (userBalances[account] * (liquidityReserveIndex - userEarningsIndex[account])) / 1e18;
    }

    /**
     * @dev Mints `amount` eTokens to `user`
     * @param user The address receiving the minted tokens
     * @param amount The amount of tokens getting minted
     */
    function mint(address user, uint256 amount) external override  {
        require(user != address(0), "ERC20: mint to the zero address");

        currentSupplyScaled += amount;
        liquidityReserveIndex += (amount / currentSupplyScaled) * 1e18;
        userBalances[user] += ((userBalances[user] * (liquidityReserveIndex - userEarningsIndex[user])) / 1e18) + amount;
        userEarningsIndex[user] = liquidityReserveIndex;
        emit Transfer(address(0), user, amount);
    }

    /**
     * @dev Increases contract earnings
     * @param amount The amount of underlying tokens deposited
     */
    function accrueEarnings(uint256 amount) external override {
        require(currentSupplyScaled > 0, "Total supply should be positive");

        liquidityReserveIndex += (amount * 1e18) / currentSupplyScaled;
        currentSupplyScaled += amount;
    }

    /**
     * @dev Burns eTokens from `user`
     * @param user The owner of the eTokens, getting them burned
     * @param amount The amount being burned
     **/
    function burn(address user, uint256 amount) external override {
        require(balanceOf(user) >= amount, "ERC20: burn amount exceeds balance");

        userBalances[user] -=
            amount -
            ((userBalances[user] *
                (liquidityReserveIndex - userEarningsIndex[user])) / 1e18);
        liquidityReserveIndex -= (amount / currentSupplyScaled) * 1e18;
        userEarningsIndex[user] = liquidityReserveIndex;
        currentSupplyScaled -= amount;

        emit Transfer(user, address(0), amount);
    }
}
