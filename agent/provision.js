"use strict";

// Provision a Circle developer-controlled wallet for the agent.
//
// Creates a wallet set and one EOA wallet on Arc testnet, then writes the
// wallet id and address into .env. The agent signs through Circle from then
// on. No private key is ever created, stored, or read by this repo.
//
// Prerequisite, and this is yours to do, not mine: generate an entity secret,
// register it with Circle, and store the recovery file somewhere safe. See
// agent/README.md. This script will not register a secret on your behalf.

const fs = require("fs");
const path = require("path");

const { ARC_TESTNET } = require("./config");
const { makeClient } = require("./signers/circleSigner");

const ENV_PATH = path.join(__dirname, "..", ".env");

/// Upsert KEY=value lines in .env without disturbing anything else.
function writeEnv(values) {
  let lines = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  }

  for (const [key, value] of Object.entries(values)) {
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }

  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  fs.writeFileSync(ENV_PATH, `${lines.join("\n")}\n`);
}

async function main() {
  const client = makeClient();

  const setName = process.env.CIRCLE_WALLET_SET_NAME || "NivGuard agents";

  console.log("Provisioning a Circle developer-controlled wallet");
  console.log(`  blockchain  ${ARC_TESTNET.circleBlockchain}`);
  console.log(`  wallet set  ${setName}`);
  console.log("");

  // Reuse an existing wallet set if one was already provisioned, so running
  // this twice does not litter the account with duplicates.
  let walletSetId = process.env.CIRCLE_WALLET_SET_ID;

  if (walletSetId) {
    console.log(`Reusing wallet set ${walletSetId}`);
  } else {
    const res = await client.createWalletSet({ name: setName });
    walletSetId = res.data?.walletSet?.id;
    if (!walletSetId) throw new Error("Circle did not return a wallet set id");
    console.log(`Created wallet set ${walletSetId}`);
  }

  const walletsRes = await client.createWallets({
    walletSetId,
    blockchains: [ARC_TESTNET.circleBlockchain],
    count: 1,
    accountType: "EOA",
  });

  const wallet = (walletsRes.data?.wallets ?? [])[0];
  if (!wallet) throw new Error("Circle did not return a wallet");

  console.log(`Created agent wallet ${wallet.id}`);
  console.log(`  address     ${wallet.address}`);
  console.log(`  blockchain  ${wallet.blockchain}`);

  writeEnv({
    CIRCLE_WALLET_SET_ID: walletSetId,
    AGENT_WALLET_ID: wallet.id,
    AGENT_WALLET_ADDRESS: wallet.address,
  });

  console.log("");
  console.log("Wrote CIRCLE_WALLET_SET_ID, AGENT_WALLET_ID and");
  console.log("AGENT_WALLET_ADDRESS to .env, which is gitignored.");
  console.log("");
  console.log("Next:");
  console.log(`  1. Fund ${wallet.address} with testnet USDC for gas:`);
  console.log("     https://faucet.circle.com");
  console.log("  2. As the firewall owner, register this address as an agent");
  console.log("     and allowlist the merchants it may pay.");
}

main().catch((err) => {
  console.error("");
  console.error("Provisioning failed:");
  console.error(`  ${err.message}`);
  if (err.response?.data) {
    console.error(`  ${JSON.stringify(err.response.data)}`);
  }
  process.exitCode = 1;
});
