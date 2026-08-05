"use strict";

// Send native gas to a freshly provisioned agent wallet.
//
// A new Circle wallet is created empty. On Arc the gas token is USDC, so an
// agent with a zero balance cannot broadcast anything at all, including the
// spend() calls the whole demo is built on. The faucet is a browser flow and
// cannot be scripted, so the owner tops the agent up directly instead.
//
//   node scripts/fundAgent.js                 fund AGENT_WALLET_ADDRESS
//   node scripts/fundAgent.js 0xabc... 0.25   fund an explicit address
//
// The amount is the 18 decimal native view, which is gas only. Policy amounts
// are always the 6 decimal ERC-20 view and never come through here.

const { ethers } = require("ethers");

const { ARC_TESTNET } = require("../agent/config");
const { getOwnerSigner } = require("../agent/wallet");
const { makeProvider } = require("../agent/provider");
const log = require("../agent/log");

// Enough for well over a hundred transactions at the gas prices Arc testnet
// has been quoting, and small enough that a mistyped address is not painful.
const DEFAULT_AMOUNT = "0.5";

async function main() {
  const [addressArg, amountArg] = process.argv.slice(2);

  const target = (addressArg || process.env.AGENT_WALLET_ADDRESS || "").trim();
  if (!target) {
    throw new Error(
      "No address to fund.\n" +
        "Pass one as an argument, or run npm run provision first so " +
        "AGENT_WALLET_ADDRESS is set."
    );
  }
  if (!ethers.isAddress(target)) {
    throw new Error(`Not a valid address: ${target}`);
  }

  const amount = ethers.parseEther(amountArg || DEFAULT_AMOUNT);

  const provider = makeProvider(ARC_TESTNET);
  const owner = getOwnerSigner({ provider, networkName: ARC_TESTNET.name });

  const ownerBalance = await provider.getBalance(owner.address);
  if (ownerBalance <= amount) {
    throw new Error(
      `Owner holds ${ethers.formatEther(ownerBalance)} USDC and cannot send ` +
        `${ethers.formatEther(amount)} plus gas.\n` +
        `Top up ${owner.address} at https://faucet.circle.com`
    );
  }

  log.banner("Funding an agent wallet with gas");
  log.field("from", `${owner.address}  ${log.c.grey(`(${owner.sourceLabel})`)}`);
  log.field("to", ethers.getAddress(target));
  log.field("amount", `${ethers.formatEther(amount)} USDC  ${log.c.grey("(native, gas)")}`);

  const tx = await owner.sendTransaction({ to: target, value: amount });
  const receipt = await tx.wait();

  log.blank();
  log.field("tx", `${tx.hash}  ${log.c.grey(`block ${receipt.blockNumber}`)}`);
  log.field("balance", `${ethers.formatEther(await provider.getBalance(target))} USDC  ${log.c.grey("(agent, gas)")}`);
  log.blank();
  console.log(`  ${ARC_TESTNET.explorer}/tx/${tx.hash}`);
}

main().catch((err) => {
  console.error("");
  console.error(`Funding failed: ${err.message}`);
  process.exitCode = 1;
});
