"use strict";

// Rewrites the CONFIG block in web/index.html from deployments/arcTestnet.json.
//
// The dashboard is a single self-contained file with no build step, so its
// addresses are baked in. After a redeploy or a fresh agent, run this instead
// of hand editing them and getting one digit wrong.
//
//   npm run sync:dashboard

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const { ARC_TESTNET } = require("../agent/config");
const { makeProvider } = require("../agent/provider");

const HTML = path.join(__dirname, "..", "web", "index.html");
const RECORD = path.join(__dirname, "..", "deployments", "arcTestnet.json");

// Browser-safe RPC. The direct Arc RPC sends no access-control-allow-origin
// header on POST responses, so a browser blocks it. Blockscout sends "*".
const BROWSER_RPC = "https://testnet.arcscan.app/api/eth-rpc";

async function deployBlockOf(record) {
  if (!record.deployTx) return 0;
  try {
    const provider = makeProvider(ARC_TESTNET);
    const receipt = await provider.getTransactionReceipt(record.deployTx);
    return receipt ? receipt.blockNumber : 0;
  } catch {
    return 0;
  }
}

async function main() {
  if (!fs.existsSync(RECORD)) {
    throw new Error("No deployments/arcTestnet.json. Deploy first: npm run deploy:arc");
  }
  if (!fs.existsSync(HTML)) {
    throw new Error("web/index.html is missing");
  }

  const record = JSON.parse(fs.readFileSync(RECORD, "utf8"));

  if (!record.merchants?.allowed || !record.merchants?.blocked) {
    throw new Error(
      "The deployment record has no merchants. Run: node scripts/setupArc.js"
    );
  }

  const deployBlock = await deployBlockOf(record);

  const block = `const CONFIG = {
  // Blockscout's JSON-RPC. Used rather than https://rpc.testnet.arc.network
  // because that endpoint returns no access-control-allow-origin header on
  // POST responses, so a browser blocks it. This one sends "*" and serves
  // eth_call and eth_getLogs over the full history without a range cap.
  rpcUrl: ${JSON.stringify(BROWSER_RPC)},
  chainId: ${record.chainId},
  explorer: ${JSON.stringify(ARC_TESTNET.explorer)},
  spendFirewall: ${JSON.stringify(ethers.getAddress(record.spendFirewall))},
  agent: ${JSON.stringify(record.agent)},
  deployBlock: ${deployBlock},
  merchants: {
    allowed: ${JSON.stringify(ethers.getAddress(record.merchants.allowed))},
    blocked: ${JSON.stringify(ethers.getAddress(record.merchants.blocked))}
  }
};`;

  const html = fs.readFileSync(HTML, "utf8");
  const re = /const CONFIG = \{[\s\S]*?\n\};/;

  if (!re.test(html)) {
    throw new Error("Could not find the CONFIG block in web/index.html");
  }

  fs.writeFileSync(HTML, html.replace(re, block));

  console.log("Synced web/index.html from deployments/arcTestnet.json");
  console.log(`  firewall     ${record.spendFirewall}`);
  console.log(`  agent        ${record.agent}`);
  console.log(`  deployBlock  ${deployBlock}`);
  console.log(`  merchant A   ${record.merchants.allowed}  allowlisted`);
  console.log(`  merchant B   ${record.merchants.blocked}  not allowlisted`);
}

main().catch((err) => {
  console.error("");
  console.error(`Dashboard sync failed: ${err.message}`);
  process.exitCode = 1;
});
