"use strict";

// The nanopayments demo.
//
//   TOP UP 1   through the firewall, inside policy          ALLOWED
//   NANOPAY    several x402 calls out of the funded pool    all settle
//   TOP UP 2   through the firewall, still inside policy    ALLOWED
//   TOP UP 3   would exceed the period budget               BLOCKED
//   NANOPAY    the pool still works, the tap is just shut   all settle
//
// The last step is the one worth watching. When the firewall blocks the third
// top up, the nanopayments already paid for do not stop, because they were
// never gated in the first place. What the agent has lost is the ability to
// get any more. That is exactly the guarantee this design can make, and it is
// worth stating precisely rather than overclaiming.

require("dotenv").config();

const { fmt } = require("./config");
const { NivGuardNanoAgent } = require("./nanoAgent");
const log = require("./log");
const { DEMO } = require("./demoConfig");

const seller = require("../scripts/nanoSeller");

const TOP_UP = DEMO.nano.topUp;
const BASE = `http://localhost:${seller.PORT}`;

// The shopping list. Repeated deliberately: the ratio is the story, so the
// agent should be seen making many small calls against one gated top up.
const BASKET = [
  { path: "/api/embedding", method: "GET" },
  { path: "/api/rerank", method: "GET" },
  { path: "/api/inference", method: "POST", body: { text: "is this working" } },
  { path: "/api/embedding", method: "GET" },
  { path: "/api/scrape", method: "GET" },
  { path: "/api/rerank", method: "GET" },
];

async function main() {
  log.banner("NivGuard: funding an agent's nanopayments through the firewall");

  const agent = await NivGuardNanoAgent.create();
  const d = agent.deployment;
  const policy = await agent.policy();

  log.field("network", `arcTestnet  ${log.c.grey("(chainId 5042002)")}`);
  log.field("firewall", d.spendFirewall);
  log.field("gateway", `${d.gatewayWallet}  ${log.c.grey("(Circle GatewayWallet)")}`);
  log.field("agent", agent.address);
  log.blank();
  log.field("policy", `${fmt(policy.budgetPerPeriod)} USDC per ${d.policy.periodSeconds}s period`);
  log.field("", `${fmt(policy.maxPerTx)} USDC maximum per top up`);
  log.field("funded", `${fmt(policy.balance)} USDC behind the firewall`);
  log.blank();
  log.note("The agent's Gateway balance can only be filled by the firewall,");
  log.note("under the same policy that governs its merchant payments.");

  // Start the seller in this process so the demo is one command.
  await seller.start();

  const results = { topUps: [], payments: [] };

  // ------------------------------------------------------------------
  const before = await agent.balances();
  log.header("GATEWAY BALANCE", "before any top up");
  log.field("available", `${before.available} USDC  ${log.c.grey("in Circle Gateway")}`);
  if (before.availableRaw === 0n) {
    log.note("Nothing to pay with yet. Every 402 below would fail right now.");
  } else {
    // Gateway balances belong to the agent address, not to the firewall, so a
    // re-run against the same key inherits whatever the last run left behind.
    log.note("Left over from an earlier run against this same agent key.");
    log.note("A fresh key starts at zero: node scripts/newNanoAgent.js");
  }

  // ------------------------------------------------------------------
  results.topUps.push(await topUp(agent, "TOP UP 1", "the agent asks for its first nanopayment float"));

  await spendFromPool(agent, results, "NANOPAYMENTS", "paying for six resources out of the funded pool");

  // ------------------------------------------------------------------
  results.topUps.push(await topUp(agent, "TOP UP 2", "the pool is running low, so the agent asks again"));

  // ------------------------------------------------------------------
  log.header("TOP UP 3", "the agent asks once more, and the budget is gone");
  const blocked = await topUp(agent, "TOP UP 3", null, { quiet: true });
  results.topUps.push(blocked);

  // ------------------------------------------------------------------
  await spendFromPool(
    agent,
    results,
    "NANOPAYMENTS",
    "the tap is shut, but the pool already funded still spends"
  );

  await summarise(agent, results);
}

