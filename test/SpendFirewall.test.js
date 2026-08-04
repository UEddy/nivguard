const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

// All amounts use the 6 decimal USDC ERC-20 view, which is what the
// contract stores and transfers. The 18 decimal native gas view of USDC on
// Arc never appears in policy math.
const usdc = (n) => ethers.parseUnits(String(n), 6);

const DAY = 24 * 60 * 60;

const REASON = {
  OK: 0,
  NOT_REGISTERED: 1,
  REVOKED: 2,
  MERCHANT_NOT_ALLOWED: 3,
  OVER_MAX_PER_TX: 4,
  OVER_PERIOD_BUDGET: 5,
  INSUFFICIENT_BALANCE: 6,
  ZERO_AMOUNT: 7,
};

// Default policy used across most tests.
const BUDGET = usdc(1000);
const PERIOD = DAY;
const MAX_PER_TX = usdc(250);

describe("SpendFirewall", function () {
  async function deployFixture() {
    const [owner, agent, otherAgent, merchant, badMerchant, stranger] =
      await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const token = await MockUSDC.deploy();
    await token.waitForDeployment();

    const SpendFirewall = await ethers.getContractFactory("SpendFirewall");
    const firewall = await SpendFirewall.deploy(
      await token.getAddress(),
      owner.address
    );
    await firewall.waitForDeployment();

    await token.mint(owner.address, usdc(1_000_000));
    await token
      .connect(owner)
      .approve(await firewall.getAddress(), ethers.MaxUint256);

    return {
      firewall,
      token,
      owner,
      agent,
      otherAgent,
      merchant,
      badMerchant,
      stranger,
    };
  }

  // Registered agent, allowlisted merchant, funded with 5000 USDC.
  async function fundedFixture() {
    const ctx = await loadFixture(deployFixture);
    const { firewall, owner, agent, merchant } = ctx;

    await firewall
      .connect(owner)
      .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX);
    await firewall
      .connect(owner)
      .setMerchantAllowed(agent.address, merchant.address, true);
    await firewall.connect(owner).deposit(agent.address, usdc(5000));

    return ctx;
  }

  // -------------------------------------------------------------------
  describe("deployment", function () {
    it("stores the usdc address and owner", async function () {
      const { firewall, token, owner } = await loadFixture(deployFixture);
      expect(await firewall.usdc()).to.equal(await token.getAddress());
      expect(await firewall.owner()).to.equal(owner.address);
    });

    it("rejects a zero usdc address", async function () {
      const { owner } = await loadFixture(deployFixture);
      const SpendFirewall = await ethers.getContractFactory("SpendFirewall");
      await expect(
        SpendFirewall.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(SpendFirewall, "ZeroAddress");
    });

    it("uses a 6 decimal usdc interface", async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.decimals()).to.equal(6);
    });
  });

  // -------------------------------------------------------------------
  describe("registerAgent", function () {
    it("registers an agent and emits AgentRegistered", async function () {
      const { firewall, owner, agent } = await loadFixture(deployFixture);

      await expect(
        firewall
          .connect(owner)
          .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX)
      )
        .to.emit(firewall, "AgentRegistered")
        .withArgs(agent.address, BUDGET, PERIOD, MAX_PER_TX);

      const p = await firewall.getPolicy(agent.address);
      expect(p.registered).to.equal(true);
      expect(p.revoked).to.equal(false);
      expect(p.budgetPerPeriod).to.equal(BUDGET);
      expect(p.periodSeconds).to.equal(PERIOD);
      expect(p.maxPerTx).to.equal(MAX_PER_TX);
      expect(p.periodSpent).to.equal(0);
      expect(p.remainingInPeriod).to.equal(BUDGET);
      expect(p.balance).to.equal(0);
    });

    it("only the owner can register", async function () {
      const { firewall, stranger, agent } = await loadFixture(deployFixture);
      await expect(
        firewall
          .connect(stranger)
          .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX)
      ).to.be.revertedWithCustomError(firewall, "OwnableUnauthorizedAccount");
    });

    it("rejects a duplicate registration", async function () {
      const { firewall, owner, agent } = await loadFixture(deployFixture);
      await firewall
        .connect(owner)
        .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX);
      await expect(
        firewall
          .connect(owner)
          .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX)
      )
        .to.be.revertedWithCustomError(firewall, "AgentAlreadyRegistered")
        .withArgs(agent.address);
    });

    it("rejects the zero address", async function () {
      const { firewall, owner } = await loadFixture(deployFixture);
      await expect(
        firewall
          .connect(owner)
          .registerAgent(ethers.ZeroAddress, BUDGET, PERIOD, MAX_PER_TX)
      ).to.be.revertedWithCustomError(firewall, "ZeroAddress");
    });

    it("rejects nonsense policies", async function () {
      const { firewall, owner, agent } = await loadFixture(deployFixture);
      const bad = [
        [0, PERIOD, MAX_PER_TX], // zero budget
        [BUDGET, 0, MAX_PER_TX], // zero period
        [BUDGET, PERIOD, 0], // zero maxPerTx
        [usdc(100), PERIOD, usdc(101)], // maxPerTx above the period budget
      ];
      for (const [b, s, m] of bad) {
        await expect(
          firewall.connect(owner).registerAgent(agent.address, b, s, m)
        ).to.be.revertedWithCustomError(firewall, "InvalidPolicy");
      }
    });
  });

  // -------------------------------------------------------------------
  describe("setMerchantAllowed", function () {
    it("allowlists and de-allowlists, emitting each time", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      expect(
        await firewall.isMerchantAllowed(agent.address, merchant.address)
      ).to.equal(true);

      await expect(
        firewall
          .connect(owner)
          .setMerchantAllowed(agent.address, merchant.address, false)
      )
        .to.emit(firewall, "MerchantAllowlisted")
        .withArgs(agent.address, merchant.address, false);

      expect(
        await firewall.isMerchantAllowed(agent.address, merchant.address)
      ).to.equal(false);
    });

    it("is per agent, not global", async function () {
      const { firewall, owner, agent, otherAgent, merchant } =
        await loadFixture(fundedFixture);

      await firewall
        .connect(owner)
        .registerAgent(otherAgent.address, BUDGET, PERIOD, MAX_PER_TX);

      expect(
        await firewall.isMerchantAllowed(otherAgent.address, merchant.address)
      ).to.equal(false);
    });

    it("only the owner can allowlist", async function () {
      const { firewall, stranger, agent, merchant } = await loadFixture(
        fundedFixture
      );
      await expect(
        firewall
          .connect(stranger)
          .setMerchantAllowed(agent.address, merchant.address, true)
      ).to.be.revertedWithCustomError(firewall, "OwnableUnauthorizedAccount");
    });

    it("rejects an unregistered agent and a zero merchant", async function () {
      const { firewall, owner, agent, otherAgent, merchant } =
        await loadFixture(fundedFixture);

      await expect(
        firewall
          .connect(owner)
          .setMerchantAllowed(otherAgent.address, merchant.address, true)
      ).to.be.revertedWithCustomError(firewall, "AgentNotRegistered");

      await expect(
        firewall
          .connect(owner)
          .setMerchantAllowed(agent.address, ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(firewall, "ZeroAddress");
    });
  });

  // -------------------------------------------------------------------
  describe("deposit and withdraw", function () {
    it("pulls usdc and credits the agent", async function () {
      const { firewall, token, owner, agent } = await loadFixture(
        deployFixture
      );
      await firewall
        .connect(owner)
        .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX);

      await expect(
        firewall.connect(owner).deposit(agent.address, usdc(500))
      ).to.changeTokenBalances(
        token,
        [owner, firewall],
        [-usdc(500), usdc(500)]
      );

      expect(await firewall.balanceOfAgent(agent.address)).to.equal(usdc(500));
      expect(await firewall.totalDeposited()).to.equal(usdc(500));
    });

    it("emits Deposited with the new balance", async function () {
      const { firewall, owner, agent } = await loadFixture(fundedFixture);
      await expect(firewall.connect(owner).deposit(agent.address, usdc(100)))
        .to.emit(firewall, "Deposited")
        .withArgs(agent.address, owner.address, usdc(100), usdc(5100));
    });

    it("rejects deposits from non owners, to unknown agents, or of zero", async function () {
      const { firewall, owner, stranger, agent, otherAgent } =
        await loadFixture(fundedFixture);

      await expect(
        firewall.connect(stranger).deposit(agent.address, usdc(1))
      ).to.be.revertedWithCustomError(firewall, "OwnableUnauthorizedAccount");

      await expect(
        firewall.connect(owner).deposit(otherAgent.address, usdc(1))
      ).to.be.revertedWithCustomError(firewall, "AgentNotRegistered");

      await expect(
        firewall.connect(owner).deposit(agent.address, 0)
      ).to.be.revertedWithCustomError(firewall, "ZeroAmount");
    });

    it("blocks deposits to a revoked agent", async function () {
      const { firewall, owner, agent } = await loadFixture(fundedFixture);
      await firewall.connect(owner).revokeAgent(agent.address);
      await expect(
        firewall.connect(owner).deposit(agent.address, usdc(1))
      ).to.be.revertedWithCustomError(firewall, "AgentIsRevoked");
    });

    it("returns funds to the owner and updates accounting", async function () {
      const { firewall, token, owner, agent } = await loadFixture(
        fundedFixture
      );

      await expect(
        firewall.connect(owner).withdraw(agent.address, usdc(2000))
      ).to.changeTokenBalances(
        token,
        [firewall, owner],
        [-usdc(2000), usdc(2000)]
      );

      expect(await firewall.balanceOfAgent(agent.address)).to.equal(usdc(3000));
      expect(await firewall.totalDeposited()).to.equal(usdc(3000));
    });

    it("still allows withdrawal after revocation", async function () {
      const { firewall, owner, agent } = await loadFixture(fundedFixture);
      await firewall.connect(owner).revokeAgent(agent.address);

      await expect(firewall.connect(owner).withdraw(agent.address, usdc(5000)))
        .to.emit(firewall, "Withdrawn")
        .withArgs(agent.address, owner.address, usdc(5000), 0);

      expect(await firewall.balanceOfAgent(agent.address)).to.equal(0);
    });

    it("cannot withdraw more than the agent holds", async function () {
      const { firewall, owner, agent } = await loadFixture(fundedFixture);
      await expect(
        firewall.connect(owner).withdraw(agent.address, usdc(5001))
      )
        .to.be.revertedWithCustomError(firewall, "InsufficientAgentBalance")
        .withArgs(usdc(5001), usdc(5000));
    });

    it("one agent cannot draw on another agent's funds", async function () {
      const { firewall, owner, agent, otherAgent, merchant } =
        await loadFixture(fundedFixture);

      await firewall
        .connect(owner)
        .registerAgent(otherAgent.address, BUDGET, PERIOD, MAX_PER_TX);
      await firewall
        .connect(owner)
        .setMerchantAllowed(otherAgent.address, merchant.address, true);

      // otherAgent has an identical policy but zero balance.
      await expect(
        firewall.connect(otherAgent).spend(merchant.address, usdc(10))
      )
        .to.be.revertedWithCustomError(firewall, "InsufficientAgentBalance")
        .withArgs(usdc(10), 0);
    });
  });

  // -------------------------------------------------------------------
  describe("spend: allowed path", function () {
    it("transfers usdc to the merchant and records the spend", async function () {
      const { firewall, token, agent, merchant } = await loadFixture(
        fundedFixture
      );

      await expect(
        firewall.connect(agent).spend(merchant.address, usdc(200))
      ).to.changeTokenBalances(
        token,
        [firewall, merchant],
        [-usdc(200), usdc(200)]
      );

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodSpent).to.equal(usdc(200));
      expect(p.remainingInPeriod).to.equal(usdc(800));
      expect(p.balance).to.equal(usdc(4800));
      expect(await firewall.totalDeposited()).to.equal(usdc(4800));
    });

    it("emits SpendAuthorized with the running period totals", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);

      await expect(firewall.connect(agent).spend(merchant.address, usdc(250)))
        .to.emit(firewall, "SpendAuthorized")
        .withArgs(
          agent.address,
          merchant.address,
          usdc(250),
          usdc(250),
          usdc(750)
        );
    });

    it("accumulates across several spends up to the budget", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);

      for (let i = 0; i < 4; i++) {
        await firewall.connect(agent).spend(merchant.address, usdc(250));
      }

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodSpent).to.equal(BUDGET);
      expect(p.remainingInPeriod).to.equal(0);
    });

    it("allows a spend exactly at maxPerTx", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      await expect(firewall.connect(agent).spend(merchant.address, MAX_PER_TX))
        .to.not.be.reverted;
    });
  });

  // -------------------------------------------------------------------
  describe("spend: block paths", function () {
    it("blocks an unregistered agent", async function () {
      const { firewall, otherAgent, merchant } = await loadFixture(
        fundedFixture
      );
      await expect(
        firewall.connect(otherAgent).spend(merchant.address, usdc(10))
      )
        .to.be.revertedWithCustomError(firewall, "AgentNotRegistered")
        .withArgs(otherAgent.address);
    });

    it("blocks a revoked agent immediately", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      // Spending works before revocation.
      await firewall.connect(agent).spend(merchant.address, usdc(10));

      await expect(firewall.connect(owner).revokeAgent(agent.address))
        .to.emit(firewall, "AgentRevoked")
        .withArgs(agent.address);

      await expect(firewall.connect(agent).spend(merchant.address, usdc(10)))
        .to.be.revertedWithCustomError(firewall, "AgentIsRevoked")
        .withArgs(agent.address);
    });

    it("blocks a merchant that is not on the allowlist", async function () {
      const { firewall, agent, badMerchant } = await loadFixture(fundedFixture);
      await expect(
        firewall.connect(agent).spend(badMerchant.address, usdc(10))
      )
        .to.be.revertedWithCustomError(firewall, "MerchantNotAllowed")
        .withArgs(agent.address, badMerchant.address);
    });

    it("blocks a merchant removed from the allowlist after the fact", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      await firewall.connect(agent).spend(merchant.address, usdc(10));
      await firewall
        .connect(owner)
        .setMerchantAllowed(agent.address, merchant.address, false);

      await expect(firewall.connect(agent).spend(merchant.address, usdc(10)))
        .to.be.revertedWithCustomError(firewall, "MerchantNotAllowed")
        .withArgs(agent.address, merchant.address);
    });

    it("blocks a spend over maxPerTx", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      await expect(
        firewall.connect(agent).spend(merchant.address, MAX_PER_TX + 1n)
      )
        .to.be.revertedWithCustomError(firewall, "ExceedsMaxPerTx")
        .withArgs(MAX_PER_TX + 1n, MAX_PER_TX);
    });

    it("blocks a spend that would exceed the period budget", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);

      // 900 of the 1000 budget used, each tx inside maxPerTx.
      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await firewall.connect(agent).spend(merchant.address, usdc(150));

      // 100 left. This tx is under maxPerTx but over the remaining budget.
      await expect(firewall.connect(agent).spend(merchant.address, usdc(101)))
        .to.be.revertedWithCustomError(firewall, "ExceedsPeriodBudget")
        .withArgs(usdc(101), usdc(100));

      // Exactly the remaining budget is fine.
      await expect(firewall.connect(agent).spend(merchant.address, usdc(100)))
        .to.not.be.reverted;
    });

    it("blocks a spend larger than the agent balance", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        deployFixture
      );

      await firewall
        .connect(owner)
        .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX);
      await firewall
        .connect(owner)
        .setMerchantAllowed(agent.address, merchant.address, true);
      await firewall.connect(owner).deposit(agent.address, usdc(100));

      // Inside maxPerTx and inside budget, but the agent only holds 100.
      await expect(firewall.connect(agent).spend(merchant.address, usdc(200)))
        .to.be.revertedWithCustomError(firewall, "InsufficientAgentBalance")
        .withArgs(usdc(200), usdc(100));
    });

    it("blocks a zero amount spend", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      await expect(
        firewall.connect(agent).spend(merchant.address, 0)
      ).to.be.revertedWithCustomError(firewall, "ZeroAmount");
    });

    it("leaves all state untouched when a spend is blocked", async function () {
      const { firewall, token, agent, badMerchant } = await loadFixture(
        fundedFixture
      );

      const before = await firewall.getPolicy(agent.address);
      await expect(firewall.connect(agent).spend(badMerchant.address, usdc(10)))
        .to.be.reverted;
      const after = await firewall.getPolicy(agent.address);

      expect(after.periodSpent).to.equal(before.periodSpent);
      expect(after.balance).to.equal(before.balance);
      expect(await token.balanceOf(badMerchant.address)).to.equal(0);
    });

    it("applies checks in the documented order", async function () {
      const { firewall, owner, agent, badMerchant } = await loadFixture(
        fundedFixture
      );

      // Revoked outranks a bad merchant.
      await firewall.connect(owner).revokeAgent(agent.address);
      await expect(
        firewall.connect(agent).spend(badMerchant.address, usdc(999999))
      ).to.be.revertedWithCustomError(firewall, "AgentIsRevoked");
    });
  });

  // -------------------------------------------------------------------
  describe("period rolling", function () {
    it("resets the budget once the period elapses", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);

      // Burn the whole period budget.
      for (let i = 0; i < 4; i++) {
        await firewall.connect(agent).spend(merchant.address, usdc(250));
      }
      await expect(
        firewall.connect(agent).spend(merchant.address, usdc(1))
      ).to.be.revertedWithCustomError(firewall, "ExceedsPeriodBudget");

      await time.increase(PERIOD);

      const rolled = await firewall.getPolicy(agent.address);
      expect(rolled.periodSpent).to.equal(0);
      expect(rolled.remainingInPeriod).to.equal(BUDGET);

      await expect(firewall.connect(agent).spend(merchant.address, usdc(250)))
        .to.not.be.reverted;

      const after = await firewall.getPolicy(agent.address);
      expect(after.periodSpent).to.equal(usdc(250));
    });

    it("does not reset one second early", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);

      for (let i = 0; i < 4; i++) {
        await firewall.connect(agent).spend(merchant.address, usdc(250));
      }

      const p = await firewall.getPolicy(agent.address);
      // Land exactly one second before the window closes.
      await time.increaseTo(p.periodStart + BigInt(PERIOD) - 2n);

      await expect(
        firewall.connect(agent).spend(merchant.address, usdc(1))
      ).to.be.revertedWithCustomError(firewall, "ExceedsPeriodBudget");
    });

    it("keeps windows anchored across several elapsed periods", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);

      const start = (await firewall.getPolicy(agent.address)).periodStart;
      await firewall.connect(agent).spend(merchant.address, usdc(250));

      // Skip three and a half periods without touching the contract.
      await time.increase(PERIOD * 3 + PERIOD / 2);

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodSpent).to.equal(0);
      // The window advanced by whole periods, not to an arbitrary now.
      expect(p.periodStart).to.equal(start + BigInt(PERIOD * 3));
    });

    it("persists the rolled window after a spend", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);

      const start = (await firewall.getPolicy(agent.address)).periodStart;
      await firewall.connect(agent).spend(merchant.address, usdc(250));

      await time.increase(PERIOD * 2);
      await firewall.connect(agent).spend(merchant.address, usdc(100));

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodStart).to.equal(start + BigInt(PERIOD * 2));
      expect(p.periodSpent).to.equal(usdc(100));
    });
  });

  // -------------------------------------------------------------------
  describe("checkSpend dry run", function () {
    async function expectReason(firewall, agent, merchant, amount, code) {
      const [allowed, reason] = await firewall.checkSpend(
        agent,
        merchant,
        amount
      );
      expect(reason).to.equal(code);
      expect(allowed).to.equal(code === REASON.OK);
    }

    it("reports OK for a spend that would succeed", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        usdc(100),
        REASON.OK
      );
    });

    it("reports NOT_REGISTERED", async function () {
      const { firewall, otherAgent, merchant } = await loadFixture(
        fundedFixture
      );
      await expectReason(
        firewall,
        otherAgent.address,
        merchant.address,
        usdc(1),
        REASON.NOT_REGISTERED
      );
    });

    it("reports REVOKED", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );
      await firewall.connect(owner).revokeAgent(agent.address);
      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        usdc(1),
        REASON.REVOKED
      );
    });

    it("reports MERCHANT_NOT_ALLOWED", async function () {
      const { firewall, agent, badMerchant } = await loadFixture(fundedFixture);
      await expectReason(
        firewall,
        agent.address,
        badMerchant.address,
        usdc(1),
        REASON.MERCHANT_NOT_ALLOWED
      );
    });

    it("reports OVER_MAX_PER_TX", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        MAX_PER_TX + 1n,
        REASON.OVER_MAX_PER_TX
      );
    });

    it("reports OVER_PERIOD_BUDGET", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      for (let i = 0; i < 4; i++) {
        await firewall.connect(agent).spend(merchant.address, usdc(250));
      }
      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        usdc(1),
        REASON.OVER_PERIOD_BUDGET
      );
    });

    it("reports INSUFFICIENT_BALANCE", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        deployFixture
      );
      await firewall
        .connect(owner)
        .registerAgent(agent.address, BUDGET, PERIOD, MAX_PER_TX);
      await firewall
        .connect(owner)
        .setMerchantAllowed(agent.address, merchant.address, true);
      await firewall.connect(owner).deposit(agent.address, usdc(50));

      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        usdc(200),
        REASON.INSUFFICIENT_BALANCE
      );
    });

    it("reports ZERO_AMOUNT", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        0,
        REASON.ZERO_AMOUNT
      );
    });

    it("sees the period roll without a transaction", async function () {
      const { firewall, agent, merchant } = await loadFixture(fundedFixture);
      for (let i = 0; i < 4; i++) {
        await firewall.connect(agent).spend(merchant.address, usdc(250));
      }
      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        usdc(250),
        REASON.OVER_PERIOD_BUDGET
      );

      await time.increase(PERIOD);

      await expectReason(
        firewall,
        agent.address,
        merchant.address,
        usdc(250),
        REASON.OK
      );
    });

    it("agrees with spend on every path", async function () {
      const { firewall, agent, merchant, badMerchant } = await loadFixture(
        fundedFixture
      );

      const cases = [
        [merchant.address, usdc(100)],
        [badMerchant.address, usdc(100)],
        [merchant.address, MAX_PER_TX + 1n],
        [merchant.address, 0],
      ];

      for (const [to, amount] of cases) {
        const [allowed] = await firewall.checkSpend(
          agent.address,
          to,
          amount
        );
        const tx = firewall.connect(agent).spend.staticCall(to, amount);
        if (allowed) {
          await expect(tx).to.not.be.reverted;
        } else {
          await expect(tx).to.be.reverted;
        }
      }
    });
  });

  // -------------------------------------------------------------------
  describe("updatePolicy", function () {
    it("applies new limits and emits PolicyUpdated", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      await expect(
        firewall
          .connect(owner)
          .updatePolicy(agent.address, usdc(2000), PERIOD, usdc(500))
      )
        .to.emit(firewall, "PolicyUpdated")
        .withArgs(agent.address, usdc(2000), PERIOD, usdc(500));

      // The old 250 cap no longer applies.
      await expect(firewall.connect(agent).spend(merchant.address, usdc(400)))
        .to.not.be.reverted;
    });

    it("preserves spend already used in the current period", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await firewall
        .connect(owner)
        .updatePolicy(agent.address, usdc(2000), PERIOD, usdc(500));

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodSpent).to.equal(usdc(250));
      expect(p.remainingInPeriod).to.equal(usdc(1750));
    });

    it("can tighten a policy below current usage, leaving zero remaining", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await firewall.connect(agent).spend(merchant.address, usdc(250));

      // New budget of 400 is below the 500 already spent.
      await firewall
        .connect(owner)
        .updatePolicy(agent.address, usdc(400), PERIOD, usdc(100));

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodSpent).to.equal(usdc(500));
      expect(p.remainingInPeriod).to.equal(0);

      await expect(
        firewall.connect(agent).spend(merchant.address, usdc(1))
      ).to.be.revertedWithCustomError(firewall, "ExceedsPeriodBudget");
    });

    it("re-anchors the window when the period length changes", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await firewall
        .connect(owner)
        .updatePolicy(agent.address, BUDGET, PERIOD * 2, MAX_PER_TX);

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodSeconds).to.equal(PERIOD * 2);
      expect(p.periodStart).to.equal(await time.latest());
      expect(p.periodSpent).to.equal(usdc(250));
    });

    it("settles a pending roll instead of losing it", async function () {
      const { firewall, owner, agent, merchant } = await loadFixture(
        fundedFixture
      );

      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await time.increase(PERIOD);

      // The window has rolled but no spend has landed to persist it.
      await firewall
        .connect(owner)
        .updatePolicy(agent.address, BUDGET, PERIOD, MAX_PER_TX);

      const p = await firewall.getPolicy(agent.address);
      expect(p.periodSpent).to.equal(0);
      expect(p.remainingInPeriod).to.equal(BUDGET);
    });

    it("rejects non owners, unknown agents, revoked agents, and bad policies", async function () {
      const { firewall, owner, stranger, agent, otherAgent } =
        await loadFixture(fundedFixture);

      await expect(
        firewall
          .connect(stranger)
          .updatePolicy(agent.address, BUDGET, PERIOD, MAX_PER_TX)
      ).to.be.revertedWithCustomError(firewall, "OwnableUnauthorizedAccount");

      await expect(
        firewall
          .connect(owner)
          .updatePolicy(otherAgent.address, BUDGET, PERIOD, MAX_PER_TX)
      ).to.be.revertedWithCustomError(firewall, "AgentNotRegistered");

      await expect(
        firewall.connect(owner).updatePolicy(agent.address, 0, PERIOD, 0)
      ).to.be.revertedWithCustomError(firewall, "InvalidPolicy");

      await firewall.connect(owner).revokeAgent(agent.address);
      await expect(
        firewall
          .connect(owner)
          .updatePolicy(agent.address, BUDGET, PERIOD, MAX_PER_TX)
      ).to.be.revertedWithCustomError(firewall, "AgentIsRevoked");
    });
  });

  // -------------------------------------------------------------------
  describe("revokeAgent", function () {
    it("only the owner can revoke, and only once", async function () {
      const { firewall, owner, stranger, agent } = await loadFixture(
        fundedFixture
      );

      await expect(
        firewall.connect(stranger).revokeAgent(agent.address)
      ).to.be.revertedWithCustomError(firewall, "OwnableUnauthorizedAccount");

      await firewall.connect(owner).revokeAgent(agent.address);
      await expect(
        firewall.connect(owner).revokeAgent(agent.address)
      ).to.be.revertedWithCustomError(firewall, "AgentIsRevoked");
    });

    it("reports zero remaining budget once revoked", async function () {
      const { firewall, owner, agent } = await loadFixture(fundedFixture);
      await firewall.connect(owner).revokeAgent(agent.address);

      const p = await firewall.getPolicy(agent.address);
      expect(p.revoked).to.equal(true);
      expect(p.remainingInPeriod).to.equal(0);
      // Funds are still tracked and recoverable.
      expect(p.balance).to.equal(usdc(5000));
    });

    it("does not affect other agents", async function () {
      const { firewall, owner, agent, otherAgent, merchant } =
        await loadFixture(fundedFixture);

      await firewall
        .connect(owner)
        .registerAgent(otherAgent.address, BUDGET, PERIOD, MAX_PER_TX);
      await firewall
        .connect(owner)
        .setMerchantAllowed(otherAgent.address, merchant.address, true);
      await firewall.connect(owner).deposit(otherAgent.address, usdc(500));

      await firewall.connect(owner).revokeAgent(agent.address);

      await expect(
        firewall.connect(otherAgent).spend(merchant.address, usdc(100))
      ).to.not.be.reverted;
    });
  });

  // -------------------------------------------------------------------
  describe("accounting invariant", function () {
    it("totalDeposited always matches the contract token balance", async function () {
      const { firewall, token, owner, agent, otherAgent, merchant } =
        await loadFixture(fundedFixture);

      await firewall
        .connect(owner)
        .registerAgent(otherAgent.address, BUDGET, PERIOD, MAX_PER_TX);
      await firewall
        .connect(owner)
        .setMerchantAllowed(otherAgent.address, merchant.address, true);
      await firewall.connect(owner).deposit(otherAgent.address, usdc(750));

      await firewall.connect(agent).spend(merchant.address, usdc(250));
      await firewall.connect(otherAgent).spend(merchant.address, usdc(100));
      await firewall.connect(owner).withdraw(agent.address, usdc(1000));

      const held = await token.balanceOf(await firewall.getAddress());
      expect(await firewall.totalDeposited()).to.equal(held);
      expect(
        (await firewall.balanceOfAgent(agent.address)) +
          (await firewall.balanceOfAgent(otherAgent.address))
      ).to.equal(held);
    });
  });
});
