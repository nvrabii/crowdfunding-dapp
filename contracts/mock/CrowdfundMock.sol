// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../Crowdfund.sol";

// ATTENTION: Use exclusively for testing
//
// Mock version of the Crowdfund contract
contract CrowdfundMock is Crowdfund {
    uint256 private _time = block.timestamp;

    constructor(uint256 target, uint256 duration) Crowdfund(target, duration) {}

    // Override by returning the set _time instead of block.timestamp
    function getTime() internal view override returns (uint256) {
        return _time != 0 ? _time : block.timestamp;
    }

    function frozenAmount() public view returns (uint256) {
        return _frozenAmount;
    }

    function setTime(uint256 time) public {
        _time = time;
    }
}
