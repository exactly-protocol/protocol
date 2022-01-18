// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/AccessControl.sol";

import "./interfaces/IEToken.sol";
import "./interfaces/IInterestRateModel.sol";
import "./interfaces/IPoolAccounting.sol";
import "./utils/TSUtils.sol";
import "./utils/DecimalMath.sol";
import "./utils/Errors.sol";

contract PoolAccounting is IPoolAccounting, AccessControl {
    using PoolLib for PoolLib.MaturityPool;
    using DecimalMath for uint256;

    // Vars used in `borrowMP` to avoid
    // stack too deep problem
    struct BorrowVars {
        uint256 commissionRate;
        uint256 commission;
        uint256 totalBorrow;
    }

    // Vars used in `repayMP` to avoid
    // stack too deep problem
    struct RepayVars {
        uint256 amountOwed;
        uint256 amountBorrowed;
        uint256 debtCovered;
        uint256 penalties;
        uint256 smartPoolDebtReduction;
        uint256 fee;
        uint256 earningsRepay;
    }

    mapping(uint256 => mapping(address => uint256)) public mpUserSuppliedAmount;
    mapping(uint256 => mapping(address => uint256)) public mpUserBorrowedAmount;

    mapping(address => uint256[]) public userMpBorrowed;
    mapping(uint256 => PoolLib.MaturityPool) public maturityPools;
    uint256 public override smartPoolBorrowed;

    address private fixedLenderAddress;
    IInterestRateModel public interestRateModel;

    event Initialized(address indexed fixedLender);

    /**
     * @dev modifier used to allow calls to certain functions only from
     * the `fixedLender` contract. `fixedLenderAddress` should be set
     * through `initialize` method
     */
    modifier onlyFixedLender() {
        if (msg.sender != address(fixedLenderAddress)) {
            revert GenericError(ErrorCode.CALLER_MUST_BE_FIXED_LENDER);
        }
        _;
    }

    constructor(address _interestRateModelAddress) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        interestRateModel = IInterestRateModel(_interestRateModelAddress);
    }

    /**
     * @dev Initializes the PoolAccounting setting the FixedLender address
     * - Only able to initialize once
     * @param _fixedLenderAddress The address of the FixedLender that uses this PoolAccounting
     */
    function initialize(address _fixedLenderAddress)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (fixedLenderAddress != address(0)) {
            revert GenericError(ErrorCode.CONTRACT_ALREADY_INITIALIZED);
        }

        fixedLenderAddress = _fixedLenderAddress;

        emit Initialized(_fixedLenderAddress);
    }

    /**
     * @dev Function to account for borrowing money from a maturity pool (MP).
     *      It doesn't check liquidity for the borrower, so the `fixedLender`
     *      should call `validateBorrowMP` immediately after calling this function.
     * @param maturityDate maturity date / pool id where the asset will be borrowed
     * @param borrower borrower that it will take the debt
     * @param amount amount that the borrower will be borrowing
     * @param maxAmountAllowed maximum amount that the borrower is willing to pay
     *        at maturity
     * @param maxSPDebt maximum amount of assset debt that the MP can have with the SP
     * @return total amount that will need to be paid at maturity
     */
    function borrowMP(
        uint256 maturityDate,
        address borrower,
        uint256 amount,
        uint256 maxAmountAllowed,
        uint256 maxSPDebt
    ) external override onlyFixedLender returns (uint256) {
        BorrowVars memory borrowVars;

        smartPoolBorrowed += maturityPools[maturityDate].takeMoney(
            amount,
            maxSPDebt
        );

        PoolLib.MaturityPool memory pool = maturityPools[maturityDate];

        borrowVars.commissionRate = interestRateModel.getRateToBorrow(
            maturityDate,
            pool,
            smartPoolBorrowed,
            maxSPDebt,
            true
        );
        borrowVars.commission = amount.mul_(borrowVars.commissionRate);

        if (amount + borrowVars.commission > maxAmountAllowed) {
            revert GenericError(ErrorCode.TOO_MUCH_SLIPPAGE);
        }

        borrowVars.totalBorrow = amount + borrowVars.commission;

        if (mpUserBorrowedAmount[maturityDate][borrower] == 0) {
            userMpBorrowed[borrower].push(maturityDate);
        }

        maturityPools[maturityDate].addFee(maturityDate, borrowVars.commission);

        mpUserBorrowedAmount[maturityDate][borrower] += borrowVars.totalBorrow;

        return borrowVars.totalBorrow;
    }

    /**
     * @dev Function to account for a deposit to a maturity pool (MP). It doesn't transfer or
     * @param maturityDate maturity date / pool id where the asset will be deposited
     * @param supplier address that will be depositing the assets
     * @param amount amount that the supplier will be depositing
     * @param minAmountRequired minimum amount that the borrower is expecting to receive at
     *        maturity
     * @return the amount that should be collected at maturity
     */
    function depositMP(
        uint256 maturityDate,
        address supplier,
        uint256 amount,
        uint256 minAmountRequired
    ) external override onlyFixedLender returns (uint256) {
        uint256 commission = maturityPools[maturityDate].addMoney(
            maturityDate,
            amount
        );

        if (amount + commission < minAmountRequired) {
            revert GenericError(ErrorCode.TOO_MUCH_SLIPPAGE);
        }

        uint256 currentTotalDeposit = amount + commission;
        mpUserSuppliedAmount[maturityDate][supplier] += currentTotalDeposit;

        return currentTotalDeposit;
    }

    /**
     * @dev Function to account for a withdraw from a maturity pool (MP).
     * @param maturityDate maturity date / pool id where the asset should be accounted for
     * @param redeemer address that should have the assets withdrawn
     * @param amount amount that the redeemer will be extracting
     * @param maxSPDebt max amount of debt that can be taken from the SP in case of illiquidity
     */
    function withdrawMP(
        uint256 maturityDate,
        address redeemer,
        uint256 amount,
        uint256 maxSPDebt
    ) external override onlyFixedLender {
        smartPoolBorrowed += maturityPools[maturityDate].takeMoney(
            amount,
            maxSPDebt
        );

        mpUserSuppliedAmount[maturityDate][redeemer] -= amount;
    }

    /**
     * @dev Function to account for a repayment to a maturity pool (MP).
     * @param maturityDate maturity date / pool id where the asset should be accounted for
     * @param borrower address where the debt will be reduced
     * @param repayAmount amount that it will be repaid in the MP
     */
    function repayMP(
        uint256 maturityDate,
        address borrower,
        uint256 repayAmount
    )
        external
        override
        onlyFixedLender
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        RepayVars memory repayVars;
        repayVars.amountOwed = getAccountBorrows(borrower, maturityDate);

        if (repayAmount > repayVars.amountOwed) {
            revert GenericError(ErrorCode.TOO_MUCH_REPAY_TRANSFER);
        }

        repayVars.amountBorrowed = mpUserBorrowedAmount[maturityDate][borrower];

        // We calculate the amount of the debt this covers, paying proportionally
        // the amount of interests on the overdue debt. If repay amount = amount owed,
        // then amountBorrowed is what should be discounted to the users account
        repayVars.debtCovered =
            (repayAmount * repayVars.amountBorrowed) /
            repayVars.amountOwed;
        repayVars.penalties = repayAmount - repayVars.debtCovered;

        mpUserBorrowedAmount[maturityDate][borrower] =
            repayVars.amountBorrowed -
            repayVars.debtCovered;

        if (mpUserBorrowedAmount[maturityDate][borrower] == 0) {
            uint256[] memory userMaturitiesBorrowedList = userMpBorrowed[
                borrower
            ];
            uint256 len = userMaturitiesBorrowedList.length;
            uint256 maturityIndex = len;
            for (uint256 i = 0; i < len; i++) {
                if (userMaturitiesBorrowedList[i] == maturityDate) {
                    maturityIndex = i;
                    break;
                }
            }

            // We *must* have found the maturity in the list or our redundant data structure is broken
            assert(maturityIndex < len);

            // copy last item in list to location of item to be removed, reduce length by 1
            uint256[] storage storedList = userMpBorrowed[borrower];
            storedList[maturityIndex] = storedList[storedList.length - 1];
            storedList.pop();
        }

        // Pays back in the following order:
        //       1) Maturity Pool Depositors
        //       2) Smart Pool Debt
        //       3) Earnings Smart Pool the rest
        (
            repayVars.smartPoolDebtReduction,
            repayVars.fee,
            repayVars.earningsRepay
        ) = maturityPools[maturityDate].repay(maturityDate, repayAmount);

        smartPoolBorrowed -= repayVars.smartPoolDebtReduction;

        return (
            repayVars.penalties,
            repayVars.debtCovered,
            repayVars.fee,
            repayVars.earningsRepay
        );
    }

    /**
     * @dev Gets all borrows for a wallet in certain maturity (or ALL_MATURITIES)
     * @param who wallet to return status snapshot in the specified maturity date
     * @param maturityDate maturityDate where the borrow is taking place.
     * - Send the value 0 in order to get the snapshot for all maturities where the user borrowed
     * @return the amount the user deposited to the smart pool and the total money he owes from maturities
     */
    function getAccountBorrows(address who, uint256 maturityDate)
        public
        view
        override
        returns (uint256)
    {
        uint256 debt;
        if (maturityDate == 0) {
            uint256 borrowsLength = userMpBorrowed[who].length;
            for (uint256 i = 0; i < borrowsLength; i++) {
                debt += getAccountDebt(who, userMpBorrowed[who][i]);
            }
        } else {
            debt = getAccountDebt(who, maturityDate);
        }

        return (debt);
    }

    /**
     * @dev Gets the total amount of borrowed money for a maturityDate
     * @param maturityDate maturity date
     */
    function getTotalMpBorrows(uint256 maturityDate)
        public
        view
        override
        returns (uint256)
    {
        if (!TSUtils.isPoolID(maturityDate)) {
            revert GenericError(ErrorCode.INVALID_POOL_ID);
        }
        return maturityPools[maturityDate].borrowed;
    }

    /**
     * @notice Internal function to get the debt + penalties of an account for a certain maturityDate
     * @param who wallet to return debt status for the specified maturityDate
     * @param maturityDate amount to be transfered
     * @return the total owed denominated in number of tokens
     */
    function getAccountDebt(address who, uint256 maturityDate)
        internal
        view
        returns (uint256)
    {
        if (!TSUtils.isPoolID(maturityDate)) {
            revert GenericError(ErrorCode.INVALID_POOL_ID);
        }

        uint256 debt = mpUserBorrowedAmount[maturityDate][who];
        uint256 daysDelayed = TSUtils.daysPre(maturityDate, block.timestamp);
        if (daysDelayed > 0) {
            debt += debt.mul_(daysDelayed * interestRateModel.penaltyRate());
        }

        return debt;
    }
}
