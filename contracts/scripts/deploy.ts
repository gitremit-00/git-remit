import { ethers } from "hardhat";

async function main() {
  const RemitSafe = await ethers.getContractFactory("RemitSafeMultiAsset");
  const remitsafe = await RemitSafe.deploy();
  await remitsafe.waitForDeployment();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await MockUSDT.deploy();
  await usdt.waitForDeployment();

  console.log("RemitSafeMultiAsset:", await remitsafe.getAddress());
  console.log("MockUSDC:", await usdc.getAddress());
  console.log("MockUSDT:", await usdt.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
