"use strict";

// A minimal x402 seller, so the nanopayment demo has something real to buy.
//
// Circle's own sample seller is a Next.js app with a Supabase backend. None of
// that is needed to prove the point, and dragging it in would make the demo
// about their stack rather than ours. This is the same protocol in one file:
// return 402 with payment requirements, then verify and settle whatever the
// buyer signs, using Circle's BatchFacilitatorClient for both.
//
// The prices are deliberately sub-cent. That is the whole reason nanopayments
// exist: at 0.0002 USDC a call, an onchain transaction per payment would cost
// orders of magnitude more than the thing being bought.

const http = require("http");

const { BatchFacilitatorClient } = require("@circle-fin/x402-batching/server");
const { CHAIN_CONFIGS } = require("@circle-fin/x402-batching/client");

const { DEMO } = require("../agent/demoConfig");
const log = require("../agent/log");

const CHAIN = process.env.NANO_CHAIN || "arcTestnet";
const PORT = Number(process.env.NANO_SELLER_PORT || 4021);

// Where the nanopayments land. The allowlisted demo merchant, so the story
// stays consistent: the same vendor the firewall approves for direct spend is
// the vendor the agent buys from in nanopayments.
const SELLER_ADDRESS = process.env.NANO_SELLER_ADDRESS || DEMO.merchants.allowed;

const config = CHAIN_CONFIGS[CHAIN];
if (!config) {
  throw new Error(`Unknown chain "${CHAIN}"`);
}

// The x402 network identifier is CAIP-2, not the chain name.
const NETWORK = `eip155:${config.chain.id}`;

// Circle runs two facilitators, and the SDK defaults to the mainnet one.
//
// This cost real time to find, so it is worth writing down: a seller that
// leaves the default in place will advertise Arc testnet in its 402, take a
// perfectly valid signature from the buyer, and then reject it with
// `unsupported_network`, because the mainnet facilitator serves 11 mainnet
// chains and no testnets at all. The error names the network, which sends you
// looking at your own CAIP-2 string rather than at the endpoint.
const FACILITATOR_URL =
  process.env.NANO_FACILITATOR_URL ||
  (config.chain.testnet
    ? "https://gateway-api-testnet.circle.com"
    : "https://gateway-api.circle.com");

// How long the buyer's authorization must stay valid. The facilitator
// advertises a `minValiditySeconds` per network (604800, seven days, on Arc
// testnet) and rejects anything shorter, so this is not a free choice.
const MAX_TIMEOUT_SECONDS = Number(process.env.NANO_MAX_TIMEOUT_SECONDS || 604800);

// The catalogue. Prices are in USDC, all well under a cent.
const CATALOGUE = {
  "/api/embedding": { price: 0.0002, method: "GET", label: "text embedding" },
  "/api/rerank": { price: 0.0001, method: "GET", label: "rerank a result set" },
  "/api/inference": { price: 0.0004, method: "POST", label: "small model inference" },
  "/api/scrape": { price: 0.0025, method: "GET", label: "fetch and clean a page" },
};

const facilitator = new BatchFacilitatorClient({ url: FACILITATOR_URL });

let settledCount = 0;
let settledTotal = 0n;

/// Build the x402 payment requirements for one endpoint.
///
/// The `extra` block is what makes this a *batched* x402 payment rather than
/// an ordinary one. It names the EIP-712 domain the buyer signs against, which
/// is Circle's GatewayWalletBatched contract. Without it the buyer would sign
/// a plain transfer authorization that Circle would have no mandate to batch.
function requirementsFor(path) {
  const item = CATALOGUE[path];
  const atomic = Math.round(item.price * 1_000_000);

  return {
    scheme: "exact",
    network: NETWORK,
    asset: config.usdc,
    amount: atomic.toString(),
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: config.gatewayWallet,
    },
  };
}

