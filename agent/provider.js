"use strict";

// A JSON-RPC provider that survives public testnet infrastructure.
//
// Two failure modes have shown up against Arc's public RPC, and both would
// ruin a recorded demo run if they landed mid sequence:
//
//   1. ethers' network auto-detection timing out on the first call
//   2. the endpoint returning -32011 "request limit reached" under load
//
// Neither is a chain problem and neither means the transaction was wrong, so
// the right response is to back off and try again rather than fail the run.

const { ethers } = require("ethers");

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/// Rate limiting specifically. The server rejected the request before doing
/// anything with it, so even a state-changing call is safe to send again.
function isRateLimit(err) {
  const code = err?.error?.code ?? err?.code;
  const msg = `${err?.error?.message || ""} ${err?.message || ""}`.toLowerCase();
  return (
    code === -32011 ||
    code === 429 ||
    msg.includes("request limit") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

/// Broader transient trouble: timeouts, socket resets, gateway errors. These
/// are ambiguous for a send, because the request may already have been
/// accepted, so only read calls are retried on these.
function isTransient(err) {
  const code = err?.code;
  const msg = `${err?.message || ""}`.toLowerCase();
  return (
    isRateLimit(err) ||
    code === "TIMEOUT" ||
    code === "SERVER_ERROR" ||
    code === "NETWORK_ERROR" ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("bad gateway")
  );
}

// Sending a transaction twice is only safe when we know the first attempt was
// refused outright. Anything else risks a duplicate broadcast.
const SEND_METHODS = new Set(["eth_sendRawTransaction", "eth_sendTransaction"]);

class RetryingJsonRpcProvider extends ethers.JsonRpcProvider {
  constructor(url, network, options) {
    super(url, network, options);
    this._retryLog = [];
  }

  async send(method, params) {
    let lastErr;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await super.send(method, params);
      } catch (err) {
        lastErr = err;

        // A send is only retried when the node explicitly refused it. If a
        // send timed out it may already be in the mempool, and re-broadcasting
        // could double spend, so that one is surfaced instead.
        const retryable = SEND_METHODS.has(method)
          ? isRateLimit(err)
          : isTransient(err);

        if (!retryable || attempt === MAX_ATTEMPTS - 1) throw err;

        const wait = BASE_DELAY_MS * 2 ** attempt;
        this._retryLog.push({ method, attempt: attempt + 1, wait });
        await sleep(wait);
      }
    }

    throw lastErr;
  }

  get retries() {
    return this._retryLog.length;
  }
}

/// Build a provider for a network config from agent/config.js.
/// staticNetwork skips auto-detection, which is what timed out before.
function makeProvider(network, { timeoutMs = 60_000 } = {}) {
  const net = new ethers.Network(network.name, network.chainId);
  const req = new ethers.FetchRequest(network.rpcUrl);
  req.timeout = timeoutMs;

  return new RetryingJsonRpcProvider(req, net, { staticNetwork: net });
}

module.exports = { makeProvider, RetryingJsonRpcProvider, isRateLimit, isTransient };
