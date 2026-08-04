"use strict";

// Preflight checklist. Run this before the demo so a missing prerequisite
// shows up as a named line item rather than as a confusing failure four
// payments into a recording.
//
//   node scripts/preflight.js --network arcTestnet
//   node scripts/preflight.js --network localhost
//
// Exits non-zero if anything required is missing, and says which.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const { getNetwork, loadArtifact, fmt } = require("../agent/config");
const { DEMO, assertCoherent } = require("../agent/demoConfig");
const { getOwnerSigner } = require("../agent/wallet");
const log = require("../agent/log");

const PASS = "PASS";
const FAIL = "FAIL";
const WARN = "WARN";

function networkFromArgs(argv) {
  const i = argv.findIndex((a) => a === "--network" || a.startsWith("--network="));
  if (i === -1) return null;
  const arg = argv[i];
  return arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[i + 1] || null;
}

/// Native gas balance is the 18 decimal view of USDC on Arc. Never mix this
/// with the 6 decimal ERC-20 amounts used for policy.
function fmtGas(wei) {
  return `${ethers.formatEther(wei)} USDC (gas)`;
}

class Checklist {
  constructor() {
    this.rows = [];
  }

  add(status, name, detail, fix) {
    this.rows.push({ status, name, detail, fix });
    return status === PASS;
  }

  pass(name, detail) {
    return this.add(PASS, name, detail);
  }

  fail(name, detail, fix) {
    return this.add(FAIL, name, detail, fix);
  }

  warn(name, detail, fix) {
    return this.add(WARN, name, detail, fix);
  }

  get failed() {
    return this.rows.filter((r) => r.status === FAIL);
  }

  render() {
    log.blank();
    for (const r of this.rows) {
      const tag =
        r.status === PASS
          ? log.c.green(" PASS ")
          : r.status === WARN
            ? log.c.yellow(" WARN ")
            : log.c.red(" FAIL ");
      console.log(`  ${tag}  ${r.name.padEnd(26)}${r.detail || ""}`);
    }

    const bad = this.failed;
    log.blank();

    if (bad.length === 0) {
      console.log(`  ${log.c.green("Ready.")} All checks passed.`);
      log.blank();
      return true;
    }

    console.log(`  ${log.c.red(`${bad.length} check(s) failed:`)}`);
    log.blank();
    for (const r of bad) {
      console.log(`  ${log.c.red("x")} ${r.name}`);
      if (r.detail) console.log(`      ${r.detail}`);
      if (r.fix) console.log(`      ${log.c.grey("fix:")} ${r.fix}`);
    }
    log.blank();
    return false;
  }
}

