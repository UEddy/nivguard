"use strict";

// Generate the agent's nanopayment signing key.
//
// This key exists because Circle's x402 batching SDK signs offchain EIP-3009
// authorizations with a raw private key and offers no custom signer hook, so
// the Circle developer-controlled wallet that signs spend() cannot sign
// nanopayments. See the long note in agent/gateway.js.
//
// Treat it as a hot key, because it is one. It only ever controls what the
// firewall has already released into the Gateway pool under policy, which is
// the point: this is the blast radius the firewall exists to bound.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const log = require("../agent/log");

function main() {
  const write = process.argv.includes("--write");
  const wallet = ethers.Wallet.createRandom();

  log.banner("New nanopayment agent key");
  log.field("address", wallet.address);
  log.field("key", wallet.privateKey);
  log.blank();

  if (!write) {
    log.note("Add this to your .env, then run scripts/setupNano.js:");
    log.blank();
    console.log(`  AGENT_GATEWAY_PRIVATE_KEY=${wallet.privateKey}`);
    log.blank();
    log.note("Or re-run with --write to append it for you.");
    log.blank();
    return;
  }

  const envPath = path.join(__dirname, "..", ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  if (/^AGENT_GATEWAY_PRIVATE_KEY=/m.test(existing)) {
    log.note("AGENT_GATEWAY_PRIVATE_KEY is already set in .env.");
    log.note("Refusing to overwrite it. Remove the old line first if you");
    log.note("really want a new agent, and remember the old Gateway balance");
    log.note("stays with the old address.");
    log.blank();
    process.exitCode = 1;
    return;
  }

  const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(
    envPath,
    `${prefix}AGENT_GATEWAY_PRIVATE_KEY=${wallet.privateKey}\n`
  );

  log.note("Appended AGENT_GATEWAY_PRIVATE_KEY to .env");
  log.note("Next: node scripts/setupNano.js");
  log.blank();
}

main();
