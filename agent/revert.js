"use strict";

// Revert decoding. Turns a failed spend() into a sentence a human can read.
//
// Two paths reach here:
//   local  ethers already decoded the custom error, it is on err.revert
//   Circle reports FAILED without revert data, so the reason is recovered
//          by replaying the call with eth_call and decoding that

const { ethers } = require("ethers");

const { ERROR_TEXT } = require("./config");

/// Extract a decoded custom error from an ethers error, if present.
function fromEthersError(iface, err) {
  // ethers v6 decodes custom errors it finds in the ABI.
  if (err?.revert?.name) {
    return { name: err.revert.name, args: Array.from(err.revert.args ?? []) };
  }

  // Otherwise try raw revert data from wherever the provider tucked it.
  const data =
    err?.data ??
    err?.error?.data ??
    err?.info?.error?.data ??
    err?.transaction?.data;

  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        return { name: parsed.name, args: Array.from(parsed.args ?? []) };
      }
    } catch {
      // Not a custom error this ABI knows about.
    }
  }

  return null;
}

/// Replay the call read-only to recover the revert reason. Used when the
/// signing backend reports failure without revert data, which is what Circle
/// does. Costs nothing and changes no state.
async function fromStaticCall(firewall, agentAddress, merchant, amount) {
  try {
    await firewall.spend.staticCall(merchant, amount, { from: agentAddress });
    return null; // It would not revert now, so the failure was not policy.
  } catch (err) {
    return fromEthersError(firewall.interface, err);
  }
}

// What to actually do about each error. A decoded name tells you what went
// wrong; these tell you the next command. Written for someone mid recording
// who does not want to go source diving.
const ERROR_HINTS = {
  AgentNotRegistered:
    "This wallet has never been registered on this firewall.\n" +
    "Usually AGENT_WALLET_ADDRESS in .env is a freshly provisioned wallet that\n" +
    "was never set up. Run: npm run fund:agent, then npm run setup:arc.",
  AgentAlreadyRegistered:
    "This wallet is already registered. Provision a fresh agent with\n" +
    "npm run provision, or reuse the existing one instead of registering again.",
  AgentIsRevoked:
    "Revocation is permanent by design. A recorded run needs a fresh agent:\n" +
    "npm run provision, npm run fund:agent, npm run setup:arc.",
  OwnableUnauthorizedAccount:
    "PRIVATE_KEY in .env is not the owner of this contract. Check the owner\n" +
    "field in deployments/arcTestnet.json against the key you are signing with.",
  InsufficientAgentBalance:
    "The agent's balance inside the firewall is too low. Top it up with\n" +
    "npm run setup:arc, which deposits on the agent's behalf.",
  SafeERC20FailedOperation:
    "The USDC transfer itself failed, usually too little balance or allowance.\n" +
    "On Arc the gas token and the ERC-20 are the same funds, so check both.",
};

// The solidity panic codes worth naming. A bare "panic 0x11" sends you to the
// docs; "arithmetic overflow" does not.
const PANIC_TEXT = {
  "1": "assertion failed",
  "17": "arithmetic overflow or underflow",
  "18": "division or modulo by zero",
  "50": "array index out of bounds",
};

/// Decode any revert, not just a spend(). Handles custom errors, plain
/// require strings and solidity panics, so an owner-side call that reverts
/// prints something readable rather than a selector.
function decodeAnyError(iface, err) {
  const custom = fromEthersError(iface, err);
  if (custom) return { kind: "custom", ...custom };

  const data =
    err?.data ?? err?.error?.data ?? err?.info?.error?.data ?? null;

  if (typeof data === "string" && data.startsWith("0x")) {
    // Error(string), selector 0x08c379a0
    if (data.startsWith("0x08c379a0")) {
      try {
        const [msg] = ethers.AbiCoder.defaultAbiCoder().decode(
          ["string"], "0x" + data.slice(10)
        );
        return { kind: "revert-string", name: "Error", args: [msg] };
      } catch { /* fall through */ }
    }
    // Panic(uint256), selector 0x4e487b71
    if (data.startsWith("0x4e487b71")) {
      try {
        const [code] = ethers.AbiCoder.defaultAbiCoder().decode(
          ["uint256"], "0x" + data.slice(10)
        );
        return { kind: "panic", name: "Panic", args: [code] };
      } catch { /* fall through */ }
    }
    // Known selector shape but not in this ABI. Say so precisely rather than
    // pretending it decoded.
    if (data.length >= 10) {
      return { kind: "unknown", name: null, selector: data.slice(0, 10), args: [] };
    }
  }

  return null;
}