async function main() {
  assertCoherent();

  const networkName =
    networkFromArgs(process.argv.slice(2)) ||
    process.env.NIVGUARD_NETWORK ||
    "localhost";

  const network = getNetwork(networkName);
  const isArc = network.name === "arcTestnet";
  const cl = new Checklist();

  log.banner(`NivGuard preflight: ${network.name}`);

  // ---------------------------------------------------------------
  // 1. Keys
  // ---------------------------------------------------------------
  const pk = (process.env.PRIVATE_KEY || "").trim();
  if (pk) {
    let addr = null;
    try {
      addr = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`).address;
      cl.pass("PRIVATE_KEY", addr);
    } catch {
      cl.fail("PRIVATE_KEY", "set but not a valid key", "check the value in .env");
    }
  } else if (isArc) {
    cl.fail("PRIVATE_KEY", "not set", "add PRIVATE_KEY to .env");
  } else {
    cl.warn("PRIVATE_KEY", "not set, using hardhat test account");
  }

  if (isArc) {
    const apiKey = (process.env.CIRCLE_API_KEY || "").trim();
    const secret = (
      process.env.CIRCLE_ENTITY_SECRET ||
      process.env.ENTITY_SECRET ||
      ""
    ).trim();

    apiKey
      ? cl.pass("CIRCLE_API_KEY", "set")
      : cl.fail("CIRCLE_API_KEY", "not set", "get one from the Circle console");

    secret
      ? cl.pass("CIRCLE_ENTITY_SECRET", "set")
      : cl.fail(
          "CIRCLE_ENTITY_SECRET",
          "not set",
          "generate and register it with Circle, then add it to .env"
        );
  }

  const agentAddress = (process.env.AGENT_WALLET_ADDRESS || "").trim();
  const agentWalletId = (process.env.AGENT_WALLET_ID || "").trim();

  if (isArc) {
    agentAddress && agentWalletId
      ? cl.pass("agent wallet", agentAddress)
      : cl.fail(
          "agent wallet",
          "AGENT_WALLET_ID or AGENT_WALLET_ADDRESS missing",
          "npm run provision"
        );
  }

  // ---------------------------------------------------------------
  // 2. Deployment record
  // ---------------------------------------------------------------
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  let record = null;

  if (fs.existsSync(file)) {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
    cl.pass("deployment record", `deployments/${network.name}.json`);
  } else {
    cl.fail(
      "deployment record",
      `deployments/${network.name}.json missing`,
      isArc ? "npm run deploy:arc" : "node agent/setupLocal.js"
    );
    return finish(cl);
  }

  // ---------------------------------------------------------------
  // 3. Chain reachable, contract deployed
  // ---------------------------------------------------------------
  const provider = new ethers.JsonRpcProvider(network.rpcUrl, {
    chainId: network.chainId,
    name: network.name,
  });

  try {
    const live = await provider.getNetwork();
    if (Number(live.chainId) !== network.chainId) {
      cl.fail(
        "chain id",
        `RPC reports ${live.chainId}, config says ${network.chainId}`,
        "check the RPC url"
      );
    } else {
      cl.pass("rpc", `${network.rpcUrl}  chainId ${live.chainId}`);
    }
  } catch (err) {
    cl.fail("rpc", `${network.rpcUrl} unreachable`, err.message);
    return finish(cl);
  }

  const code = await provider.getCode(record.spendFirewall);
  if (code === "0x") {
    cl.fail(
      "contract deployed",
      `no code at ${record.spendFirewall}`,
      isArc ? "npm run deploy:arc" : "node agent/setupLocal.js"
    );
    return finish(cl);
  }
  cl.pass("contract deployed", record.spendFirewall);

  const firewall = new ethers.Contract(
    record.spendFirewall,
    loadArtifact("SpendFirewall").abi,
    provider
  );

  // ---------------------------------------------------------------
  // 4. Owner key actually owns the firewall
  // ---------------------------------------------------------------
  let ownerSigner = null;
  try {
    ownerSigner = getOwnerSigner({
      provider,
      networkName: network.name,
      expectedOwner: record.owner,
    });
    cl.pass("owner key", `${ownerSigner.address}  (${ownerSigner.sourceLabel})`);
  } catch (err) {
    cl.fail("owner key", err.message.split("\n")[0], "set PRIVATE_KEY to the owner key");
  }

  // ---------------------------------------------------------------
  // 5. Funding
  // ---------------------------------------------------------------
  const ownerAddr = ownerSigner?.address || record.owner;
  const ownerGas = await provider.getBalance(ownerAddr);

  ownerGas >= DEMO.minimums.ownerGas
    ? cl.pass("owner gas", fmtGas(ownerGas))
    : cl.fail(
        "owner gas",
        `${fmtGas(ownerGas)}, want at least ${fmtGas(DEMO.minimums.ownerGas)}`,
        isArc ? `fund ${ownerAddr} at https://faucet.circle.com` : "restart the hardhat node"
      );

  const demoAgent = record.agent || agentAddress;
  if (demoAgent) {
    const agentGas = await provider.getBalance(demoAgent);
    agentGas >= DEMO.minimums.agentGas
      ? cl.pass("agent gas", fmtGas(agentGas))
      : cl.fail(
          "agent gas",
          `${fmtGas(agentGas)}, want at least ${fmtGas(DEMO.minimums.agentGas)}`,
          isArc
            ? `fund ${demoAgent} at https://faucet.circle.com (gas is USDC on Arc)`
            : "restart the hardhat node"
        );
  }

  // ---------------------------------------------------------------
  // 6. Agent registered, funded inside the firewall, merchants set
  // ---------------------------------------------------------------
  if (!demoAgent) {
    cl.fail("agent registered", "no agent address known", "npm run provision");
    return finish(cl);
  }

  const policy = await firewall.getPolicy(demoAgent);

  if (!policy.registered) {
    cl.fail(
      "agent registered",
      `${demoAgent} is not registered`,
      isArc ? "node scripts/setupArc.js" : "node agent/setupLocal.js"
    );
  } else if (policy.revoked) {
    cl.fail(
      "agent registered",
      "agent is revoked and can never spend again",
      isArc ? "provision a new agent wallet, then node scripts/setupArc.js" : "node agent/setupLocal.js"
    );
  } else {
    cl.pass(
      "agent registered",
      `${fmt(policy.budgetPerPeriod)} USDC per ${policy.periodSeconds}s, max ${fmt(policy.maxPerTx)} per tx`
    );
  }

  // The demo needs enough deposited to complete the whole budget.
  policy.balance >= DEMO.policy.budgetPerPeriod
    ? cl.pass("agent deposit", `${fmt(policy.balance)} USDC in the firewall`)
    : cl.fail(
        "agent deposit",
        `${fmt(policy.balance)} USDC, want at least ${fmt(DEMO.policy.budgetPerPeriod)}`,
        isArc ? "node scripts/setupArc.js" : "node agent/setupLocal.js"
      );

  const merchants = record.merchants;
  if (!merchants?.allowed || !merchants?.blocked) {
    cl.fail(
      "merchants",
      "deployment record has no merchants",
      isArc ? "node scripts/setupArc.js" : "node agent/setupLocal.js"
    );
  } else {
    const allowedOk = await firewall.isMerchantAllowed(demoAgent, merchants.allowed);
    const blockedOk = await firewall.isMerchantAllowed(demoAgent, merchants.blocked);

    if (allowedOk && !blockedOk) {
      cl.pass("merchants", `1 allowlisted, 1 deliberately not`);
    } else if (!allowedOk) {
      cl.fail(
        "merchants",
        `${merchants.allowed} is not allowlisted, payment 1 would fail`,
        isArc ? "node scripts/setupArc.js" : "node agent/setupLocal.js"
      );
    } else {
      cl.fail(
        "merchants",
        `${merchants.blocked} IS allowlisted, payment 2 would wrongly pass`,
        isArc ? "node scripts/setupArc.js" : "node agent/setupLocal.js"
      );
    }
  }

  return finish(cl);
}

function finish(cl) {
  const ok = cl.render();
  if (!ok) process.exitCode = 1;
  return ok;
}

main().catch((err) => {
  console.error("");
  console.error(`Preflight failed to run: ${err.message}`);
  process.exitCode = 1;
});
