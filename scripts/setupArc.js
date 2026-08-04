"use strict";

// Arc testnet equivalent of agent/setupLocal.js.
//
// Assumes SpendFirewall is already deployed by scripts/deploy.js. Registers
// the Circle agent wallet under the demo policy, allowlists one merchant and
// deliberately not another, approves and deposits USDC, then writes the same
// deployment file shape agent/demo.js already reads. No special casing in the
// demo: it loads deployments/arcTestnet.json exactly as it loads localhost.
//
// Safe to re-run. An already registered agent has its policy updated rather
// than triggering AgentAlreadyRegistered.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const { ARC_TESTNET, loadArtifact, fmt } = require("../agent/config");
const { DEMO, assertCoherent } = require("../agent/demoConfig");
const { getOwnerSigner, localAccount } = require("../agent/wallet");
const { makeProvider } = require("../agent/provider");
const log = require("../agent/log");

const DEPLOYMENTS = path.join(__dirname, "..", "deployments");

/// Merchants only ever receive funds, they never sign, so any address works.
/// Override with MERCHANT_ALLOWED and MERCHANT_BLOCKED for real vendors.
function resolveMerchants() {
  const allowed = (process.env.MERCHANT_ALLOWED || "").trim();
  const blocked = (process.env.MERCHANT_BLOCKED || "").trim();

  return {
    allowed: allowed ? ethers.getAddress(allowed) : localAccount(2).address,
    blocked: blocked ? ethers.getAddress(blocked) : localAccount(3).address,
    fromEnv: Boolean(allowed && blocked),
  };
}

function readDeployment() {
  const file = path.join(DEPLOYMENTS, "arcTestnet.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "No deployments/arcTestnet.json found.\n" +
        "Deploy the contract first:  npm run deploy:arc"
    );
  }
  return { file, record: JSON.parse(fs.readFileSync(file, "utf8")) };
}

async function main() {
  assertCoherent();

  const agentAddress = (process.env.AGENT_WALLET_ADDRESS || "").trim();
  if (!agentAddress) {
    throw new Error(
      "AGENT_WALLET_ADDRESS is not set.\n" +
        "Create the Circle agent wallet first:  npm run provision"
    );
  }

  const { file, record } = readDeployment();

  const provider = makeProvider(ARC_TESTNET);

  const owner = getOwnerSigner({
    provider,
    networkName: ARC_TESTNET.name,
    expectedOwner: record.owner,
  });

  log.banner("NivGuard Arc testnet setup");
  log.field("network", `${ARC_TESTNET.name}  ${log.c.grey(`(chainId ${ARC_TESTNET.chainId})`)}`);
  log.field("firewall", record.spendFirewall);
  log.field("owner", `${owner.address}  ${log.c.grey(`(${owner.sourceLabel})`)}`);
  log.field("agent", `${agentAddress}  ${log.c.grey("(Circle wallet)")}`);

  const firewall = new ethers.Contract(
    record.spendFirewall,
    loadArtifact("SpendFirewall").abi,
    owner
  );

  const usdc = new ethers.Contract(
    ARC_TESTNET.usdc,
    [
      "function approve(address,uint256) returns (bool)",
      "function allowance(address,address) view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ],
    owner
  );

  // Guard the decimal trap explicitly rather than trusting it.
  const decimals = await usdc.decimals();
  if (Number(decimals) !== 6) {
    throw new Error(
      `USDC at ${ARC_TESTNET.usdc} reports ${decimals} decimals, expected 6. ` +
        `Policy amounts use the 6 decimal ERC-20 view.`
    );
  }

  const deposit = DEMO.funding.agentDeposit;
  const held = await usdc.balanceOf(owner.address);
  if (held < deposit) {
    throw new Error(
      `Owner holds ${fmt(held)} USDC but needs ${fmt(deposit)} to fund the agent.\n` +
        `Top up ${owner.address} at https://faucet.circle.com`
    );
  }

  const merchants = resolveMerchants();
  log.blank();
  log.field("merchant A", `${merchants.allowed}  ${log.c.green("will be allowlisted")}`);
  log.field("merchant B", `${merchants.blocked}  ${log.c.red("deliberately not")}`);
  if (!merchants.fromEnv) {
    log.note("Demo merchants. Set MERCHANT_ALLOWED and MERCHANT_BLOCKED to override.");
  }

  const txs = [];
  const send = async (label, promise) => {
    const tx = await promise;
    const receipt = await tx.wait();
    txs.push({ label, hash: tx.hash });
    log.field(label, `${tx.hash}  ${log.c.grey(`block ${receipt.blockNumber}`)}`);
    return receipt;
  };

  log.blank();

  // Register, or update if this agent was set up on a previous run.
  const existing = await firewall.getPolicy(agentAddress);

  if (existing.revoked) {
    throw new Error(
      `Agent ${agentAddress} is revoked on this firewall and cannot be reused.\n` +
        `Provision a new agent wallet, or redeploy the firewall.`
    );
  }

  if (existing.registered) {
    log.note("Agent already registered, updating its policy instead.");
    await send(
      "updatePolicy",
      firewall.updatePolicy(
        agentAddress,
        DEMO.policy.budgetPerPeriod,
        DEMO.policy.periodSeconds,
        DEMO.policy.maxPerTx
      )
    );
  } else {
    await send(
      "register",
      firewall.registerAgent(
        agentAddress,
        DEMO.policy.budgetPerPeriod,
        DEMO.policy.periodSeconds,
        DEMO.policy.maxPerTx
      )
    );
  }

  await send(
    "allowlist",
    firewall.setMerchantAllowed(agentAddress, merchants.allowed, true)
  );

  // Make sure merchant B is explicitly off, in case a previous run allowed it.
  if (await firewall.isMerchantAllowed(agentAddress, merchants.blocked)) {
    await send(
      "de-allowlist",
      firewall.setMerchantAllowed(agentAddress, merchants.blocked, false)
    );
  }

  const allowance = await usdc.allowance(owner.address, record.spendFirewall);
  if (allowance < deposit) {
    await send("approve", usdc.approve(record.spendFirewall, deposit));
  }

  await send("deposit", firewall.deposit(agentAddress, deposit));

  // Write the record in the shape demo.js already expects.
  const updated = {
    ...record,
    agent: agentAddress,
    merchants: { allowed: merchants.allowed, blocked: merchants.blocked },
    policy: {
      budgetPerPeriod: DEMO.policy.budgetPerPeriod.toString(),
      periodSeconds: DEMO.policy.periodSeconds,
      maxPerTx: DEMO.policy.maxPerTx.toString(),
    },
    setupTimestamp: new Date().toISOString(),
  };

  fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`);

  const policy = await firewall.getPolicy(agentAddress);
  log.blank();
  log.field("policy", `${fmt(policy.budgetPerPeriod)} USDC per ${policy.periodSeconds}s`);
  log.field("", `${fmt(policy.maxPerTx)} USDC max per transaction`);
  log.field("funded", `${fmt(policy.balance)} USDC`);

  log.blank();
  log.note("Wrote deployments/arcTestnet.json");
  log.note("Next: npm run preflight, then npm run demo:arc");

  log.blank();
  for (const t of txs) {
    console.log(`  ${t.label.padEnd(14)}${ARC_TESTNET.explorer}/tx/${t.hash}`);
  }
}

main().catch((err) => {
  console.error("");
  console.error(`Arc setup failed: ${err.message}`);
  process.exitCode = 1;
});
