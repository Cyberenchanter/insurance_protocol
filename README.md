# Insurance Protocol

## Overview
A pooled on-chain insurance protocol where stakers supply liquidity and customers buy parametric policies tied to per-product oracles.

## Contracts
- `InsuranceProtocol`: core pool; manages products, staking, policy purchases, claims, and expiries. Uses `ReentrancyGuard`.
- `DemoInsuranceOracle`: simple probability-based oracle implementing `isPayoutEvent(uint256)`.

## Key Mechanics
- Products are immutable after deployment and set via constructor arrays (names, premiums, liabilities, durations, oracle addresses).
- Staking mints shares against pool value; unstaking blocks locked portions backing active policies.
- Purchasing requires `msg.value >= premium`; only the premium is added to liquidity, and any excess is refunded.
- Claims call the configured product oracle; payout transfers liability, reducing liquidity and locked amounts.
- Anyone can process expired policies to unlock capital.

## Dependencies
- OpenZeppelin `ReentrancyGuard` (`@openzeppelin/contracts/security/ReentrancyGuard.sol`).

## Build & Test
- Install dependencies (e.g., `npm install` with Hardhat/Foundry setup).
- Compile: `npx hardhat compile`.
- Test: `npx hardhat test`.

## Deployment
Constructor params (in order):
1. `maxUtilizationPercentDelta` (uint256, 0-100)
2. `names` (string[])
3. `premiums` (uint256[])
4. `liabilities` (uint256[])
5. `durations` (uint256[])
6. `oracles` (address[])
Array lengths must match.

## Usage
- Stake: `stake()` payable.
- Unstake: `unstake(sharesToBurn)`.
- Purchase: `purchasePolicy(productId)` payable (overpay allowed; auto-refund).
- Claim: `attemptClaim(policyId)`.
- Expire: `processExpiry(policyId)`.

## Oracle Notes
Each product specifies its own oracle address implementing `IProbabilityOracle.isPayoutEvent`. The demo oracle uses a pseudo-random check with per-product probabilities (bps).