/// Ask the firewall for a top up and report what it decided.
async function topUp(agent, label, description, { quiet = false } = {}) {
  if (!quiet) log.header(label, description);

  const balancesBefore = await agent.balances();
  const policyBefore = await agent.policy();

  log.field("amount", `${fmt(TOP_UP)} USDC`);
  log.field(
    "budget",
    `${fmt(policyBefore.periodSpent)} / ${fmt(policyBefore.budgetPerPeriod)} USDC used, ` +
      `${fmt(policyBefore.remaining)} left this period`
  );

  const result = await agent.topUp(TOP_UP);
  result.label = label;

  log.field(
    "dry run",
    result.allowed
      ? log.allowed(`checkFundGateway says yes  ${log.c.grey(`(code ${result.reasonCode})`)}`)
      : log.blocked(
          `${result.reasonKey}  ${log.c.grey(`(code ${result.reasonCode}, ${result.reasonText})`)}`
        )
  );
  log.field("submit", "fundGateway() onchain, signed by the agent");

  if (result.succeeded) {
    log.field("result", log.passed(`tx ${result.hash}`));
    const after = await agent.waitForCredit(balancesBefore.availableRaw);
    log.field(
      "gateway",
      `${balancesBefore.available} -> ${log.c.green(`${after.available} USDC`)} available`
    );
    result.gatewayAfter = after.available;
  } else {
    log.field("result", log.blocked("rejected by the firewall"));
    log.field("reason", result.reason);
    log.field(
      "gateway",
      `${balancesBefore.available} USDC available  ${log.c.grey("(unchanged, no funds moved)")}`
    );
    result.gatewayAfter = balancesBefore.available;
  }

  const policyAfter = await agent.policy();
  log.field(
    "budget",
    `${fmt(policyAfter.periodSpent)} / ${fmt(policyAfter.budgetPerPeriod)} USDC used, ` +
      `${fmt(policyAfter.remaining)} left this period`
  );

  return result;
}

/// Spend out of the Gateway pool. No gas, no transactions, no policy checks.
async function spendFromPool(agent, results, label, description) {
  log.header(label, description);

  const before = await agent.balances();
  log.field("available", `${before.available} USDC in the pool`);
  log.blank();

  for (const item of BASKET) {
    const url = `${BASE}${item.path}`;
    try {
      const paid = await agent.buy(url, { method: item.method, body: item.body });
      results.payments.push(paid);
      log.field(
        "paid",
        `${item.path.padEnd(16)} ${log.c.green(`${paid.formattedAmount} USDC`)} ` +
          `${log.c.grey(`${paid.ms}ms, no gas, no transaction`)}`
      );
    } catch (err) {
      log.field("failed", `${item.path.padEnd(16)} ${log.c.red(err.message)}`);
      results.payments.push({ failed: true, url, error: err.message });
    }
  }

  log.blank();
  const after = await agent.balances();
  log.field("available", `${before.available} -> ${after.available} USDC`);
}

async function summarise(agent, results) {
  log.banner("Summary");

  for (const t of results.topUps) {
    const verdict = t.succeeded ? log.c.green("ALLOWED") : log.c.red("BLOCKED");
    const why = t.succeeded ? "" : `  ${log.c.grey(t.reasonKey)}`;
    console.log(`  ${verdict}  ${t.label.padEnd(12)}${fmt(t.amount)} USDC${why}`);
  }

  const settled = results.payments.filter((p) => !p.failed);
  const failed = results.payments.length - settled.length;
  const total = settled.reduce((s, p) => s + BigInt(p.amount), 0n);

  log.blank();
  console.log(
    `  ${log.c.green(`${settled.length} nanopayments settled`)}` +
      (failed ? ` and ${log.c.red(`${failed} failed`)}` : "") +
      `, ${fmt(total)} USDC in total.`
  );

  const allowedTopUps = results.topUps.filter((t) => t.succeeded);
  const movedThroughFirewall = allowedTopUps.reduce((s, t) => s + BigInt(t.amount), 0n);

  log.blank();
  log.field("onchain", `${allowedTopUps.length} gated top ups, ${fmt(movedThroughFirewall)} USDC`);
  log.field("offchain", `${settled.length} ungated nanopayments, ${fmt(total)} USDC`);

  const policy = await agent.policy();
  log.field("budget", `${fmt(policy.remaining)} USDC left this period`);

  log.blank();
  log.note("What the firewall guarantees here, stated precisely:");
  log.note("");
  log.note("  Every USDC that reached the Gateway pool passed a policy check,");
  log.note("  charged against the same budget as merchant payments, and left");
  log.note("  an indexed GatewayFunded event onchain.");
  log.note("");
  log.note("  The individual nanopayments were NOT checked, and could not be.");
  log.note("  They are offchain signatures that Circle batches, so there is no");
  log.note("  onchain call to gate. The firewall bounds the pool, not the drops.");
  log.blank();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("");
    log.banner("Nanopayments demo failed");
    log.field("reason", err.shortMessage || err.message);
    if (process.env.NIVGUARD_DEBUG && err.stack) {
      console.error(err.stack.split("\n").slice(1, 8).join("\n"));
    }
    console.error("");
    process.exit(1);
  });
