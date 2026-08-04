"use strict";

// Signer factory. The runner is deliberately signer agnostic: the agent's
// decision loop is identical whichever backend signs, so the local demo
// exercises the same code path that runs against Arc.

const { LocalSigner } = require("./localSigner");
const { CircleSigner } = require("./circleSigner");

/// Pick a signing backend.
///   arcTestnet -> Circle developer-controlled wallet (real custody)
///   localhost  -> unlocked hardhat account (demo only, Circle cannot
///                 reach a local node)
async function makeSigner({ network, provider, localAddress }) {
  if (network.name === "localhost") {
    if (!localAddress) {
      throw new Error("localAddress is required for the local signer");
    }
    return LocalSigner.create(provider, localAddress);
  }
  return CircleSigner.create();
}

module.exports = { makeSigner, LocalSigner, CircleSigner };
