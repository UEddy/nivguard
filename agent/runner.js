"use strict";

// The NivGuard agent runner.
//
// This is the loop an autonomous agent actually runs: for each job it wants to
// pay for, it dry-runs the policy with checkSpend, logs the decision and the
// reason code, then submits the real spend() through whichever wallet backend
// is configured. When the firewall blocks a payment the runner decodes the
// custom error, logs why, and moves on to the next job. It never crashes on a
// blocked payment, because being blocked is normal operation, not an outage.

const { ethers } = require("ethers");

const {
  getNetwork,
  loadArtifact,
  loadDeployment,
  describeReason,
  fmt,
} = require("./config");
const { makeSigner } = require("./signers");
const { makeProvider } = require("./provider");
const { describeFailure } = require("./revert");
const log = require("./log");

/// Build everything the runner needs: provider, contract handle, signer.
async function createContext({ networkName, localAgentAddress } = {}) {
  const network = getNetwork(networkName);
  const provider = makeProvider(network);

  const deployment = loadDeployment(network.name);
  const artifact = loadArtifact("SpendFirewall");

  const firewall = new ethers.Contract(
    deployment.spendFirewall,
    artifact.abi,
    provider
  );

  const signer = await makeSigner({
    network,
    provider,
    localAddress: localAgentAddress || deployment.agent,
  });

  return { network, provider, deployment, firewall, signer };
}

/// Read the agent's live policy state, for the running budget line.
async function readPolicy(firewall, agentAddress) {
  const p = await firewall.getPolicy(agentAddress);
  return {
    registered: p.registered,
    revoked: p.revoked,
    budgetPerPeriod: p.budgetPerPeriod,
    periodSeconds: p.periodSeconds,
    maxPerTx: p.maxPerTx,
    periodSpent: p.periodSpent,
    remaining: p.remainingInPeriod,
    balance: p.balance,
  };
}

/// Run one payment job end to end.
/// Returns { attempted, allowed, submitted, succeeded, reasonCode, reason }.
async function runJob(ctx, job) {
  const { firewall, signer } = ctx;
  const agent = signer.address;
  const amount = job.amount;

  log.header(job.label, job.description);
  log.field("merchant", `${job.merchant}${job.merchantNote ? `  ${log.c.grey(`(${job.merchantNote})`)}` : ""}`);
  log.field("amount", `${fmt(amount)} USDC`);

  // 1. Dry run the policy before spending anything. This is the call the
  //    dashboard uses too, so the agent sees exactly what a human would.
  const [ok, code] = await firewall.checkSpend(agent, job.merchant, amount);
  const reason = describeReason(code);

  log.field(
    "dry run",
    ok
      ? log.allowed(`checkSpend says yes  ${log.c.grey(`(code ${code})`)}`)
      : log.blocked(`${reason.key}  ${log.c.grey(`(code ${code}, ${reason.text})`)}`)
  );

  // 2. Submit for real regardless of the dry run. The contract is the
  //    authority, not the prediction, and we want the revert path exercised.
  log.field("submit", `spend() via ${signer.label}`);

  const result = {
    label: job.label,
    allowed: ok,
    reasonCode: Number(code),
    reasonKey: reason.key,
    submitted: true,
    succeeded: false,
    reason: null,
    hash: null,
  };

  try {
    const receipt = await signer.spend(firewall, job.merchant, amount);
    result.succeeded = true;
    result.hash = receipt.hash;
    log.field("result", log.passed(receipt.hash ? `tx ${receipt.hash}` : ""));
  } catch (err) {
    const failure = await describeFailure({
      firewall,
      agentAddress: agent,
      merchant: job.merchant,
      amount,
      err,
    });
    result.reason = failure.text;
    log.field("result", log.blocked("rejected by the firewall"));
    log.field("reason", failure.text);
  }

  // 3. Show the running budget so the period limit is visible as it fills.
  const policy = await readPolicy(firewall, agent);
  if (policy.revoked) {
    log.field("policy", log.c.red("agent is revoked, no further spending possible"));
  } else {
    log.field(
      "budget",
      `${fmt(policy.periodSpent)} / ${fmt(policy.budgetPerPeriod)} USDC used, ` +
        `${fmt(policy.remaining)} left this period`
    );
  }

  return result;
}

/// Run a list of jobs, continuing past blocked payments.
async function runJobs(ctx, jobs) {
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await runJob(ctx, job));
    } catch (err) {
      // A job should never take the whole run down.
      log.field("result", log.c.red(`runner error: ${err.message}`));
      results.push({
        label: job.label,
        allowed: false,
        succeeded: false,
        reason: `runner error: ${err.message}`,
      });
    }
  }
  return results;
}

module.exports = { createContext, runJob, runJobs, readPolicy };
