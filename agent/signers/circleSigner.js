"use strict";

// Circle Developer-Controlled Wallets signing backend.
//
// This is the real custody path. The agent holds its own custodial wallet at
// Circle. There is no private key anywhere in this repo. The agent asks Circle
// to execute spend() and Circle signs and broadcasts it.
//
// SDK shapes follow the Circle use-developer-controlled-wallets skill:
//   initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })
//   createContractExecutionTransaction({ walletId, contractAddress,
//     abiFunctionSignature, abiParameters, fee })
//   getTransaction({ id })

const {
  initiateDeveloperControlledWalletsClient,
} = require("@circle-fin/developer-controlled-wallets");

// Circle processes transactions asynchronously. These are the states a
// transaction can settle into, from the Circle transaction state docs.
const TERMINAL_SUCCESS = new Set(["CONFIRMED", "COMPLETE", "COMPLETED"]);
const TERMINAL_FAILURE = new Set(["FAILED", "DENIED", "CANCELLED"]);

function makeClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  // The skill uses ENTITY_SECRET, the Circle docs use CIRCLE_ENTITY_SECRET.
  // Accept either so the runner works with whichever the developer set.
  const entitySecret =
    process.env.CIRCLE_ENTITY_SECRET || process.env.ENTITY_SECRET;

  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not set. See agent/README.md.");
  }
  if (!entitySecret) {
    throw new Error(
      "CIRCLE_ENTITY_SECRET is not set. Generate and register your entity " +
        "secret with Circle first, then store it. See agent/README.md."
    );
  }

  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

class CircleSigner {
  constructor({ walletId, address, client }) {
    this.walletId = walletId;
    this.address = address;
    this.client = client;
    this.label = "Circle developer-controlled wallet";
    this.custodial = true;
  }

  static async create() {
    const walletId = process.env.AGENT_WALLET_ID;
    const address = process.env.AGENT_WALLET_ADDRESS;

    if (!walletId || !address) {
      throw new Error(
        "AGENT_WALLET_ID and AGENT_WALLET_ADDRESS are not set. " +
          "Run: node agent/provision.js"
      );
    }

    return new CircleSigner({ walletId, address, client: makeClient() });
  }

  /// Ask Circle to execute spend(merchant, amount) and wait for it to settle.
  /// Amount is a base-unit string in the 6 decimal USDC ERC-20 view.
  async spend(firewall, merchant, amount) {
    const contractAddress = await firewall.getAddress();

    const response = await this.client.createContractExecutionTransaction({
      walletId: this.walletId,
      contractAddress,
      abiFunctionSignature: "spend(address,uint256)",
      abiParameters: [merchant, amount.toString()],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

    const transactionId = response.data?.id;
    if (!transactionId) {
      throw new Error("Circle did not return a transaction id");
    }

    return this._await(transactionId);
  }

  /// Ask Circle to execute fundGateway(agent, amount).
  ///
  /// Note the asymmetry this creates, and it is worth being clear about it:
  /// Circle can sign this transaction, because it is an ordinary onchain call.
  /// Circle cannot sign the nanopayments that follow, because those are
  /// offchain EIP-3009 authorizations and the batching SDK takes a raw private
  /// key with no custom signer hook. So the custody wallet opens the tap and a
  /// separate hot key drinks from it. See agent/gateway.js.
  async fundGateway(firewall, amount) {
    const contractAddress = await firewall.getAddress();

    const response = await this.client.createContractExecutionTransaction({
      walletId: this.walletId,
      contractAddress,
      abiFunctionSignature: "fundGateway(address,uint256)",
      abiParameters: [this.address, amount.toString()],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

    const transactionId = response.data?.id;
    if (!transactionId) {
      throw new Error("Circle did not return a transaction id");
    }

    return this._await(transactionId);
  }

  /// Poll until the transaction reaches a terminal state.
  /// Arc has sub second finality, so this settles quickly in practice.
  async _await(transactionId, { timeoutMs = 90_000, intervalMs = 1_500 } = {}) {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const res = await this.client.getTransaction({ id: transactionId });
      const tx = res.data?.transaction;
      const state = tx?.state;

      if (state && TERMINAL_SUCCESS.has(state)) {
        return { hash: tx.txHash, state, transactionId };
      }

      if (state && TERMINAL_FAILURE.has(state)) {
        const err = new Error(
          `Circle transaction ${state}` +
            (tx.errorReason ? `: ${tx.errorReason}` : "")
        );
        err.circleState = state;
        err.circleTransaction = tx;
        // The onchain revert reason is recovered by the caller with a static
        // call, since Circle reports failure without the revert data.
        err.needsStaticDecode = true;
        throw err;
      }

      if (Date.now() > deadline) {
        throw new Error(
          `Circle transaction ${transactionId} did not settle within ` +
            `${timeoutMs}ms, last state ${state || "unknown"}`
        );
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

module.exports = { CircleSigner, makeClient, TERMINAL_SUCCESS, TERMINAL_FAILURE };
