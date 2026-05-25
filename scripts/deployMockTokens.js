const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying mock tokens with account:", deployer.address);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const MockUSDT = await ethers.getContractFactory("MockUSDT");

  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("MockUSDC deployed to:", usdcAddress);

  const usdt = await MockUSDT.deploy();
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();
  console.log("MockUSDT deployed to:", usdtAddress);

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  fs.writeFileSync(
    path.join(deploymentsDir, "holesky.json"),
    JSON.stringify({ mockUSDC: usdcAddress, mockUSDT: usdtAddress }, null, 2)
  );

  console.log("Addresses saved to deployments/holesky.json");
  console.log("Verify MockUSDC on: https://explorer-holesky.morphl2.io/address/" + usdcAddress);
  console.log("Verify MockUSDT on: https://explorer-holesky.morphl2.io/address/" + usdtAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
