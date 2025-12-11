// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract DemoInsuranceOracle {
    mapping(uint256 => uint16) private probabilityBps; // 0-10000

    constructor(uint256[] memory productIds, uint16[] memory probabilitiesBps) {
        require(productIds.length == probabilitiesBps.length, "Length mismatch");
        for (uint256 i = 0; i < productIds.length; i++) {
            require(probabilitiesBps[i] <= 10000, "Invalid probability");
            probabilityBps[productIds[i]] = probabilitiesBps[i];
        }
    }

    function isPayoutEvent(uint256 productId) external view returns (bool) {
        uint16 prob = probabilityBps[productId];
        require(prob > 0, "Probability not set");
        uint256 rand = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, productId)));
        return rand % 10000 < prob;
    }
}
