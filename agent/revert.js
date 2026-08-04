"use strict";

// Revert decoding. Turns a failed spend() into a sentence a human can read.
//
// Two paths reach here:
//   local  ethers already decoded the custom error, it is on err.revert
//   Circle reports FAILED without revert data, so the reason is recovered
//          by replaying the call with eth_call and decoding that

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

module.exports = { fromEthersError, fromStaticCall, explain, describeFailure };
