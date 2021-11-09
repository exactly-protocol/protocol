// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Context.sol";

contract EToken is Context, IERC20, IERC20Metadata {
    mapping(address => uint256) internal balances;
    mapping(address => uint256) internal earningsIndexUser;

    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 internal _totalSupply;
    string internal eTokenName;
    string internal eTokenSymbol;
    uint256 private liquidityReserveIndex;

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual override returns (string memory) {
        return eTokenName;
    }

    /**
     * @return The symbol of the token
     **/
    function symbol() public view virtual override returns (string memory) {
        return eTokenSymbol;
    }

    /**
     * @return The decimals of the token
     **/
    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    /**
     * @return The total supply of the token
     **/
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev Calculates the balance of the user: principal balance + interest generated by the principal
     * @param account The user whose balance is calculated
     * @return The balance of the user
     **/
    function balanceOf(address account)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return
            balances[account] +
            (balances[account] *
                (liquidityReserveIndex - earningsIndexUser[account])) /
            1e18;
    }

    /**
     * @dev Executes a transfer of tokens from _msgSender() to recipient
     * @param recipient The recipient of the tokens
     * @param amount The amount of tokens being transferred
     * @return `true` if the transfer succeeds, `false` otherwise
     **/
    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    /**
     * @dev Returns the allowance of spender on the tokens owned by owner
     * @param owner The owner of the tokens
     * @param spender The user allowed to spend the owner's tokens
     * @return The amount of owner's tokens spender is allowed to spend
     **/
    function allowance(address owner, address spender)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _allowances[owner][spender];
    }

    /**
     * @dev Allows `spender` to spend the tokens owned by _msgSender()
     * @param spender The user allowed to spend _msgSender() tokens
     * @return `true`
     **/
    function approve(address spender, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    /**
     * @dev Executes a transfer of token from sender to recipient, if _msgSender() is allowed to do so
     * @param sender The owner of the tokens
     * @param recipient The recipient of the tokens
     * @param amount The amount of tokens being transferred
     * @return `true` if the transfer succeeds, `false` otherwise
     **/
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][_msgSender()];
        require(
            currentAllowance >= amount,
            "ERC20: transfer amount exceeds allowance"
        );
        unchecked {
            _approve(sender, _msgSender(), currentAllowance - amount);
        }

        return true;
    }

    /**
     * @dev Increases the allowance of spender to spend _msgSender() tokens
     * @param spender The user allowed to spend on behalf of _msgSender()
     * @param addedValue The amount being added to the allowance
     * @return `true`
     **/
    function increaseAllowance(address spender, uint256 addedValue)
        public
        virtual
        returns (bool)
    {
        _approve(
            _msgSender(),
            spender,
            _allowances[_msgSender()][spender] + addedValue
        );
        return true;
    }

    /**
     * @dev Decreases the allowance of spender to spend _msgSender() tokens
     * @param spender The user allowed to spend on behalf of _msgSender()
     * @param subtractedValue The amount being subtracted to the allowance
     * @return `true`
     **/
    function decreaseAllowance(address spender, uint256 subtractedValue)
        public
        virtual
        returns (bool)
    {
        uint256 currentAllowance = _allowances[_msgSender()][spender];
        require(
            currentAllowance >= subtractedValue,
            "ERC20: decreased allowance below zero"
        );
        unchecked {
            _approve(_msgSender(), spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(sender, recipient, amount);

        uint256 senderBalance = balances[sender];
        require(
            senderBalance >= amount,
            "ERC20: transfer amount exceeds balance"
        );
        unchecked {
            balances[sender] = senderBalance - amount;
        }
        balances[recipient] += amount;

        emit Transfer(sender, recipient, amount);

        _afterTokenTransfer(sender, recipient, amount);
    }

    /**
     * @dev Mints `amount` eTokens to `user`
     * @param user The address receiving the minted tokens
     * @param amount The amount of tokens getting minted
     */
    function mint(address user, uint256 amount) public virtual {
        require(user != address(0), "ERC20: mint to the zero address");

        _totalSupply += amount;
        liquidityReserveIndex += (amount / _totalSupply) * 1e18;
        balances[user] +=
            ((balances[user] *
                (liquidityReserveIndex - earningsIndexUser[user])) / 1e18) +
            amount;
        earningsIndexUser[user] = liquidityReserveIndex;

        emit Transfer(address(0), user, amount);
    }

    /**
     * @dev Increases contract earnings
     * @param amount The amount of underlying tokens deposited
     */
    function accrueEarnings(uint256 amount) public virtual {
        require(_totalSupply > 0, "Total supply should be positive");

        liquidityReserveIndex += (amount * 1e18) / _totalSupply;
        _totalSupply += amount;
    }

    /**
     * @dev Burns eTokens from `user`
     * @param user The owner of the eTokens, getting them burned
     * @param amount The amount being burned
     **/
    function burn(address user, uint256 amount) public virtual {
        require(
            balanceOf(user) >= amount,
            "ERC20: burn amount exceeds balance"
        );

        balances[user] -=
            amount -
            ((balances[user] *
                (liquidityReserveIndex - earningsIndexUser[user])) / 1e18);
        liquidityReserveIndex -= (amount / _totalSupply) * 1e18;
        earningsIndexUser[user] = liquidityReserveIndex;
        _totalSupply -= amount;

        emit Transfer(user, address(0), amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}
}