/// Retry a Circle API call through a transient connect failure.
///
/// gateway-api-testnet.circle.com sits behind Cloudflare and occasionally
/// hands out an edge IP that will not accept a connection, which surfaces as
/// undici's UND_ERR_CONNECT_TIMEOUT after 10 seconds. A second attempt
/// normally lands on a different address and succeeds. Verify and settle are
/// both safe to repeat: verify is a pure read, and settle is keyed on the
/// authorization nonce, so a replay cannot double charge the buyer.
async function withRetry(label, fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = err?.cause?.code || err?.code;
      const transient =
        code === "UND_ERR_CONNECT_TIMEOUT" ||
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        /fetch failed/i.test(err?.message || "");
      if (!transient || i === attempts - 1) throw err;
      log.field("retry", log.c.yellow(`${label} (${code || "fetch failed"})`));
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

/// The resource itself. Trivial on purpose: what matters is that it is behind
/// a paywall, not what it returns.
function serve(path, requestBody) {
  switch (path) {
    case "/api/embedding":
      return { vector: [0.021, -0.118, 0.443, 0.097], dims: 4 };
    case "/api/rerank":
      return { order: [2, 0, 1], model: "nivguard-rerank-demo" };
    case "/api/inference":
      return {
        input: requestBody?.text ?? null,
        sentiment: "positive",
        confidence: 0.91,
      };
    case "/api/scrape":
      return { title: "Example page", words: 812, cleaned: true };
    default:
      return {};
  }
}

async function handle(req, res, path, requestBody) {
  const item = CATALOGUE[path];
  const requirements = requirementsFor(path);
  const paymentSignature = req.headers["payment-signature"];

  // No payment yet. Answer 402 and tell the buyer exactly what to sign.
  if (!paymentSignature) {
    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: `http://localhost:${PORT}${path}`,
        description: `${item.label} ($${item.price} USDC)`,
        mimeType: "application/json",
      },
      accepts: [requirements],
    };

    log.field(
      "402",
      `${path}  ${log.c.grey(`asking ${item.price} USDC`)}`
    );

    return send(res, 402, {}, {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
    });
  }

  // Payment present. Verify the signature, then ask Circle to settle it.
  let payload;
  try {
    payload = JSON.parse(Buffer.from(paymentSignature, "base64").toString("utf8"));
  } catch {
    return send(res, 400, { error: "PAYMENT-SIGNATURE is not valid base64 JSON" });
  }

  const verified = await withRetry("verify", () =>
    facilitator.verify(payload, requirements)
  );
  if (!verified.isValid) {
    log.field("reject", `${path}  ${log.c.red(verified.invalidReason || "invalid")}`);
    return send(res, 402, {
      error: "payment verification failed",
      reason: verified.invalidReason,
    });
  }

  const settled = await withRetry("settle", () =>
    facilitator.settle(payload, requirements)
  );
  if (!settled.success) {
    log.field("reject", `${path}  ${log.c.red(settled.errorReason || "settle failed")}`);
    return send(res, 402, {
      error: "payment settlement failed",
      reason: settled.errorReason,
    });
  }

  settledCount += 1;
  settledTotal += BigInt(requirements.amount);

  const payer = settled.payer || verified.payer || "unknown";
  log.field(
    "settled",
    `${path.padEnd(16)} ${log.c.green(`${item.price} USDC`)} ` +
      `${log.c.grey(`from ${payer.slice(0, 10)}...  #${settledCount}`)}`
  );

  return send(res, 200, serve(path, requestBody), {
    "PAYMENT-RESPONSE": Buffer.from(
      JSON.stringify({
        success: true,
        transaction: settled.transaction,
        network: NETWORK,
        payer,
      })
    ).toString("base64"),
  });
}

const server = http.createServer((req, res) => {
  const path = (req.url || "").split("?")[0];

  if (path === "/health") {
    return send(res, 200, {
      ok: true,
      chain: CHAIN,
      network: NETWORK,
      payTo: SELLER_ADDRESS,
      settledCount,
      settledTotal: settledTotal.toString(),
      endpoints: Object.keys(CATALOGUE),
    });
  }

  if (!CATALOGUE[path]) {
    return send(res, 404, { error: "no such resource", available: Object.keys(CATALOGUE) });
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = null;
    if (chunks.length) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = null;
      }
    }
    handle(req, res, path, body).catch((err) => {
      log.field("error", log.c.red(err.message));
      send(res, 500, { error: err.message });
    });
  });
});

function start() {
  return new Promise((resolve) => {
    server.listen(PORT, () => {
      log.banner("NivGuard x402 seller");
      log.field("listening", `http://localhost:${PORT}`);
      log.field("chain", `${CHAIN}  ${log.c.grey(NETWORK)}`);
      log.field("pays to", SELLER_ADDRESS);
      log.field("gateway", config.gatewayWallet);
      log.field("via", FACILITATOR_URL);
      log.blank();
      for (const [path, item] of Object.entries(CATALOGUE)) {
        log.field(
          `$${item.price}`,
          `${item.method.padEnd(5)} ${path}  ${log.c.grey(item.label)}`
        );
      }
      log.blank();
      log.note("Waiting for nanopayments. Every line below is a real settlement.");
      log.blank();
      resolve(server);
    });
  });
}

module.exports = { start, server, CATALOGUE, PORT, SELLER_ADDRESS };

if (require.main === module) {
  start();
}
