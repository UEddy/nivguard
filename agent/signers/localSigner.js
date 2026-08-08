"use strict";

// Local signing backend, used only for the hardhat demo.
//
// Circle Developer-Controlled Wallets cannot sign against a local node,
// because Circle broadcasts from its own infrastructure and has no route to
// 127.0.0.1. This backend exists so the agent logic can be demonstrated end
// to end offline. On Arc testnet the Circle backend is used instead and this
// file is not involved.
//
// This uses a hardhat node's pre-unlocked account. It is not a stored private
// key, and it is demo scaffolding, not the production custody path.

const { ethers } = require("ethers");

class LocalSigner {
  constructor(provider, address) {
    this.provider = provider;
    this.address = ethers.getAddress(address);
    this.label = "local hardhat account";
    this.custodial = false;
  }

  static async create(provider, address) {
    const signer = new LocalSigner(provider, address);
    signer._signer = await provider.getSigner(address);
    return signer;
  }

  /// Submit spend(merchant, amount). Resolves with the tx hash on success.
  /// Throws the underlying ethers error on revert so the caller can decode it.
  async spend(firewall, merchant, amount) {
    const contract = firewall.connect(this._signer);
    const tx = await contract.spend(merchant, amount);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }

  /// Submit fundGateway(agent, amount), the nanopayment top up path.
  /// Same contract, same policy, different destination.
  async fundGateway(firewall, amount) {
    const contract = firewall.connect(this._signer);
    const tx = await contract.fundGateway(this.address, amount);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
}

module.exports = { LocalSigner };
