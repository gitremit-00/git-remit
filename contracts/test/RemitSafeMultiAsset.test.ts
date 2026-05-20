import { expect } from "chai";
import { ethers } from "hardhat";

describe("RemitSafeMultiAsset", function () {
  it("creates and releases an ETH pledge", async function () {
    const [sender, merchant] = await ethers.getSigners();
    const RemitSafe = await ethers.getContractFactory("RemitSafeMultiAsset");
    const remitsafe = await RemitSafe.deploy();

    const totalAmount = ethers.parseEther("1");
    await remitsafe.connect(sender).createEthPledge(merchant.address, totalAmount, {
      value: ethers.parseEther("0.4")
    });

    await remitsafe.connect(sender).completeEthPledge(0, {
      value: ethers.parseEther("0.6")
    });

    await expect(remitsafe.connect(merchant).release(0)).to.changeEtherBalance(
      merchant,
      totalAmount
    );
  });
});
