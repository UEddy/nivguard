"use strict";

// Owner-side setup for the nanopayments demo on Arc.
//
// Deploys a firewall that knows about Circle Gateway, registers the agent's
// nanopayment address under a policy, allowlists the GatewayWallet as a
// destination, funds the agent, and gives it enough native USDC to pay gas on
// its own top up calls.
//
// The one genuinely new step compared with scripts/setupArc.js is
// setMerchantAllowed(agent, gatewayWallet, true). Gateway funding is not on by
// default: the owner has to allowlist Circle's deposit contract for that agent
// exactly like any other merchant. An operator who never does that has an
// agent that can pay merchants but can never open a nanopayment pool.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { CHAIN_CONFIGS } = require("@circle-fin/x402-batching/client");

const { ARC_TESTNET, loadArtifact, fmt } = require("../agent/config");
const { makeProvider } = require("../agent/provider");
const { DEMO } = require("../agent/demoConfig");
const { resolveAgentKey } = require("../agent/gateway");
const log = require("../agent/log");

const NANO = DEMO.nano;
const RECORD_PATH = path.join(__dirname, "..", "deployments", "arcTestnet-nano.json");

function ownerWallet(provider) {
  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error("PRIVATE_KEY is not set. It is the business owner's key.");
  }
  return new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
}

async function main() {
  const gatewayWallet = CHAIN_CONFIGS.arcTestnet.gatewayWallet;
  const { address: agentAddress } = resolveAgentKey();

  // The retrying provider, not a bare one. Arc's public RPC times out on
  // network auto-detection and rate limits under load, and a deploy is a bad
  // place to discover that.
  const provider = makeProvider(ARC_TESTNET);
  const owner = ownerWallet(provider);

  log.banner("NivGuard nanopayments setup on Arc");
  log.field("owner", owner.address);
  log.field("agent", `${agentAddress}  ${log.c.grey("(nanopayment key)")}`);
  log.field("gateway", `${gatewayWallet}  ${log.c.grey("(Circle GatewayWallet)")}`);
  log.blank();

  // Preflight the owner's funds before spending gas on a deploy. On Arc, USDC
  // is the native gas token, so the same balance backs both the deposit and
  // the transaction fees.
  const usdc = new ethers.Contract(
    ARC_TESTNET.usdc,
    [
      "function balanceOf(address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function transfer(address,uint256) returns (bool)",
    ],
    owner
  );

  const ownerUsdc = await usdc.balanceOf(owner.address);
  const needed = NANO.funding.agentDeposit;
  if (ownerUsdc < needed) {
    throw new Error(
      `Owner holds ${fmt(ownerUsdc)} USDC but needs at least ${fmt(needed)} ` +
        `to fund the agent. Top up from the Circle faucet.`
    );
  }
  log.field("owner USDC", `${fmt(ownerUsdc)}`);

  // ------------------------------------------------------------------
  // Deploy the firewall.
  const artifact = loadArtifact("SpendFirewall");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);

  log.blank();
  log.note("Deploying SpendFirewall...");
  const firewall = await factory.deploy(ARC_TESTNET.usdc, owner.address);
  await firewall.waitForDeployment();
  const firewallAddress = await firewall.getAddress();
  log.field("firewall", firewallAddress);

  // ------------------------------------------------------------------
  // Point it at Circle Gateway. Without this fundGateway reverts with
  // GatewayNotConfigured rather than silently doing nothing.
  await (await firewall.setGatewayWallet(gatewayWallet)).wait();
  log.field("gateway set", log.c.green("yes"));

  // Register the agent under the nano policy.
  await (
    await firewall.registerAgent(
      agentAddress,
      NANO.policy.budgetPerPeriod,
      NANO.policy.periodSeconds,
      NANO.policy.maxPerTx
    )
  ).wait();
  log.field(
    "policy",
    `${fmt(NANO.policy.budgetPerPeriod)} USDC per ${NANO.policy.periodSeconds}s, ` +
      `max ${fmt(NANO.policy.maxPerTx)} per top up`
  );

  // Allowlist the GatewayWallet as a destination for this agent.
  await (
    await firewall.setMerchantAllowed(agentAddress, gatewayWallet, true)
  ).wait();
  log.field("allowlist", `${gatewayWallet}  ${log.c.green("allowed")}`);

  // Deliberately leave a second address off the allowlist, so the demo can
  // show that the gateway is allowlisted rather than special-cased.
  log.field("allowlist", `${DEMO.merchants.blocked}  ${log.c.red("not allowed")}`);

  // Fund the agent inside the firewall.
  await (await usdc.approve(firewallAddress, ethers.MaxUint256)).wait();
  await (await firewall.deposit(agentAddress, NANO.funding.agentDeposit)).wait();
  log.field("funded", `${fmt(NANO.funding.agentDeposit)} USDC behind the firewall`);

  // ------------------------------------------------------------------
  // The agent pays gas for its own fundGateway calls, so it needs native USDC.
  // Nanopayments themselves are gasless, so this is a small one off.
  const agentGas = await provider.getBalance(agentAddress);
  if (agentGas < NANO.agentGas) {
    const topUp = NANO.agentGas - agentGas;
    await (await owner.sendTransaction({ to: agentAddress, value: topUp })).wait();
    log.field("agent gas", `${ethers.formatEther(NANO.agentGas)} native USDC sent`);
  } else {
    log.field("agent gas", `${ethers.formatEther(agentGas)} native USDC already held`);
  }

  // ------------------------------------------------------------------
  const record = {
    network: ARC_TESTNET.name,
    chainId: ARC_TESTNET.chainId,
    spendFirewall: firewallAddress,
    usdc: ARC_TESTNET.usdc,
    usdcIsMock: false,
    gatewayWallet,
    owner: owner.address,
    agent: agentAddress,
    merchants: DEMO.merchants,
    policy: {
      budgetPerPeriod: NANO.policy.budgetPerPeriod.toString(),
      periodSeconds: NANO.policy.periodSeconds,
      maxPerTx: NANO.policy.maxPerTx.toString(),
    },
    funding: NANO.funding.agentDeposit.toString(),
    timestamp: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(RECORD_PATH), { recursive: true });
  fs.writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);

  log.blank();
  log.note(`Wrote deployments/arcTestnet-nano.json`);
  log.note(`Explorer: ${ARC_TESTNET.explorer}/address/${firewallAddress}`);
  log.blank();
  log.note("Next: start the seller, then run the demo.");
  log.note("  node scripts/nanoSeller.js");
  log.note("  node agent/nanoDemo.js");
  log.blank();

  return record;
}

module.exports = { main, RECORD_PATH };

if (require.main === module) {
  main().catch((err) => {
    console.error("");
    log.banner("Nano setup failed");
    log.field("reason", err.shortMessage || err.message);
    console.error("");
    process.exitCode = 1;
  });
}
