const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MockUSDC with account:", deployer.address);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const address = await usdc.getAddress();
  console.log("MockUSDC deployed to:", address);

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  fs.writeFileSync(
    path.join(deploymentsDir, "holesky.json"),
    JSON.stringify({ mockUSDC: address }, null, 2)
  );

  console.log("Address saved to deployments/holesky.json");
  console.log("Verify on: https://explorer-holesky.morphl2.io/address/" + address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
