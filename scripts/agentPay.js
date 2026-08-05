"use strict";

// Send ordinary, inside-policy payments through the configured agent.
//
// agent/demo.js is the scripted narrative: it deliberately walks into every
// limit and ends by revoking the agent. That is the right shape for a video
// and the wrong shape for a live dashboard, because a revoked agent has
// nothing left to show.
//
// This script is the boring counterpart. It pays the allowlisted merchant a
// few times, inside every cap, and revokes nothing. Use it to give a live
// agent a real activity feed.
//
//   node scripts/agentPay.js              2 payments of 1 USDC
//   node scripts/agentPay.js 3            3 payments of 1 USDC
//   node scripts/agentPay.js 1 0.25       1 payment of 0.25 USDC
//
// Amounts are the 6 decimal USDC ERC-20 view, the same view the policy uses.

const { createContext, runJob, readPolicy } = require("../agent/runner");
const { DEMO, assertCoherent } = require("../agent/demoConfig");
const { fmt, USDC_DECIMALS } = require("../agent/config");
const log = require("../agent/log");

const DEFAULT_COUNT = 2;

function parseUsdc(text) {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Not a valid USDC amount: ${text}`);
  }
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

async function main() {
  assertCoherent();

  const [countArg, amountArg] = process.argv.slice(2);

  const count = countArg ? Number(countArg) : DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Payment count must be a positive whole number, got ${countArg}`);
  }

  const amount = amountArg ? parseUsdc(amountArg) : DEMO.payments.first;

  const ctx = await createContext({ networkName: "arcTestnet" });
  const { firewall, deployment, signer, network } = ctx;

  const merchant = deployment.merchants?.allowed;
  if (!merchant) {
    throw new Error(
      "The deployment record has no allowlisted merchant. Run: npm run setup:arc"
    );
  }

  log.banner("NivGuard: routine agent payments");
  log.field("network", `${network.name}  ${log.c.grey(`(chainId ${network.chainId})`)}`);
  log.field("firewall", deployment.spendFirewall);
  log.field("agent", signer.address);
  log.field("wallet", signer.label);
  log.field("merchant", `${merchant}  ${log.c.grey("(allowlisted)")}`);

  const before = await readPolicy(firewall, signer.address);

  if (!before.registered) {
    throw new Error(
      `Agent ${signer.address} is not registered on this firewall.\n` +
        `Run: npm run setup:arc`
    );
  }
  if (before.revoked) {
    throw new Error(
      `Agent ${signer.address} is revoked and can never spend again.\n` +
        `Provision a fresh agent wallet, then run npm run setup:arc.`
    );
  }

  // Refuse to start a run the policy cannot finish, rather than discovering it
  // halfway through and leaving a half-populated activity feed behind.
  const total = amount * BigInt(count);
  if (amount > before.maxPerTx) {
    throw new Error(
      `${fmt(amount)} USDC is over the ${fmt(before.maxPerTx)} USDC per-transaction cap.`
    );
  }
  if (total > before.remaining) {
    throw new Error(
      `${count} x ${fmt(amount)} USDC is ${fmt(total)} USDC, but only ` +
        `${fmt(before.remaining)} USDC is left in this period.\n` +
        `Wait for the period to roll over, or ask for fewer payments.`
    );
  }
  if (total > before.balance) {
    throw new Error(
      `${fmt(total)} USDC exceeds the ${fmt(before.balance)} USDC the agent holds ` +
        `in the firewall.\nDeposit more first.`
    );
  }

  log.blank();
  log.field("policy", `${fmt(before.budgetPerPeriod)} USDC per ${before.periodSeconds}s period`);
  log.field("", `${fmt(before.maxPerTx)} USDC maximum per transaction`);
  log.field("funded", `${fmt(before.balance)} USDC`);
  log.blank();
  log.note(`Sending ${count} payment(s) of ${fmt(amount)} USDC. Nothing is revoked.`);

  const results = [];
  for (let i = 1; i <= count; i++) {
    results.push(
      await runJob(ctx, {
        label: `PAYMENT ${i}`,
        description: "routine spend, inside every cap",
        merchant,
        merchantNote: "allowlisted",
        amount,
      })
    );
  }

  const after = await readPolicy(firewall, signer.address);

  log.banner("Result");
  for (const r of results) {
    const verdict = r.succeeded ? log.c.green("PASSED ") : log.c.red("BLOCKED");
    console.log(`  ${verdict}  ${r.label.padEnd(12)}${r.hash || r.reasonKey || ""}`);
  }

  log.blank();
  log.field("agent", after.revoked ? log.c.red("REVOKED") : log.c.green("ACTIVE"));
  log.field("budget", `${fmt(after.periodSpent)} / ${fmt(after.budgetPerPeriod)} USDC used, ${fmt(after.remaining)} left`);
  log.field("balance", `${fmt(after.balance)} USDC in the firewall`);
  log.blank();

  if (results.some((r) => !r.succeeded)) {
    throw new Error("At least one payment was blocked. See the reasons above.");
  }
}

main().catch((err) => {
  console.error("");
  console.error(`Agent payments failed: ${err.message}`);
  process.exitCode = 1;
});
