const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// USDC ERC-20 interface on Arc. Six decimals. This is the optional ERC-20
// view of the native USDC balance, which is what the firewall transfers.
const ARC_USDC = "0x3600000000000000000000000000000000000000";

const LOCAL_NETWORKS = new Set(["hardhat", "localhost"]);

async function resolveUsdcAddress() {
  const fromEnv = (process.env.USDC_ADDRESS || "").trim();
  if (fromEnv) {
    if (!ethers.isAddress(fromEnv)) {
      throw new Error(`USDC_ADDRESS is not a valid address: ${fromEnv}`);
    }
    return { address: fromEnv, mock: false };
  }

  if (LOCAL_NETWORKS.has(network.name)) {
    console.log("No USDC_ADDRESS set on a local network, deploying MockUSDC.");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mock = await MockUSDC.deploy();
    await mock.waitForDeployment();
    return { address: await mock.getAddress(), mock: true };
  }

  return { address: ARC_USDC, mock: false };
}

async function main() {
  const [deployer] = await ethers.getSigners();

  if (!deployer) {
    throw new Error(
      `No deployer account is configured for network "${network.name}".\n` +
        `Set PRIVATE_KEY in .env to a funded key, then retry.\n` +
        (network.name === "arcTestnet"
          ? `Fund it with testnet USDC first: https://faucet.circle.com\n` +
            `On Arc, USDC is the gas token, so the deployer needs USDC to pay gas.`
          : "")
    );
  }

  const owner = (process.env.FIREWALL_OWNER || "").trim() || deployer.address;

  if (!ethers.isAddress(owner)) {
    throw new Error(`FIREWALL_OWNER is not a valid address: ${owner}`);
  }

  console.log(`Network:  ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Owner:    ${owner}`);

  const { address: usdcAddress, mock } = await resolveUsdcAddress();
  console.log(`USDC:     ${usdcAddress}${mock ? " (mock)" : ""}`);

  const SpendFirewall = await ethers.getContractFactory("SpendFirewall");
  const firewall = await SpendFirewall.deploy(usdcAddress, owner);

  // Arc has sub second deterministic finality, so the first confirmation is
  // final. There is no reason to wait on extra blocks here.
  await firewall.waitForDeployment();

  const address = await firewall.getAddress();
  const tx = firewall.deploymentTransaction();

  console.log("");
  console.log(`SpendFirewall deployed to ${address}`);
  console.log(`Deploy tx: ${tx ? tx.hash : "unknown"}`);

  if (network.name === "arcTestnet") {
    console.log(`Explorer:  https://testnet.arcscan.app/address/${address}`);
  }

  writeDeploymentRecord({
    network: network.name,
    chainId: Number(network.config.chainId),
    spendFirewall: address,
    usdc: usdcAddress,
    usdcIsMock: mock,
    owner,
    deployer: deployer.address,
    deployTx: tx ? tx.hash : null,
    timestamp: new Date().toISOString(),
  });
}

function writeDeploymentRecord(record) {
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${record.network}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`Recorded deployment in deployments/${record.network}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
