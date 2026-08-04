require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Arc testnet, sourced from the Circle use-arc skill and docs.arc.io.
// Chain id 5042002, native gas token is USDC.
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_TESTNET_RPC_URL =
  process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";

const privateKey = (process.env.PRIVATE_KEY || "").trim();
const accounts = privateKey
  ? [privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`]
  : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // Arc is EVM equivalent. Cancun is safe here.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    arcTestnet: {
      url: ARC_TESTNET_RPC_URL,
      chainId: ARC_TESTNET_CHAIN_ID,
      accounts,
      // Arc has sub second deterministic finality, so one confirmation is final.
      // Keep this at 1 so scripts never sit waiting on extra blocks.
      confirmations: 1,
    },
  },
  etherscan: {
    apiKey: {
      arcTestnet: "no-api-key-required",
    },
    customChains: [
      {
        network: "arcTestnet",
        chainId: ARC_TESTNET_CHAIN_ID,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  mocha: {
    timeout: 60000,
  },
};
