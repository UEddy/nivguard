"use strict";

// The NivGuard demo sequence. This is the hackathon video.
//
// Five payments, run in order, showing the firewall allowing exactly what the
// policy permits and blocking everything else with a specific reason:
//
//   1  allowlisted merchant, inside every cap        PASSES
//   2  merchant not on the allowlist                 BLOCKED
//   3  allowlisted merchant, over the per-tx cap     BLOCKED
//   4  repeat until the period budget is gone, +1    BLOCKED on budget
//   5  owner revokes, the agent tries again          BLOCKED on revoked
//
// The agent is not told which of these will fail. It dry-runs each one and
// then tries it for real, exactly as it would in production.

const { ethers } = require("ethers");

const { fmt, describeReason, loadArtifact } = require("./config");
const { createContext, runJob, readPolicy } = require("./runner");
const { formatFailure } = require("./revert");
const { getOwnerSigner } = require("./wallet");
const { DEMO, assertCoherent } = require("./demoConfig");
const log = require("./log");

assertCoherent();

const SMALL_PAYMENT = DEMO.payments.first;
const OVER_CAP_PAYMENT = DEMO.payments.overCap;
const TOP_UP = DEMO.payments.topUp;
const POST_REVOKE_PAYMENT = DEMO.payments.postRevoke;

/// Read --network <name> or --network=<name> from argv. A flag beats the env
/// var, and both beat the default. PowerShell has no inline "VAR=x cmd" form,
/// so the flag is the portable way to pick a network on Windows.
function networkFromArgs(argv) {
  const i = argv.findIndex((a) => a === "--network" || a.startsWith("--network="));
  if (i === -1) return null;
  const arg = argv[i];
  return arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[i + 1] || null;
}

async function main() {
  const networkName =
    networkFromArgs(process.argv.slice(2)) ||
    process.env.NIVGUARD_NETWORK ||
    "localhost";

  // On the local node, redeploy first so every run starts from a clean slate.
  // Without this the second run inherits the revoked agent from the first and
  // every payment is blocked before it starts. Set NIVGUARD_NO_SETUP=1 to
  // reuse the existing deployment instead.
  if (networkName === "localhost" && !process.env.NIVGUARD_NO_SETUP) {
    const { setupLocal } = require("./setupLocal");
    await setupLocal();
  }

  const ctx = await createContext({ networkName });
  const { firewall, deployment, signer, network } = ctx;

  const allowedMerchant = deployment.merchants?.allowed;
  const blockedMerchant = deployment.merchants?.blocked;

  if (!allowedMerchant || !blockedMerchant) {
    throw new Error(
      "The deployment record has no merchant addresses. Run agent/setupLocal.js."
    );
  }

  log.banner("NivGuard: onchain spend firewall for AI agents");

  const policy = await readPolicy(firewall, signer.address);

  log.field("network", `${network.name}  ${log.c.grey(`(chainId ${network.chainId})`)}`);
  log.field("firewall", deployment.spendFirewall);
  log.field("agent", signer.address);
  log.field("wallet", signer.label);
  log.blank();
  log.field("policy", `${fmt(policy.budgetPerPeriod)} USDC per ${policy.periodSeconds}s period`);
  log.field("", `${fmt(policy.maxPerTx)} USDC maximum per transaction`);
  log.field("", `1 merchant allowlisted, 1 deliberately not`);
  log.field("funded", `${fmt(policy.balance)} USDC`);
  log.blank();
  log.note("The agent decides on its own. No human approves any payment below.");

  const results = [];

  // ------------------------------------------------------------------
  results.push(
    await runJob(ctx, {
      label: "PAYMENT 1",
      description: "GPU compute from an approved vendor",
      merchant: allowedMerchant,
      merchantNote: "allowlisted",
      amount: SMALL_PAYMENT,
    })
  );

  // ------------------------------------------------------------------
  results.push(
    await runJob(ctx, {
      label: "PAYMENT 2",
      description: "an unknown vendor the agent found on its own",
      merchant: blockedMerchant,
      merchantNote: "NOT allowlisted",
      amount: SMALL_PAYMENT,
    })
  );

  // ------------------------------------------------------------------
  results.push(
    await runJob(ctx, {
      label: "PAYMENT 3",
      description: "approved vendor, but an oversized invoice",
      merchant: allowedMerchant,
      merchantNote: "allowlisted",
      amount: OVER_CAP_PAYMENT,
    })
  );

  // ------------------------------------------------------------------
  // Drain the period budget in legal steps, then take one step too many.
  log.banner("PAYMENT 4: spending until the period budget runs out");

  let step = 1;
  const MAX_STEPS = 20; // guard, the budget must run out well before this
  for (; step <= MAX_STEPS; step++) {
    const [ok] = await firewall.checkSpend(signer.address, allowedMerchant, TOP_UP);
    if (!ok) break;

    results.push(
      await runJob(ctx, {
        label: `PAYMENT 4.${step}`,
        description: "recurring top up, inside every cap",
        merchant: allowedMerchant,
        merchantNote: "allowlisted",
        amount: TOP_UP,
      })
    );
  }

  results.push(
    await runJob(ctx, {
      label: `PAYMENT 4.${step}`,
      description: "one more after the period budget is gone",
      merchant: allowedMerchant,
      merchantNote: "allowlisted",
      amount: TOP_UP,
    })
  );

  // ------------------------------------------------------------------
  log.banner("PAYMENT 5: the owner pulls the kill switch");

  // A real Wallet signer, not an unlocked node account. Arc has no unlocked
  // accounts, so this is what makes the kill switch work on any network.
  const owner = getOwnerSigner({
    provider: ctx.provider,
    networkName: network.name,
    expectedOwner: deployment.owner,
  });

  // The owner's calls were the one path with no revert decoding, so a failure
  // here printed a raw selector. Decode it like every payment already is.
  let revokeTx;
  try {
    revokeTx = await firewall.connect(owner).revokeAgent(signer.address);
    await revokeTx.wait();
  } catch (err) {
    throw asReadable(err, firewall.interface, `revokeAgent(${signer.address})`);
  }

  log.blank();
  log.field("owner", `${deployment.owner}  ${log.c.grey(`(${owner.sourceLabel})`)}`);
  log.field("action", log.c.yellow(`revokeAgent(${signer.address})`));
  log.field("tx", revokeTx.hash);
  log.note("Revocation is one transaction and takes effect immediately.");

  results.push(
    await runJob(ctx, {
      label: "PAYMENT 5",
      description: "the agent tries to pay after being revoked",
      merchant: allowedMerchant,
      merchantNote: "allowlisted",
      amount: POST_REVOKE_PAYMENT,
    })
  );

  // ------------------------------------------------------------------
  summarise(results);
}

