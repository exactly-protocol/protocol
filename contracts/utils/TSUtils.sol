// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.4;

library TSUtils {
    enum State {
        NONE,
        INVALID,
        MATURED,
        VALID,
        NOT_READY
    }

    error UnmatchedPoolState(uint8 state, uint8 requiredState);
    error UnmatchedPoolStateMultiple(
        uint8 state,
        uint8 requiredState,
        uint8 alternativeState
    );

    uint32 public constant INTERVAL = 7 days;


    /**
     * @notice Function to calculate how many seconds are left to a certain date
     * @param maturityHolder to calculate the difference in seconds from a date
     * @param maturityDate to calculate the difference in seconds to a date
     */
    function addMaturity(uint256 maturityHolder, uint256 maturityDate)
        internal
        pure
        returns (uint256)
    {
        if (maturityHolder == 0) {
            // we initialize the maturity date with also the 1st bit
            // on the 33nd position ON
            return maturityDate | (1 << 32);
        }

        uint32 baseTimestamp = uint32(maturityHolder % (2 ** 32));
        if (maturityDate < baseTimestamp) {
            // If the new maturity date if lower than the base, then we need to
            // set it as the new base. We wipe clean the last 32 bits, we shift
            // the amount of INTERVALS and we set the new value with the 33rd bit ON
            maturityHolder = ((maturityHolder >> 32) << 32);
            maturityHolder = maturityHolder << uint32((baseTimestamp - maturityDate) / INTERVAL);
            return maturityDate | maturityHolder | (1 << 32);
        } else {
            return maturityHolder | 1 << (32 + ((maturityDate - baseTimestamp) / INTERVAL));
        }
    }

    /**
     * @notice Function to calculate how many seconds are left to a certain date
     * @param timestampFrom to calculate the difference in seconds from a date
     * @param timestampTo to calculate the difference in seconds to a date
     */
    function secondsPre(uint256 timestampFrom, uint256 timestampTo)
        internal
        pure
        returns (uint256)
    {
        return timestampFrom < timestampTo ? timestampTo - timestampFrom : 0;
    }

    /**
     * @notice Function to return a pool _time_ state based on the current time,
     *         maxPools available, and the INTERVALS configured, all to return
     *         if a pool is VALID, not yet available(NOT_READY), INVALID or MATURED
     * @param currentTimestamp timestamp of the current time
     * @param timestamp used as POOLID
     * @param maxPools number of pools available in the time horizon to be available
     */
    function getPoolState(
        uint256 currentTimestamp,
        uint256 timestamp,
        uint8 maxPools
    ) private pure returns (State) {
        if (timestamp % INTERVAL != 0) {
            return State.INVALID;
        }

        if (timestamp < currentTimestamp) {
            return State.MATURED;
        }

        if (
            timestamp >
            currentTimestamp -
                (currentTimestamp % INTERVAL) +
                (INTERVAL * maxPools)
        ) {
            return State.NOT_READY;
        }

        return State.VALID;
    }

    /**
     * @dev Function to verify that a maturityDate is VALID, MATURED, NOT_READY or INVALID.
     *      If expected state doesn't match the calculated one, it reverts with a custom error "UnmatchedPoolState".
     * @param maturityDate timestamp of the maturity date to be verified
     * @param requiredState state required by the caller to be verified (see TSUtils.State() for description)
     * @param alternativeState state required by the caller to be verified (see TSUtils.State() for description)
     */
    function validateRequiredPoolState(
        uint8 maxFuturePools,
        uint256 maturityDate,
        State requiredState,
        State alternativeState
    ) internal view {
        State poolState = getPoolState(
            block.timestamp,
            maturityDate,
            maxFuturePools
        );

        if (poolState != requiredState && poolState != alternativeState) {
            if (alternativeState == State.NONE) {
                revert UnmatchedPoolState(
                    uint8(poolState),
                    uint8(requiredState)
                );
            }
            revert UnmatchedPoolStateMultiple(
                uint8(poolState),
                uint8(requiredState),
                uint8(alternativeState)
            );
        }
    }

    /**
     * @notice Function to return all the future pool IDs give in a certain time horizon that
     *         gets calculated using a startTime, the amount of pools to returns, and the INTERVAL
     *         configured in this library
     */
    function futurePools(uint8 maxFuturePools)
        internal
        view
        returns (uint256[] memory)
    {
        uint256[] memory poolIDs = new uint256[](maxFuturePools);
        uint256 timestamp = block.timestamp - (block.timestamp % INTERVAL);
        for (uint256 i = 0; i < maxFuturePools; i++) {
            timestamp += INTERVAL;
            poolIDs[i] = timestamp;
        }
        return poolIDs;
    }
}
