// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IProbabilityOracle {
    function isPayoutEvent(uint256 productId) external view returns (bool);
}

contract InsuranceProtocol is ReentrancyGuard {
    struct Product {
        string name;
        uint256 premium;
        uint256 liability;
        uint256 duration;
        address oracle;
    }

    struct Policy {
        address customer;
        uint256 productId;
        uint256 startTime;
        uint256 expiryTime;
        bool isClaimed;
        bool isActive;
    }

    mapping(uint256 => Product) public products;
    mapping(uint256 => Policy) public policies;
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalLiquidity;
    uint256 public totalLocked;
    uint256 public productCount;
    uint256 public policyCount;
    uint256 public maxUtilizationPercentDelta;

    event Staked(address indexed user, uint256 amount, uint256 sharesMinted);
    event Unstaked(address indexed user, uint256 amount, uint256 sharesBurned);
    event PolicyPurchased(uint256 indexed policyId, address indexed customer, uint256 productId);
    event ClaimPaid(uint256 indexed policyId, uint256 amount);
    event PolicyExpired(uint256 indexed policyId);

    modifier onlyActivePolicy(uint256 _policyId) {
        require(policies[_policyId].isActive, "Policy is not active");
        require(!policies[_policyId].isClaimed, "Already claimed");
        _;
    }

    constructor(
        uint256 _maxUtilizationPercentDelta,
        string[] memory _names,
        uint256[] memory _premiums,
        uint256[] memory _liabilities,
        uint256[] memory _durations,
        address[] memory _oracles
    ) {
        require(_maxUtilizationPercentDelta <= 100, "Invalid percentage");
        require(
            _names.length == _premiums.length &&
            _premiums.length == _liabilities.length &&
            _liabilities.length == _durations.length &&
            _durations.length == _oracles.length,
            "Product array length mismatch"
        );
        maxUtilizationPercentDelta = _maxUtilizationPercentDelta;
        for (uint256 i = 0; i < _names.length; i++) {
            _addProduct(_names[i], _premiums[i], _liabilities[i], _durations[i], _oracles[i]);
        }
    }

    function _addProduct(
        string memory _name,
        uint256 _premium,
        uint256 _liability,
        uint256 _duration,
        address _oracle
    ) internal {
        require(_oracle != address(0), "Oracle required");
        productCount++;
        products[productCount] = Product({
            name: _name,
            premium: _premium,
            liability: _liability,
            duration: _duration,
            oracle: _oracle
        });
    }

    function stake() external payable nonReentrant {
        require(msg.value > 0, "Must stake ETH");
        uint256 sharesToMint;
        if (totalShares == 0) {
            sharesToMint = msg.value;
        } else {
            sharesToMint = (msg.value * totalShares) / totalLiquidity;
        }
        shares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;
        totalLiquidity += msg.value;
        emit Staked(msg.sender, msg.value, sharesToMint);
    }

    function unstake(uint256 _sharesToBurn) external nonReentrant {
        require(_sharesToBurn > 0, "Must burn shares");
        uint256 lockedPortion = (shares[msg.sender] * totalLocked) / totalLiquidity;
        uint256 withdrawableShares = shares[msg.sender] - lockedPortion;
        require(withdrawableShares >= _sharesToBurn, "Insufficient shares");
        uint256 withdrawAmount = (_sharesToBurn * totalLiquidity) / totalShares;
        shares[msg.sender] -= _sharesToBurn;
        totalShares -= _sharesToBurn;
        totalLiquidity -= withdrawAmount;
        payable(msg.sender).transfer(withdrawAmount);
        emit Unstaked(msg.sender, withdrawAmount, _sharesToBurn);
    }

    function purchasePolicy(uint256 _productId) external payable nonReentrant returns (uint256){
        require(_productId > 0 && _productId <= productCount, "Invalid product");
        Product memory prod = products[_productId];
        require(msg.value >= prod.premium, "Premium too low");
        uint256 newTotalLocked = totalLocked + prod.liability;
        uint256 maxAllowedLock = (totalLiquidity * maxUtilizationPercentDelta) / 100;
        require(newTotalLocked <= totalLiquidity, "Risk limit reached: Not enough capital");
        require(prod.liability <= maxAllowedLock, "Product liability exceeds pool risk delta limit");
        totalLiquidity += prod.premium;
        totalLocked += prod.liability;
        policyCount++;
        policies[policyCount] = Policy({
            customer: msg.sender,
            productId: _productId,
            startTime: block.timestamp,
            expiryTime: block.timestamp + prod.duration,
            isClaimed: false,
            isActive: true
        });
        emit PolicyPurchased(policyCount, msg.sender, _productId);
        uint256 refund = msg.value - prod.premium;
        if (refund > 0) {
            payable(msg.sender).transfer(refund);
        }
        return policyCount;
    }

    function attemptClaim(uint256 _policyId) external nonReentrant onlyActivePolicy(_policyId) {
        Policy storage pol = policies[_policyId];
        if (block.timestamp > pol.expiryTime) {
            _expirePolicy(_policyId);
            revert("Policy expired");
        }
        Product memory prod = products[pol.productId];
        bool isPayout = IProbabilityOracle(prod.oracle).isPayoutEvent(pol.productId);
        if (isPayout) {
            _payClaim(_policyId);
        }
    }

    function _payClaim(uint256 _policyId) internal {
        Policy storage pol = policies[_policyId];
        Product memory prod = products[pol.productId];
        pol.isClaimed = true;
        pol.isActive = false;
        totalLocked -= prod.liability;
        totalLiquidity -= prod.liability;
        payable(pol.customer).transfer(prod.liability);
        emit ClaimPaid(_policyId, prod.liability);
    }

    function processExpiry(uint256 _policyId) external {
        Policy storage pol = policies[_policyId];
        require(pol.isActive, "Policy already inactive");
        require(block.timestamp > pol.expiryTime, "Not yet expired");
        _expirePolicy(_policyId);
    }

    function _expirePolicy(uint256 _policyId) internal {
        Policy storage pol = policies[_policyId];
        Product memory prod = products[pol.productId];
        pol.isActive = false;
        totalLocked -= prod.liability;
        emit PolicyExpired(_policyId);
    }
}