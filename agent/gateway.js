"use strict";

// The nanopayment side of NivGuard.
//
// Everything above this file deals in onchain calls the firewall can see and
// gate. Everything below it deals in offchain EIP-3009 authorizations that
// Circle batches and settles, which the firewall cannot see at all. This file
// is the seam, and the comments here are mostly about why the seam is where
// it is.
//
// The short version:
//
//   fundGateway()  onchain, gated by policy, one transaction per top up
//   gateway.pay()  offchain, not gated by anything, thousands per top up
//
// So the firewall controls the tap, not each drop. That is not a compromise
// in the implementation, it is what nanopayments are. An authorization is a
// signature, not a transaction, and you cannot put a require() in front of a
// signature someone makes on their own machine.

const { GatewayClient, CHAIN_CONFIGS } = require("@circle-fin/x402-batching/client");
const { ethers } = require("ethers");

const { ARC_TESTNET } = require("./config");

/// Resolve the agent's nanopayment signing key.
///
/// This key is deliberately NOT the Circle developer-controlled wallet that
/// signs spend() and fundGateway(). It cannot be: GatewayClient takes a raw
/// `privateKey` and exposes no custom signer hook, while a Circle custody
/// wallet never releases a key. The two halves of this feature are signed by
/// two different things, and that is a property of Circle's SDK, not a
/// shortcut taken here.
///
/// The split is defensible on its own terms. The hot key only ever controls
/// what the firewall has already released into the Gateway pool, under policy.
/// The treasury stays behind the firewall with Circle custody. Losing the hot
/// key costs you one top up, not the balance sheet, and the owner can revoke
/// the agent so no further top up ever lands.
function resolveAgentKey() {
  const key = process.env.AGENT_GATEWAY_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "AGENT_GATEWAY_PRIVATE_KEY is not set.\n" +
        "This is the agent's nanopayment signing key, separate from the Circle\n" +
        "custody wallet, because the x402 batching SDK signs offchain\n" +
        "authorizations with a raw key and has no custom signer hook.\n" +
        "Generate one with:  node scripts/newNanoAgent.js"
    );
  }
  const normalised = key.startsWith("0x") ? key : `0x${key}`;
  try {
    return { privateKey: normalised, address: new ethers.Wallet(normalised).address };
  } catch {
    throw new Error("AGENT_GATEWAY_PRIVATE_KEY is not a valid private key");
  }
}

/// Wrapper around Circle's GatewayClient, holding the small amount of NivGuard
/// specific behaviour: consistent formatting, and balances that are read
/// straight from Circle rather than inferred from our own bookkeeping.
class NanoAgent {
  constructor({ client, address, chainName }) {
    this.client = client;
    this.address = address;
    this.chainName = chainName;
    this.paid = [];
  }

  static create({ chainName = ARC_TESTNET.gatewayChainName } = {}) {
    const { privateKey, address } = resolveAgentKey();

    if (!CHAIN_CONFIGS[chainName]) {
      throw new Error(
        `The x402 batching SDK does not know a chain called "${chainName}". ` +
          `Known: ${Object.keys(CHAIN_CONFIGS).join(", ")}`
      );
    }

    const client = new GatewayClient({ chain: chainName, privateKey });

    // The SDK derives the same address from the key. If it does not match what
    // ethers derived, something is wrong with the key handling and we should
    // find out here rather than after funding the wrong address.
    if (client.address.toLowerCase() !== address.toLowerCase()) {
      throw new Error(
        `Key mismatch: SDK derived ${client.address}, ethers derived ${address}`
      );
    }

    return new NanoAgent({ client, address, chainName });
  }

  /// The GatewayWallet this agent's balance lives in. This is the address the
  /// firewall has to be pointed at and the agent has to have allowlisted, so
  /// the demo reads it from the SDK rather than trusting a constant.
  get gatewayWallet() {
    return CHAIN_CONFIGS[this.chainName].gatewayWallet;
  }

  /// Live balances, straight from Circle.
  ///
  /// `wallet` is ordinary USDC sitting in the agent's own account. `gateway`
  /// is the nanopayment pool. Only the latter can pay a 402, and only the
  /// firewall can top it up, which is the entire point of the design.
  async balances() {
    const b = await this.client.getBalances();
    return {
      wallet: b.wallet.formatted,
      available: b.gateway.formattedAvailable,
      availableRaw: b.gateway.available,
      total: b.gateway.formattedTotal,
    };
  }

  /// Check that a URL actually speaks batched x402 before trying to pay it.
  /// A plain 402 that does not support batching would make the agent sign an
  /// authorization nobody can settle.
  async supports(url) {
    try {
      return await this.client.supports(url);
    } catch (err) {
      return { supported: false, error: err.message };
    }
  }

  /// Pay one x402 protected resource out of the Gateway balance.
  ///
  /// No transaction is broadcast here. The SDK gets a 402, signs an EIP-3009
  /// authorization against the GatewayWalletBatched domain, and hands it over
  /// in a header. Circle settles it later, batched with everyone else's.
  async pay(url, { method = "GET", body } = {}) {
    const started = Date.now();
    const result = await this.client.pay(url, { method, body });
    const record = {
      url,
      method,
      amount: result.amount,
      formattedAmount: result.formattedAmount,
      transaction: result.transaction,
      ms: Date.now() - started,
      data: result.data,
    };
    this.paid.push(record);
    return record;
  }

  /// Total spent in nanopayments during this run, in 6 decimal base units.
  get totalPaid() {
    return this.paid.reduce((sum, p) => sum + BigInt(p.amount), 0n);
  }
}

module.exports = { NanoAgent, resolveAgentKey };