function summarise(results) {
  log.banner("Summary");

  const passed = results.filter((r) => r.succeeded).length;
  const blocked = results.length - passed;

  for (const r of results) {
    const verdict = r.succeeded
      ? log.c.green("PASSED ")
      : log.c.red("BLOCKED");
    const why = r.succeeded ? "" : `  ${log.c.grey(r.reasonKey || "")}`;
    console.log(`  ${verdict}  ${r.label.padEnd(12)}${why}`);
  }

  log.blank();
  console.log(
    `  ${log.c.green(`${passed} allowed`)} and ` +
      `${log.c.red(`${blocked} blocked`)} out of ${results.length} attempts.`
  );
  log.blank();
  log.note("Every one of those decisions was made by the contract, not by the");
  log.note("agent, and every one is an indexed event onchain.");
  log.blank();
}

/// Attach a decoded, human readable report to a reverted call so the top level
/// handler can print it instead of a hex blob.
function asReadable(err, iface, action) {
  const { lines, hint } = formatFailure({ iface, err, action });
  err.nivguard = { lines, hint };
  return err;
}

main().catch((err) => {
  console.error("");
  log.banner("Demo failed");

  // A reverted contract call carries a decoded report. Anything else, such as
  // a missing env var, is already a plain sentence.
  let report = err.nivguard;
  if (!report) {
    try {
      const iface = new ethers.Interface(loadArtifact("SpendFirewall").abi);
      const f = formatFailure({ iface, err });
      if (f.decoded) report = { lines: f.lines, hint: f.hint };
    } catch {
      // No artifact, so there is nothing to decode against.
    }
  }

  if (report) {
    for (const [k, v] of report.lines) log.field(k, v);
    if (report.hint) {
      log.blank();
      for (const line of report.hint.split("\n")) log.note(line);
    }
  } else {
    log.field("reason", err.shortMessage || err.message);
  }

  log.blank();
  log.note("Run npm run preflight:arc to check every precondition.");
  console.error("");

  if (process.env.NIVGUARD_DEBUG && err.stack) {
    console.error(err.stack.split("\n").slice(1, 6).join("\n"));
  }
  process.exitCode = 1;
});
