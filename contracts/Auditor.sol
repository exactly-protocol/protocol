// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.4;

import {
    FixedPointMathLib
} from "@rari-capital/solmate/src/utils/FixedPointMathLib.sol";
import {
    AccessControl
} from "@openzeppelin/contracts/access/AccessControl.sol";
import { IFixedLender, NotFixedLender } from "./interfaces/IFixedLender.sol";
import { IOracle } from "./interfaces/IOracle.sol";
import { PoolLib } from "./utils/PoolLib.sol";
import {
    IAuditor,
    AuditorMismatch,
    BalanceOwed,
    BorrowCapReached,
    InsufficientLiquidity,
    InsufficientShortfall,
    InvalidBorrowCaps,
    LiquidatorNotBorrower,
    MarketAlreadyListed,
    MarketNotListed,
    TooMuchRepay
} from "./interfaces/IAuditor.sol";

contract Auditor is IAuditor, AccessControl {
    using FixedPointMathLib for uint256;

    // Struct to avoid stack too deep
    struct AccountLiquidity {
        uint256 balance;
        uint256 borrowBalance;
        uint256 oraclePrice;
        uint256 sumDebt;
        uint256 sumCollateral;
        uint8 decimals;
        uint128 collateralFactor;
    }

    // Struct for FixedLender's markets
    struct Market {
        string symbol;
        string name;
        uint128 collateralFactor;
        uint8 decimals;
        uint8 index;
        bool isListed;
    }

    // Protocol Management
    mapping(address => uint256) private accountAssets;
    mapping(IFixedLender => Market) private markets;
    mapping(IFixedLender => uint256) private borrowCaps;

    uint256 public constant CLOSE_FACTOR = 5e17;
    uint256 public liquidationIncentive = 1.1e18;
    IFixedLender[] public marketAddresses;

    IOracle public oracle;

    /**
     * @notice Event emitted when a new market is listed for borrow/lending
     * @param fixedLender address of the fixedLender market that it was listed
     */
    event MarketListed(IFixedLender fixedLender);

    /**
     * @notice Event emitted when a user enters a market to use his deposit as collateral
     *         for a loan
     * @param fixedLender address of the market that the user entered
     * @param account address of the user that just entered a market
     */
    event MarketEntered(IFixedLender indexed fixedLender, address account);

    /**
     * @notice Event emitted when a user leaves a market. This means that he would stop using
     *         his deposit as collateral and it won't ask for any loans in this market
     * @param fixedLender address of the market that the user just left
     * @param account address of the user that just left a market
     */
    event MarketExited(IFixedLender indexed fixedLender, address account);

    /**
     * @notice Event emitted when a new Oracle has been set
     * @param newOracle address of the new oracle that is used to calculate liquidity
     */
    event OracleChanged(IOracle newOracle);

    /**
     * @notice Event emitted when a new borrow cap has been set for a certain fixedLender
     *         If newBorrowCap is 0, that means that there's no cap
     * @param fixedLender address of the lender that has a new borrow cap
     * @param newBorrowCap new borrow cap expressed with 1e18 precision for the given market.
     *                     0 = means no cap
     */
    event NewBorrowCap(IFixedLender indexed fixedLender, uint256 newBorrowCap);

    /// @notice emitted when a collateral factor is changed by admin.
    /// @param fixedLender address of the market that has a new collateral factor.
    /// @param newCollateralFactor collateral factor for the underlying asset.
    event NewCollateralFactor(
        IFixedLender indexed fixedLender,
        uint256 newCollateralFactor
    );

    constructor(address _priceOracleAddress) {
        oracle = IOracle(_priceOracleAddress);
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @dev Allows wallet to enter certain markets (fixedLenderDAI, fixedLenderETH, etc)
     *      By performing this action, the wallet's money could be used as collateral
     * @param fixedLenders contracts addresses to enable for `msg.sender`
     */
    function enterMarkets(IFixedLender[] calldata fixedLenders) external {
        uint8 len = uint8(fixedLenders.length);
        for (uint256 i = 0; i < len; ) {
            uint8 marketIndex = validateMarketListed(fixedLenders[i]);
            uint256 assets = accountAssets[msg.sender];

            if ((assets & (1 << marketIndex)) == 1) return;
            accountAssets[msg.sender] = assets | 1 << marketIndex;

            emit MarketEntered(fixedLenders[i], msg.sender);

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Removes fixedLender from sender's account liquidity calculation
     * @dev Sender must not have an outstanding borrow balance in the asset,
     *      or be providing necessary collateral for an outstanding borrow.
     * @param fixedLender The address of the asset to be removed
     */
    function exitMarket(IFixedLender fixedLender) external {
        uint8 marketIndex = validateMarketListed(fixedLender);

        (uint256 amountHeld, uint256 borrowBalance) = fixedLender
            .getAccountSnapshot(msg.sender, PoolLib.MATURITY_ALL);

        /* Fail if the sender has a borrow balance */
        if (borrowBalance != 0) revert BalanceOwed();

        /* Fail if the sender is not permitted to redeem all of their tokens */
        validateAccountShortfall(fixedLender, msg.sender, amountHeld);

        uint256 assets = accountAssets[msg.sender];

        if ((assets & (1 << marketIndex)) == 0) return;
        accountAssets[msg.sender] = assets & ~(1 << marketIndex);

        emit MarketExited(fixedLender, msg.sender);
    }

    /**
     * @dev Function to set Oracle's to be used
     * @param _priceOracleAddress address of the new oracle
     */
    function setOracle(IOracle _priceOracleAddress)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        oracle = _priceOracleAddress;
        emit OracleChanged(_priceOracleAddress);
    }

    /**
     * @notice Set liquidation incentive for the whole ecosystem
     * @param _liquidationIncentive new liquidation incentive. It's a factor, so 15% would be 1.15e18
     */
    function setLiquidationIncentive(uint256 _liquidationIncentive)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        liquidationIncentive = _liquidationIncentive;
    }

    /**
     * @dev Function to enable a certain FixedLender market
     * @param fixedLender address to add to the protocol
     * @param collateralFactor fixedLender's collateral factor for the underlying asset
     * @param symbol symbol of the market's underlying asset
     * @param name name of the market's underlying asset
     * @param decimals decimals of the market's underlying asset
     */
    function enableMarket(
        IFixedLender fixedLender,
        uint128 collateralFactor,
        string memory symbol,
        string memory name,
        uint8 decimals
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (fixedLender.getAuditor() != this) revert AuditorMismatch();

        if (markets[fixedLender].isListed) revert MarketAlreadyListed();

        marketAddresses.push(fixedLender);

        markets[fixedLender] = Market({
            isListed: true,
            collateralFactor: collateralFactor,
            symbol: symbol,
            name: name,
            decimals: decimals,
            index: uint8(marketAddresses.length - 1)
        });

        emit MarketListed(fixedLender);
    }

    /// @notice sets the collateral factor for a certain fixedLender.
    /// @param fixedLender address of the market to change collateral factor for.
    /// @param collateralFactor collateral factor for the underlying asset.
    function setCollateralFactor(
        IFixedLender fixedLender,
        uint128 collateralFactor
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        markets[fixedLender].collateralFactor = collateralFactor;
        emit NewCollateralFactor(fixedLender, collateralFactor);
    }

    /**
     * @notice Set the given borrow caps for the given fixedLender markets. Borrowing that brings total borrows to or above borrow cap will revert.
     * @param fixedLenders The addresses of the markets (tokens) to change the borrow caps for
     * @param newBorrowCaps The new borrow cap values in underlying to be set. A value of 0 corresponds to unlimited borrowing.
     */
    function setMarketBorrowCaps(
        IFixedLender[] calldata fixedLenders,
        uint256[] calldata newBorrowCaps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 numMarkets = fixedLenders.length;
        uint256 numBorrowCaps = newBorrowCaps.length;

        if (numMarkets == 0 || numMarkets != numBorrowCaps) {
            revert InvalidBorrowCaps();
        }

        for (uint256 i = 0; i < numMarkets; ) {
            validateMarketListed(fixedLenders[i]);

            borrowCaps[fixedLenders[i]] = newBorrowCaps[i];
            emit NewBorrowCap(fixedLenders[i], newBorrowCaps[i]);

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Hook function to be called after calling the poolAccounting borrowMP function. Validates
     *      that the current state of the position and system are valid (liquidity)
     * @param fixedLender address of the fixedLender that will lend money in a maturity
     * @param borrower address of the user that will borrow money from a maturity date
     */
    function validateBorrowMP(IFixedLender fixedLender, address borrower)
        external
        override
    {
        uint8 index = validateMarketListed(fixedLender);
        uint256 assets = accountAssets[borrower];

        // we validate borrow state
        if ((assets & (1 << index)) == 0) {
            // only fixedLenders may call borrowAllowed if borrower not in market
            if (msg.sender != address(fixedLender)) revert NotFixedLender();
            accountAssets[borrower] = assets | 1 << index;
            emit MarketEntered(fixedLender, borrower);
        }

        uint256 borrowCap = borrowCaps[fixedLender];
        // Borrow cap of 0 corresponds to unlimited borrowing
        if (borrowCap != 0) {
            uint256 totalBorrows = fixedLender.totalMpBorrows();
            if (totalBorrows >= borrowCap) revert BorrowCapReached();
        }

        // We verify that current liquidity is not short
        (, uint256 shortfall) = accountLiquidity(borrower, fixedLender, 0, 0);

        if (shortfall > 0) revert InsufficientLiquidity();
    }

    /**
     * @dev Function to allow/reject liquidation of assets. This function can be called
     *      externally, but only will have effect when called from a fixedLender.
     * @param fixedLenderBorrowed market from where the debt is pending
     * @param fixedLenderCollateral market where the assets will be liquidated (should be msg.sender on FixedLender.sol)
     * @param liquidator address that is liquidating the assets
     * @param borrower address which the assets are being liquidated
     * @param repayAmount amount to be repaid from the debt (outstanding debt * close factor should be bigger than this value)
     */
    function liquidateAllowed(
        IFixedLender fixedLenderBorrowed,
        IFixedLender fixedLenderCollateral,
        address liquidator,
        address borrower,
        uint256 repayAmount
    ) external view override {
        if (borrower == liquidator) revert LiquidatorNotBorrower();

        // if markets are listed, they have the same auditor
        if (
            !markets[fixedLenderBorrowed].isListed ||
            !markets[fixedLenderCollateral].isListed
        ) revert MarketNotListed();

        /* The borrower must have shortfall in order to be liquidatable */
        (, uint256 shortfall) = accountLiquidity(
            borrower,
            IFixedLender(address(0)),
            0,
            0
        );

        if (shortfall == 0) revert InsufficientShortfall();

        /* The liquidator may not repay more than what is allowed by the CLOSE_FACTOR */
        (, uint256 borrowBalance) = IFixedLender(fixedLenderBorrowed)
            .getAccountSnapshot(borrower, PoolLib.MATURITY_ALL);
        uint256 maxClose = CLOSE_FACTOR.fmul(borrowBalance, 1e18);
        if (repayAmount > maxClose) revert TooMuchRepay();
    }

    /**
     * @dev Function to allow/reject seizing of assets. This function can be called
     *      externally, but only will have effect when called from a fixedLender.
     * @param fixedLenderCollateral market where the assets will be seized (should be msg.sender on FixedLender.sol)
     * @param fixedLenderBorrowed market from where the debt will be paid
     * @param liquidator address to validate where the seized assets will be received
     * @param borrower address to validate where the assets will be removed
     */
    function seizeAllowed(
        IFixedLender fixedLenderCollateral,
        IFixedLender fixedLenderBorrowed,
        address liquidator,
        address borrower
    ) external view override {
        if (borrower == liquidator) revert LiquidatorNotBorrower();

        // If markets are listed, they have also the same Auditor
        if (
            !markets[fixedLenderCollateral].isListed ||
            !markets[fixedLenderBorrowed].isListed
        ) revert MarketNotListed();
    }

    /**
     * @dev Given a fixedLender address, it returns the corresponding market data
     * @param fixedLender Address of the contract where we are getting the data
     */
    function getMarketData(IFixedLender fixedLender)
        external
        view
        returns (
            string memory,
            string memory,
            bool,
            uint256,
            uint8,
            IFixedLender
        )
    {
        validateMarketListed(fixedLender);

        Market memory marketData = markets[fixedLender];
        return (
            marketData.symbol,
            marketData.name,
            marketData.isListed,
            marketData.collateralFactor,
            marketData.decimals,
            fixedLender
        );
    }

    /**
     * @dev Function to get account's liquidity
     * @param account wallet to retrieve liquidity
     */
    function getAccountLiquidity(address account)
        external
        view
        override
        returns (uint256, uint256)
    {
        return accountLiquidity(account, IFixedLender(address(0)), 0, 0);
    }

    /**
     * @dev Function to calculate the amount of assets to be seized
     *      - when a position is undercollaterized it should be repaid and this functions calculates the
     *        amount of collateral to be seized
     * @param fixedLenderCollateral market where the assets will be liquidated (should be msg.sender on FixedLender.sol)
     * @param fixedLenderBorrowed market from where the debt is pending
     * @param actualRepayAmount repay amount in the borrowed asset
     */
    function liquidateCalculateSeizeAmount(
        IFixedLender fixedLenderBorrowed,
        IFixedLender fixedLenderCollateral,
        uint256 actualRepayAmount
    ) external view override returns (uint256) {
        /* Read oracle prices for borrowed and collateral markets */
        uint256 priceBorrowed = oracle.getAssetPrice(
            IFixedLender(fixedLenderBorrowed).underlyingTokenSymbol()
        );
        uint256 priceCollateral = oracle.getAssetPrice(
            IFixedLender(fixedLenderCollateral).underlyingTokenSymbol()
        );

        uint256 amountInUSD = actualRepayAmount.fmul(
            priceBorrowed,
            10**markets[fixedLenderBorrowed].decimals
        );
        // 10**18: usd amount decimals
        uint256 seizeTokens = amountInUSD.fmul(
            10**markets[fixedLenderCollateral].decimals,
            priceCollateral
        );

        return seizeTokens.fmul(liquidationIncentive, 1e18);
    }

    /**
     * @dev Function to retrieve all markets
     */
    function getMarketAddresses()
        external
        view
        override
        returns (IFixedLender[] memory)
    {
        return marketAddresses;
    }

    /**
     * @dev Function to be called before someone wants to interact with its smart pool position.
     *      This function checks if the user has no outstanding debts.
     *      This function is called indirectly from fixedLender contracts(withdraw), eToken transfers and directly from
     *      this contract when the user wants to exit a market.
     * @param fixedLender address of the fixedLender where the smart pool belongs
     * @param account address of the user to check for possible shortfall
     * @param amount amount that the user wants to withdraw or transfer
     */
    function validateAccountShortfall(
        IFixedLender fixedLender,
        address account,
        uint256 amount
    ) public view override {
        /* Otherwise, perform a hypothetical liquidity check to guard against shortfall */
        (, uint256 shortfall) = accountLiquidity(
            account,
            fixedLender,
            amount,
            0
        );
        if (shortfall > 0) revert InsufficientLiquidity();
    }

    /**
     * @dev Function to get account's liquidity for a certain market/maturity pool
     * @param account wallet which the liquidity will be calculated
     * @param fixedLenderToSimulate fixedLender in which we want to simulate withdraw/borrow ops (see next two args)
     * @param withdrawAmount amount to simulate withdraw
     * @param borrowAmount amount to simulate borrow
     */
    function accountLiquidity(
        address account,
        IFixedLender fixedLenderToSimulate,
        uint256 withdrawAmount,
        uint256 borrowAmount
    ) internal view returns (uint256, uint256) {
        AccountLiquidity memory vars; // Holds all our calculation results

        // For each asset the account is in
        uint256 assets = accountAssets[account];
        uint8 maxValue = uint8(marketAddresses.length);
        for (uint8 i = 0; i < maxValue;) {
            if ((assets & (1 << i)) == 0) {
                if (i > assets) break;
                unchecked {
                    ++i;
                }
                continue;
            }
            IFixedLender asset = marketAddresses[i];
            vars.decimals = markets[asset].decimals;
            vars.collateralFactor = markets[asset].collateralFactor;

            // Read the balances
            (vars.balance, vars.borrowBalance) = asset.getAccountSnapshot(
                account,
                PoolLib.MATURITY_ALL
            );

            // Get the normalized price of the asset (18 decimals)
            vars.oraclePrice = oracle.getAssetPrice(
                asset.underlyingTokenSymbol()
            );

            // We sum all the collateral prices
            vars.sumCollateral += vars
                .balance
                .fmul(vars.oraclePrice, 10**vars.decimals)
                .fmul(vars.collateralFactor, 1e18);

            // We sum all the debt
            vars.sumDebt += vars.borrowBalance.fmul(
                vars.oraclePrice,
                10**vars.decimals
            );

            // Simulate the effects of borrowing from/lending to a pool
            if (asset == IFixedLender(fixedLenderToSimulate)) {
                // Calculate the effects of borrowing fixedLenders
                if (borrowAmount != 0) {
                    vars.sumDebt += borrowAmount.fmul(
                        vars.oraclePrice,
                        10**vars.decimals
                    );
                }

                // Calculate the effects of redeeming fixedLenders
                // (having less collateral is the same as having more debt for this calculation)
                if (withdrawAmount != 0) {
                    vars.sumDebt += withdrawAmount
                        .fmul(vars.oraclePrice, 10**vars.decimals)
                        .fmul(vars.collateralFactor, 1e18);
                }
            }

            unchecked {
                ++i;
            }
        }

        // These are safe, as the underflow condition is checked first
        if (vars.sumCollateral > vars.sumDebt) {
            return (vars.sumCollateral - vars.sumDebt, 0);
        } else {
            return (0, vars.sumDebt - vars.sumCollateral);
        }
    }

    /**
     * @dev This function verifies if market is listed as valid
     * @param fixedLender address of the fixedLender to be validated by the auditor
     */
    function validateMarketListed(IFixedLender fixedLender) internal view returns (uint8) {
        if (!markets[fixedLender].isListed) revert MarketNotListed();
        return markets[fixedLender].index;
    }
}
