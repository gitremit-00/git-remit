const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying RemittancePledge with account:", deployer.address);

  const deploymentsPath = path.join(__dirname, "../deployments/holesky.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath));

  if (!deployments.mockUSDC) {
    throw new Error("MockUSDC address not found — run deployMockTokens.js first");
  }
  if (!deployments.mockUSDT) {
    throw new Error("MockUSDT address not found — run deployMockTokens.js first");
  }

  console.log("Using MockUSDC at:", deployments.mockUSDC);
  console.log("Using MockUSDT at:", deployments.mockUSDT);
  console.log("Deploying RemittancePledge...");

  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  console.log("Fee recipient:", feeRecipient);

  const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
  const contract = await RemittancePledge.deploy(
    [deployments.mockUSDC, deployments.mockUSDT],
    feeRecipient
  );
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("RemittancePledge deployed to:", address);

  deployments.remittancePledge = address;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));

  // Export ABI for M2 and M3
  const artifact = await artifacts.readArtifact("RemittancePledge");
  fs.writeFileSync(
    path.join(__dirname, "../deployments/RemittancePledge.abi.json"),
    JSON.stringify(artifact.abi, null, 2)
  );

  console.log("ABI exported to deployments/RemittancePledge.abi.json");
  console.log("Share the deployments/ folder with M2 and M3");
  console.log("Verify on: https://explorer-holesky.morphl2.io/address/" + address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
