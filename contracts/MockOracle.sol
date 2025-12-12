// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockOracle {
    bool public shouldPayout;

    function setPayout(bool _shouldPayout) external {
        shouldPayout = _shouldPayout;
    }

    function isPayoutEvent(uint256 /* productId */) external view returns (bool) {
        return shouldPayout;
    }
}
