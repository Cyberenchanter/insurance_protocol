import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("InsuranceProtocol", function () {
  let insuranceProtocol: any;
  let mockOracle: any;
  let owner: any;
  let lpProvider: any;
  let policyHolder: any;

  const PRODUCT_NAME = "Flight Delay";
  const PREMIUM = ethers.parseEther("0.1");
  const LIABILITY = ethers.parseEther("1.0");
  const DURATION = 5; // 5 seconds
  const MAX_UTILIZATION = 20;

  beforeEach(async function () {
    [owner, lpProvider, policyHolder] = await ethers.getSigners();

    // Deploy Mock Oracle
    const MockOracleFactory = await ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracleFactory.deploy();
    await mockOracle.waitForDeployment();

    // Deploy Insurance Protocol
    const InsuranceProtocolFactory = await ethers.getContractFactory("InsuranceProtocol");
    insuranceProtocol = await InsuranceProtocolFactory.deploy(
      MAX_UTILIZATION,
      [PRODUCT_NAME],
      [PREMIUM],
      [LIABILITY],
      [DURATION],
      [await mockOracle.getAddress()]
    );
    await insuranceProtocol.waitForDeployment();
  });

  it("Should allow staking liquidity", async function () {
    const stakeAmount = ethers.parseEther("10");
    await insuranceProtocol.connect(lpProvider).stake({ value: stakeAmount });

    expect(await insuranceProtocol.totalLiquidity()).to.equal(stakeAmount);
    expect(await insuranceProtocol.shares(lpProvider.address)).to.equal(stakeAmount);
  });

  it("Should allow purchasing a policy", async function () {
    // LP provides liquidity first
    await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });

    await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

    const policy = await insuranceProtocol.policies(1);
    expect(policy.customer).to.equal(policyHolder.address);
    expect(policy.isActive).to.be.true;
    expect(await insuranceProtocol.totalLocked()).to.equal(LIABILITY);
  });

  it("Should process a valid claim", async function () {
    // LP stakes
    await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });

    // Purchase policy
    await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

    // Set Oracle to payout
    await mockOracle.setPayout(true);

    // Attempt claim
    await expect(insuranceProtocol.connect(policyHolder).attemptClaim(1))
      .to.emit(insuranceProtocol, "ClaimPaid")
      .withArgs(1, LIABILITY);

    const policy = await insuranceProtocol.policies(1);
    expect(policy.isClaimed).to.be.true;
    expect(policy.isActive).to.be.false;
  });

  it("Should not pay out if oracle returns false", async function () {
    await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
    await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

    await mockOracle.setPayout(false);

    await insuranceProtocol.connect(policyHolder).attemptClaim(1);
    
    const policy = await insuranceProtocol.policies(1);
    expect(policy.isClaimed).to.be.false;
    expect(policy.isActive).to.be.true;
  });

  it("Should fail to purchase if liquidity is insufficient for risk", async function () {
    // LP stakes very little
    await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("0.5") });

    // Try to buy policy with 1.0 ETH liability
    await expect(
      insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM })
    ).to.be.revertedWith("Risk limit reached: Not enough capital");
  });

  describe("Invalid operations", function () {
    it("Should revert when staking 0 ETH", async function () {
      await expect(insuranceProtocol.connect(lpProvider).stake({ value: 0n }))
        .to.be.revertedWith("Must stake ETH");
    });

    it("Should revert when unstaking 0 shares", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("1") });
      await expect(insuranceProtocol.connect(lpProvider).unstake(0))
        .to.be.revertedWith("Must burn shares");
    });

    it("Should revert when unstaking more than withdrawable shares", async function () {
      const stakeAmount = ethers.parseEther("10");
      await insuranceProtocol.connect(lpProvider).stake({ value: stakeAmount });

      // Lock some capital by selling a policy
      await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

      const lpShares = await insuranceProtocol.shares(lpProvider.address);

      // Burning all shares should fail because some portion is locked
      await expect(insuranceProtocol.connect(lpProvider).unstake(lpShares))
        .to.be.revertedWith("Insufficient shares");
    });

    it("Should revert purchasing with invalid productId (0)", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
      await expect(
        insuranceProtocol.connect(policyHolder).purchasePolicy(0, { value: PREMIUM })
      ).to.be.revertedWith("Invalid product");
    });

    it("Should revert purchasing with invalid productId (> productCount)", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
      await expect(
        insuranceProtocol.connect(policyHolder).purchasePolicy(2, { value: PREMIUM })
      ).to.be.revertedWith("Invalid product");
    });

    it("Should revert purchasing when premium is too low", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
      await expect(
        insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM - 1n })
      ).to.be.revertedWith("Premium too low");
    });

    it("Should revert attempting a claim twice", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
      await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

      await mockOracle.setPayout(true);
      await insuranceProtocol.connect(policyHolder).attemptClaim(1);

      await expect(insuranceProtocol.connect(policyHolder).attemptClaim(1))
        .to.be.revertedWith("Policy is not active");
    });

    it("Should revert processing expiry before policy expiry time", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
      await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

      await expect(insuranceProtocol.processExpiry(1))
        .to.be.revertedWith("Not yet expired");
    });

    it("Should revert processing expiry on an already inactive policy", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
      await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

      await mockOracle.setPayout(true);
      await insuranceProtocol.connect(policyHolder).attemptClaim(1);

      await expect(insuranceProtocol.processExpiry(1))
        .to.be.revertedWith("Policy already inactive");
    });

    it("Should revert attempting a claim after expiry", async function () {
      await insuranceProtocol.connect(lpProvider).stake({ value: ethers.parseEther("10") });
      await insuranceProtocol.connect(policyHolder).purchasePolicy(1, { value: PREMIUM });

      await time.increase(DURATION + 1);

      await expect(insuranceProtocol.connect(policyHolder).attemptClaim(1))
        .to.be.revertedWith("Policy expired");
    });
  });
});