/// Work out which function was called, so the report names it. The selector
/// comes off the calldata ethers attached to the error.
function describeCall(iface, err) {
  const data = err?.transaction?.data ?? err?.info?.error?.data ?? null;
  if (typeof data !== "string" || !data.startsWith("0x") || data.length < 10) return null;
  try {
    const fn = iface.parseTransaction({ data });
    if (fn) return `${fn.name}(${fn.args.map(String).join(", ")})`;
  } catch { /* not a function on this ABI */ }
  return null;
}

/// Turn a failed contract call into printable lines: what was called, which
/// error fired, what it means, and what to do next.
function formatFailure({ iface, err, action = null }) {
  const decoded = decodeAnyError(iface, err);
  const call = action || describeCall(iface, err);
  const lines = [];

  if (call) lines.push(["call", call]);

  // ethers' Interface knows the two builtin errors, so they arrive on the
  // custom path. Render them as what they are rather than as ABI call syntax.
  if (decoded && decoded.name === "Error") {
    lines.push(["error", `revert "${decoded.args[0]}"`]);
  } else if (decoded && decoded.name === "Panic") {
    const code = BigInt(decoded.args[0]);
    lines.push(["error", `solidity panic 0x${code.toString(16)}`]);
    if (PANIC_TEXT[code.toString()]) lines.push(["meaning", PANIC_TEXT[code.toString()]]);
  } else if (decoded && decoded.name && decoded.kind === "custom") {
    const args = decoded.args.map(String).join(", ");
    lines.push(["error", `${decoded.name}(${args})`]);
    const meaning = ERROR_TEXT[decoded.name];
    if (meaning) lines.push(["meaning", meaning(decoded.args)]);
  } else if (decoded && decoded.kind === "revert-string") {
    lines.push(["error", `revert "${decoded.args[0]}"`]);
  } else if (decoded && decoded.kind === "panic") {
    lines.push(["error", `solidity panic 0x${BigInt(decoded.args[0]).toString(16)}`]);
  } else if (decoded && decoded.kind === "unknown") {
    lines.push(["error", `unrecognised revert, selector ${decoded.selector}`]);
    lines.push(["meaning", "this selector is not in the SpendFirewall ABI, so it came from another contract"]);
  } else {
    lines.push(["error", err?.shortMessage || err?.message || "unknown failure"]);
  }

  const hint = decoded?.name ? ERROR_HINTS[decoded.name] : null;
  return { decoded, lines, hint };
}

/// Render a decoded error as a readable sentence.
function explain(decoded) {
  if (!decoded) return null;
  const render = ERROR_TEXT[decoded.name];
  const detail = render ? render(decoded.args) : null;
  return detail ? `${decoded.name}: ${detail}` : decoded.name;
}

/// Full pipeline: decode from the error, fall back to a static replay.
async function describeFailure({ firewall, agentAddress, merchant, amount, err }) {
  let decoded = fromEthersError(firewall.interface, err);

  if (!decoded) {
    decoded = await fromStaticCall(firewall, agentAddress, merchant, amount);
  }

  return {
    decoded,
    text: explain(decoded) || err?.shortMessage || err?.message || "unknown failure",
  };
}

module.exports = {
  fromEthersError,
  fromStaticCall,
  explain,
  describeFailure,
  decodeAnyError,
  describeCall,
  formatFailure,
  ERROR_HINTS,
};
