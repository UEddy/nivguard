"use strict";

// Owner-side setup for the local demo.
//
// Deploys MockUSDC and SpendFirewall to a running hardhat node, registers the
// agent under a policy, allowlists one merchant but deliberately not another,
// and funds the agent. Writes deployments/localhost.json for the runner.
//
// This is the business operator's job, not the agent's. The agent never has
// the authority to do any of it.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const { LOCALHOST, loadArtifact, fmt } = require("./config");
const log = require("./log");

// All demo numbers live in agent/demoConfig.js so local and Arc cannot drift.
const { DEMO, assertCoherent } = require("./demoConfig");

assertCoherent();

const BUDGET_PER_PERIOD = DEMO.policy.budgetPerPeriod;
const PERIOD_SECONDS = BigInt(DEMO.policy.periodSeconds);
const MAX_PER_TX = DEMO.policy.maxPerTx;
const AGENT_FUNDING = DEMO.funding.agentDeposit;

/// Deploy and configure a fresh firewall on the local node.
/// Called directly by the operator, and by demo.js so every demo run starts
/// from a clean slate rather than inheriting the previous run's revoked agent.
async function setupLocal() {
  const provider = new ethers.JsonRpcProvider(LOCALHOST.rpcUrl, {
    chainId: LOCALHOST.chainId,
    name: LOCALHOST.name,
  });

  try {
    await provider.getBlockNumber();
  } catch {
    throw new Error(
      `No hardhat node at ${LOCALHOST.rpcUrl}.\n` +
        `Start one in another terminal:  npx hardhat node`
    );
  }

  const accounts = await provider.listAccounts();
  if (accounts.length < 4) {
    throw new Error("The local node needs at least 4 accounts");
  }

  const owner = await provider.getSigner(0);
  const agentAddress = await accounts[1].getAddress();
  // Same dedicated merchants the Arc demo uses, so local and Arc match.
  const allowedMerchant = ethers.getAddress(DEMO.merchants.allowed);
  const blockedMerchant = ethers.getAddress(DEMO.merchants.blocked);

  log.banner("NivGuard local setup");

  // Deploy the 6 decimal USDC stand in.
  const usdcArtifact = loadArtifact("MockUSDC");
  const usdcFactory = new ethers.ContractFactory(
    usdcArtifact.abi,
    usdcArtifact.bytecode,
    owner
  );
  const usdc = await usdcFactory.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  log.field("USDC", `${usdcAddress}  ${log.c.grey("(mock, 6 decimals)")}`);

  // Deploy the firewall.
  const fwArtifact = loadArtifact("SpendFirewall");
  const fwFactory = new ethers.ContractFactory(
    fwArtifact.abi,
    fwArtifact.bytecode,
    owner
  );
  const firewall = await fwFactory.deploy(usdcAddress, await owner.getAddress());
  await firewall.waitForDeployment();
  const firewallAddress = await firewall.getAddress();
  log.field("firewall", firewallAddress);

  // Fund the owner and approve the firewall.
  await (await usdc.mint(await owner.getAddress(), AGENT_FUNDING * 10n)).wait();
  await (await usdc.approve(firewallAddress, ethers.MaxUint256)).wait();

  // Register the agent under its policy.
  await (
    await firewall.registerAgent(
      agentAddress,
      BUDGET_PER_PERIOD,
      PERIOD_SECONDS,
      MAX_PER_TX
    )
  ).wait();

  // One merchant is allowlisted. The other deliberately is not, so the demo
  // has a real non-allowlisted target rather than a fabricated one.
  await (
    await firewall.setMerchantAllowed(agentAddress, allowedMerchant, true)
  ).wait();

  await (await firewall.deposit(agentAddress, AGENT_FUNDING)).wait();

  log.blank();
  log.field("agent", agentAddress);
  log.field("policy", `${fmt(BUDGET_PER_PERIOD)} USDC per ${PERIOD_SECONDS}s, max ${fmt(MAX_PER_TX)} USDC per tx`);
  log.field("funded", `${fmt(AGENT_FUNDING)} USDC`);
  log.blank();
  log.field("merchant A", `${allowedMerchant}  ${log.c.green("allowlisted")}`);
  log.field("merchant B", `${blockedMerchant}  ${log.c.red("not allowlisted")}`);

  const record = {
    network: LOCALHOST.name,
    chainId: LOCALHOST.chainId,
    spendFirewall: firewallAddress,
    usdc: usdcAddress,
    usdcIsMock: true,
    owner: await owner.getAddress(),
    agent: agentAddress,
    merchants: { allowed: allowedMerchant, blocked: blockedMerchant },
    policy: {
      budgetPerPeriod: BUDGET_PER_PERIOD.toString(),
      periodSeconds: Number(PERIOD_SECONDS),
      maxPerTx: MAX_PER_TX.toString(),
    },
    timestamp: new Date().toISOString(),
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "localhost.json"),
    `${JSON.stringify(record, null, 2)}\n`
  );

  log.blank();
  log.note("Wrote deployments/localhost.json");

  return record;
}

module.exports = { setupLocal };

if (require.main === module) {
  setupLocal()
    .then(() => log.note("Next: node agent/demo.js"))
    .catch((err) => {
      console.error("");
      console.error(`Setup failed: ${err.message}`);
      process.exitCode = 1;
    });
}
