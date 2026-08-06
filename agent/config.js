"use strict";

// Shared configuration for the NivGuard agent runner.
// Chain values come from the Circle use-arc skill and docs.arc.io.

require("dotenv").config();

const fs = require("fs");
const path = require("path");

// Arc testnet. USDC is the native gas token at 18 decimals, but the ERC-20
// interface used for transfers and every policy amount is 6 decimals.
const ARC_TESTNET = {
  name: "arcTestnet",
  chainId: 5042002,
  rpcUrl: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  usdc: "0x3600000000000000000000000000000000000000",
  // Circle wallet blockchain enum for Arc testnet.
  circleBlockchain: "ARC-TESTNET",
};

const LOCALHOST = {
  name: "localhost",
  chainId: 31337,
  rpcUrl: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
  explorer: null,
  usdc: null, // deployed by setupLocal.js
  circleBlockchain: null, // Circle cannot reach a local node
};

const NETWORKS = { arcTestnet: ARC_TESTNET, localhost: LOCALHOST };

function getNetwork(name) {
  const key = name || process.env.NIVGUARD_NETWORK || "localhost";
  const net = NETWORKS[key];
  if (!net) {
    throw new Error(
      `Unknown network "${key}". Use one of: ${Object.keys(NETWORKS).join(", ")}`
    );
  }
  return net;
}

// USDC ERC-20 interface decimals. Never 18 here. The 18 decimal native view
// is only ever used for gas, and this runner never does gas math.
const USDC_DECIMALS = 6;

// Mirrors the reason codes in SpendFirewall.sol. Kept in the same order.
const REASON_CODES = {
  0: { key: "OK", text: "allowed by policy" },
  1: { key: "NOT_REGISTERED", text: "agent is not registered" },
  2: { key: "REVOKED", text: "agent has been revoked by the owner" },
  3: { key: "MERCHANT_NOT_ALLOWED", text: "merchant is not on the allowlist" },
  4: { key: "OVER_MAX_PER_TX", text: "amount is over the per transaction cap" },
  5: { key: "OVER_PERIOD_BUDGET", text: "amount would exceed the period budget" },
  6: { key: "INSUFFICIENT_BALANCE", text: "agent balance is too low" },
  7: { key: "ZERO_AMOUNT", text: "amount is zero" },
};

function describeReason(code) {
  const n = Number(code);
  return REASON_CODES[n] || { key: `UNKNOWN_${n}`, text: "unrecognised reason code" };
}

// Human text for each custom error the contract can revert with. Used when a
// real submission reverts, so the log says why rather than dumping hex.
const ERROR_TEXT = {
  AgentNotRegistered: () => "agent is not registered",
  AgentIsRevoked: () => "agent has been revoked by the owner",
  MerchantNotAllowed: (a) => `merchant ${a[1]} is not on the allowlist`,
  ExceedsMaxPerTx: (a) =>
    `amount ${fmt(a[0])} USDC is over the per transaction cap of ${fmt(a[1])} USDC`,
  ExceedsPeriodBudget: (a) =>
    `amount ${fmt(a[0])} USDC exceeds the ${fmt(a[1])} USDC left in this period`,
  InsufficientAgentBalance: (a) =>
    `amount ${fmt(a[0])} USDC is more than the ${fmt(a[1])} USDC the agent holds`,
  ZeroAmount: () => "amount is zero",
  ZeroAddress: () => "a zero address was supplied",
  InvalidPolicy: () => "the policy is invalid",

  // Owner-side errors. These never fire on spend(), which is why they were
  // missing until an owner call reverted mid demo and printed raw hex.
  AgentAlreadyRegistered: (a) => `agent ${a[0]} is already registered`,

  // Inherited from OpenZeppelin Ownable and friends. Decoding these matters
  // just as much: "not the owner" is a five second fix once you can read it.
  OwnableUnauthorizedAccount: (a) => `${a[0]} is not the owner of this contract`,
  OwnableInvalidOwner: (a) => `${a[0]} cannot be made owner`,
  ReentrancyGuardReentrantCall: () => "reentrant call blocked",
  SafeERC20FailedOperation: (a) => `the USDC token call failed at ${a[0]}`,
};

// 6 decimal formatting, used everywhere amounts are printed.
function fmt(value) {
  const v = BigInt(value);
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = v / base;
  const frac = (v % base).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// Load the compiled artifact so the ABI can never drift from the contract.
// Every custom error is in here, which is what makes revert decoding exact.
function loadArtifact(contractName) {
  const candidates = [
    path.join(__dirname, "..", "artifacts", "contracts", `${contractName}.sol`, `${contractName}.json`),
    path.join(__dirname, "..", "artifacts", "contracts", "test", `${contractName}.sol`, `${contractName}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error(
    `Could not find the compiled artifact for ${contractName}.\n` +
      `Run "npx hardhat compile" from the repo root first.`
  );
}

// Deployment record written by agent/setupLocal.js or scripts/deploy.js.
function loadDeployment(networkName) {
  const p = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `No deployment record at deployments/${networkName}.json.\n` +
        `Run "node agent/setupLocal.js" (localhost) or "npm run deploy:arc" first.`
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

module.exports = {
  ARC_TESTNET,
  LOCALHOST,
  NETWORKS,
  getNetwork,
  USDC_DECIMALS,
  REASON_CODES,
  describeReason,
  ERROR_TEXT,
  fmt,
  loadArtifact,
  loadDeployment,
};
