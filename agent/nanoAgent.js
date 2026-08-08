"use strict";

// The nanopayment agent.
//
// It does two things, and the difference between them is the whole point of
// this branch:
//
//   topUp()   asks the firewall to move budget into its Gateway balance.
//             Onchain. Gated. One transaction. Can be blocked, and is.
//
//   buy()     pays an x402 resource out of that balance.
//             Offchain. Ungated. No transaction. Sub-cent. Cannot be blocked
//             by anything this project controls, because there is no onchain
//             call to put a check in front of.
//
// An agent that wants to spend more has to come back through topUp(), and
// that is the only door the firewall needs to hold.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const { ARC_TESTNET, loadArtifact, describeReason, fmt } = require("./config");
const { makeProvider } = require("./provider");
const { formatFailure, explain } = require("./revert");
const { NanoAgent } = require("./gateway");
const { resolveAgentKey } = require("./gateway");
const log = require("./log");

const RECORD_PATH = path.join(__dirname, "..", "deployments", "arcTestnet-nano.json");

function loadNanoDeployment() {
  if (!fs.existsSync(RECORD_PATH)) {
    throw new Error(
      "No deployments/arcTestnet-nano.json.\n" +
        "Run:  node scripts/newNanoAgent.js --write\n" +
        "then: node scripts/setupNano.js"
    );
  }
  return JSON.parse(fs.readFileSync(RECORD_PATH, "utf8"));
}

class NivGuardNanoAgent {
  constructor({ firewall, wallet, gateway, deployment, provider }) {
    this.firewall = firewall;
    this.wallet = wallet;
    this.gateway = gateway;
    this.deployment = deployment;
    this.provider = provider;
    this.address = wallet.address;
  }

  static async create() {
    const deployment = loadNanoDeployment();
    const { privateKey, address } = resolveAgentKey();

    const provider = makeProvider(ARC_TESTNET);
    const wallet = new ethers.Wallet(privateKey, provider);

    if (address.toLowerCase() !== deployment.agent.toLowerCase()) {
      throw new Error(
        `AGENT_GATEWAY_PRIVATE_KEY is for ${address}, but the deployment ` +
          `registered ${deployment.agent}. Re-run scripts/setupNano.js.`
      );
    }

    const artifact = loadArtifact("SpendFirewall");
    const firewall = new ethers.Contract(
      deployment.spendFirewall,
      artifact.abi,
      provider
    );

    const gateway = NanoAgent.create();

    return new NivGuardNanoAgent({ firewall, wallet, gateway, deployment, provider });
  }

  /// Live policy state, the same view the dashboard reads.
  async policy() {
    const p = await this.firewall.getPolicy(this.address);
    return {
      revoked: p.revoked,
      budgetPerPeriod: p.budgetPerPeriod,
      maxPerTx: p.maxPerTx,
      periodSpent: p.periodSpent,
      remaining: p.remainingInPeriod,
      balance: p.balance,
    };
  }

  /// Ask the firewall for a Gateway top up.
  ///
  /// Dry runs first with checkFundGateway, then submits for real regardless of
  /// what the dry run said, because the contract is the authority and we want
  /// the revert path genuinely exercised rather than predicted around.
  ///
  /// Returns { allowed, reasonKey, succeeded, hash, reason }.
  async topUp(amount) {
    const [ok, code] = await this.firewall.checkFundGateway(this.address, amount);
    const reason = describeReason(code);

    const result = {
      amount,
      allowed: ok,
      reasonCode: Number(code),
      reasonKey: reason.key,
      reasonText: reason.text,
      succeeded: false,
      hash: null,
      reason: null,
    };

    try {
      const tx = await this.firewall
        .connect(this.wallet)
        .fundGateway(this.address, amount);
      const receipt = await tx.wait();
      result.succeeded = true;
      result.hash = tx.hash;
      result.blockNumber = receipt.blockNumber;
    } catch (err) {
      const failure = formatFailure({
        iface: this.firewall.interface,
        err,
        action: `fundGateway(${this.address}, ${fmt(amount)} USDC)`,
      });

      // Arc's RPC does not always return the revert data on a failed send, in
      // which case there is nothing to decode. Replaying the call as a static
      // call gets the custom error back, with its arguments, so the log can
      // say "exceeds the 0.1 USDC left in this period" rather than just
      // "rejected". Falling back to the dry run's reason text last, which is
      // always available because checkFundGateway is a plain view.
      let decoded = failure.decoded;
      if (!decoded) decoded = await this._staticDecode(amount);

      result.reason = explain(decoded) || reason.text;
    }

    return result;
  }

  /// Replay fundGateway as a static call purely to recover the revert reason.
  /// Returns null if it unexpectedly does not revert.
  async _staticDecode(amount) {
    try {
      await this.firewall.fundGateway.staticCall(this.address, amount, {
        from: this.address,
      });
      return null;
    } catch (err) {
      const failure = formatFailure({ iface: this.firewall.interface, err });
      return failure.decoded;
    }
  }

  /// Wait for Circle to reflect a deposit in the Gateway balance.
  ///
  /// The deposit is an onchain transaction, but the balance that backs
  /// nanopayments is served by Circle's Gateway API, which indexes that
  /// transaction. Those are not the same clock. Paying immediately after the
  /// receipt can fail with an insufficient balance that resolves itself a
  /// second later, so the agent waits for the balance it was promised rather
  /// than assuming it.
  async waitForCredit(previousAvailable, { timeoutMs = 90_000, intervalMs = 2_000 } = {}) {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const balances = await this.gateway.balances();
      if (balances.availableRaw > previousAvailable) {
        return balances;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Circle Gateway still reports ${balances.available} USDC available ` +
            `${Math.round(timeoutMs / 1000)}s after the deposit confirmed onchain. ` +
            `The deposit transaction succeeded, so this is an indexing delay ` +
            `on Circle's side rather than a firewall problem.`
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /// Buy one x402 resource out of the Gateway balance. No gas, no transaction.
  async buy(url, opts) {
    return this.gateway.pay(url, opts);
  }

  async balances() {
    return this.gateway.balances();
  }
}

module.exports = { NivGuardNanoAgent, loadNanoDeployment, RECORD_PATH };
