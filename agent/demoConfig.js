"use strict";

// The one place to edit demo numbers.
//
// setupLocal.js, scripts/setupArc.js, scripts/preflight.js and demo.js all
// read from here, so the local demo and the Arc demo can never drift apart.
//
// Sized for testnet faucet reality: single digit USDC, not thousands. The
// shape of the demo matters, not the magnitudes. Every one of the six
// outcomes is still visible.

// 6 decimal USDC ERC-20 view. This is the only view used for policy amounts,
// balances and transfers. The 18 decimal native view is gas only.
const USDC = (n) => BigInt(Math.round(n * 1_000_000));

// 18 decimal native view, used only for gas balance checks.
const GAS = (n) => BigInt(Math.round(n * 1_000)) * 10n ** 15n;

const DEMO = {
  // The policy the agent runs under.
  policy: {
    // Three payments of 1 USDC exhausts this exactly.
    budgetPerPeriod: USDC(3),
    periodSeconds: 3600, // one hour
    // Payment 3 asks for 2 USDC, which is clearly over this.
    maxPerTx: USDC(1),
  },

  // How much the owner deposits into the firewall for the agent to spend.
  // Covers the 3 USDC budget with margin so balance is never the binding
  // constraint, which keeps the demo about policy rather than funding.
  funding: {
    agentDeposit: USDC(5),
  },

  // The scripted payment amounts.
  payments: {
    first: USDC(1), // payment 1, passes
    overCap: USDC(2), // payment 3, over the 1 USDC per-tx cap
    topUp: USDC(1), // payment 4, repeated until the budget is gone
    postRevoke: USDC(0.5), // payment 5, after revocation
  },

  // Dedicated demo merchants.
  //
  // Previously these defaulted to accounts derived from the public hardhat
  // mnemonic, which anyone on a public testnet can also use. That made
  // merchant balances read slightly high, because other people's funds landed
  // in the same address, and the allowlisted merchant no longer showed exactly
  // what this demo had paid it.
  //
  // These are derived deterministically from a NivGuard specific string:
  //   address = last 20 bytes of keccak256("nivguard.demo.merchant.<role>")
  //
  // Nobody holds a key for either, which is fine and in fact the point:
  // merchants only ever receive, they never sign anything. Balances now read
  // exactly what the firewall sent.
  //
  // Override with MERCHANT_ALLOWED and MERCHANT_BLOCKED for real vendors.
  merchants: {
    allowed: "0x2f572D8771Af409Fce73970898974F7d94787386",
    blocked: "0x3994a61B70C84F18294316764ABFB73588C8763F",
  },

  // The nanopayments demo, run against Circle Gateway on Arc.
  //
  // Sized much smaller than the merchant demo, because the point here is the
  // ratio rather than the amounts: one gated onchain top up funds thousands of
  // ungated offchain payments. Two top ups fit the budget, the third does not.
  nano: {
    policy: {
      // Two top ups of 0.2 fit. A third would need 0.6, so it is blocked.
      budgetPerPeriod: USDC(0.5),
      periodSeconds: 3600,
      maxPerTx: USDC(0.2),
    },
    // What the owner puts behind the agent. Comfortably over the budget so
    // the binding constraint is always policy, never funding.
    funding: {
      agentDeposit: USDC(1),
    },
    // One top up, repeated until the period budget refuses another.
    topUp: USDC(0.2),
    // Native USDC (18 decimal gas view) sent to the agent so it can pay gas
    // for its own fundGateway calls. Nanopayments themselves cost no gas.
    agentGas: GAS(0.02),
  },

  // Minimum balances preflight insists on before letting the demo run.
  minimums: {
    // Native gas, 18 decimal view. Enough for a handful of transactions.
    ownerGas: GAS(0.05),
    agentGas: GAS(0.05),
    // ERC-20 USDC the owner needs on hand to fund the deposit.
    ownerUsdc: USDC(5),
  },
};

// Sanity checks, so an edit that breaks the demo shape fails loudly here
// rather than halfway through a recording.
function assertCoherent(d = DEMO) {
  const errs = [];
  if (d.policy.maxPerTx > d.policy.budgetPerPeriod) {
    errs.push("maxPerTx must not exceed budgetPerPeriod, the contract rejects it");
  }
  if (d.payments.overCap <= d.policy.maxPerTx) {
    errs.push("payments.overCap must exceed policy.maxPerTx or payment 3 will pass");
  }
  if (d.payments.first > d.policy.maxPerTx) {
    errs.push("payments.first must be within policy.maxPerTx or payment 1 will fail");
  }
  if (d.payments.topUp > d.policy.maxPerTx) {
    errs.push("payments.topUp must be within policy.maxPerTx");
  }
  if (d.funding.agentDeposit < d.policy.budgetPerPeriod) {
    errs.push("funding.agentDeposit should cover budgetPerPeriod so balance is not the limit");
  }
  if (errs.length) {
    throw new Error(`agent/demoConfig.js is incoherent:\n  ${errs.join("\n  ")}`);
  }
  return true;
}

module.exports = { DEMO, USDC, GAS, assertCoherent };
