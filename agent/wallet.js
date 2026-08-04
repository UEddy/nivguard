"use strict";

// Owner-side signing.
//
// The owner is the business operator: it deploys the firewall, sets policy,
// funds agents and pulls the kill switch. It signs with a real key.
//
// This replaces the earlier provider.getSigner(address) call, which asked the
// node to sign with an unlocked account. That only works on a local hardhat
// node. Arc has no unlocked accounts, so the revoke step in the demo could
// never have worked there.

const { ethers } = require("ethers");

// The public hardhat test mnemonic. Not a secret, it is in hardhat's own
// documentation, and it only ever controls throwaway local chain accounts.
// Used so the local demo stays zero-config while still going through a real
// Wallet signer, the same code path Arc uses.
const HARDHAT_TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

function normalisePrivateKey(raw) {
  const key = String(raw).trim();
  return key.startsWith("0x") ? key : `0x${key}`;
}

/// Derive the local hardhat account at the given index from the public test
/// mnemonic. Index 0 is the account hardhat lists first.
function localAccount(index = 0) {
  return ethers.HDNodeWallet.fromPhrase(
    HARDHAT_TEST_MNEMONIC,
    undefined,
    `m/44'/60'/0'/0/${index}`
  );
}

/// Build the owner signer for a network.
///
/// Rather than assume one source is the owner, gather every key we could sign
/// with and pick the one that actually matches the firewall's owner. That
/// matters on localhost: a developer with a real PRIVATE_KEY in .env for Arc
/// should still be able to run the local demo, whose owner is a hardhat
/// account. On Arc the only candidate is PRIVATE_KEY, so this stays strict.
///
/// Only addresses are ever logged. The key itself is never printed.
function getOwnerSigner({ provider, networkName, expectedOwner }) {
  const candidates = [];

  const raw = process.env.PRIVATE_KEY;
  if (raw && String(raw).trim()) {
    try {
      candidates.push({
        wallet: new ethers.Wallet(normalisePrivateKey(raw), provider),
        source: "PRIVATE_KEY",
      });
    } catch {
      throw new Error("PRIVATE_KEY is set but is not a valid private key.");
    }
  }

  if (networkName === "localhost") {
    for (let i = 0; i < 5; i++) {
      candidates.push({
        wallet: localAccount(i).connect(provider),
        source: `hardhat test account ${i}`,
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `PRIVATE_KEY is not set, and network "${networkName}" has no unlocked ` +
        `accounts to fall back on.\nSet PRIVATE_KEY in .env to the owner key.`
    );
  }

  if (!expectedOwner) {
    const first = candidates[0];
    return Object.assign(first.wallet, { sourceLabel: first.source });
  }

  const want = String(expectedOwner).toLowerCase();
  const match = candidates.find((c) => c.wallet.address.toLowerCase() === want);

  if (!match) {
    const tried = candidates
      .map((c) => `    ${c.wallet.address}  (${c.source})`)
      .join("\n");
    throw new Error(
      `No available key owns this firewall.\n` +
        `  owner    ${expectedOwner}\n` +
        `  tried:\n${tried}\n` +
        `Only the owner can change policy or revoke an agent.`
    );
  }

  return Object.assign(match.wallet, { sourceLabel: match.source });
}

module.exports = {
  getOwnerSigner,
  localAccount,
  HARDHAT_TEST_MNEMONIC,
};
