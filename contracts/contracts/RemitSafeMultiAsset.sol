// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RemitSafeMultiAsset {
    enum AssetType {
        Native,
        ERC20
    }

    enum PledgeStatus {
        Created,
        Funded,
        Released,
        Cancelled
    }

    struct Pledge {
        address sender;
        address merchant;
        address asset;
        AssetType assetType;
        uint256 totalAmount;
        uint256 depositedAmount;
        PledgeStatus status;
    }

    uint256 public nextPledgeId;
    mapping(uint256 => Pledge) public pledges;

    event PledgeCreated(uint256 indexed pledgeId, address indexed sender, address indexed merchant, address asset, uint256 totalAmount);
    event PledgeFunded(uint256 indexed pledgeId, uint256 depositedAmount);
    event PledgeReleased(uint256 indexed pledgeId, address indexed merchant, uint256 amount);

    function createEthPledge(address merchant, uint256 totalAmount) external payable returns (uint256 pledgeId) {
        require(merchant != address(0), "Invalid merchant");
        require(totalAmount > 0, "Invalid total");
        require(msg.value > 0 && msg.value <= totalAmount, "Invalid deposit");

        pledgeId = _createPledge(merchant, address(0), AssetType.Native, totalAmount, msg.value);
    }

    function createTokenPledge(address merchant, address token, uint256 totalAmount, uint256 initialDeposit) external returns (uint256 pledgeId) {
        require(merchant != address(0), "Invalid merchant");
        require(token != address(0), "Invalid token");
        require(totalAmount > 0, "Invalid total");
        require(initialDeposit > 0 && initialDeposit <= totalAmount, "Invalid deposit");

        IERC20(token).transferFrom(msg.sender, address(this), initialDeposit);
        pledgeId = _createPledge(merchant, token, AssetType.ERC20, totalAmount, initialDeposit);
    }

    function completeEthPledge(uint256 pledgeId) external payable {
        Pledge storage pledge = pledges[pledgeId];
        require(pledge.sender == msg.sender, "Only sender");
        require(pledge.assetType == AssetType.Native, "Not ETH");
        require(pledge.status == PledgeStatus.Created, "Closed");
        require(pledge.depositedAmount + msg.value == pledge.totalAmount, "Wrong amount");

        pledge.depositedAmount += msg.value;
        pledge.status = PledgeStatus.Funded;
        emit PledgeFunded(pledgeId, pledge.depositedAmount);
    }

    function completeTokenPledge(uint256 pledgeId, uint256 amount) external {
        Pledge storage pledge = pledges[pledgeId];
        require(pledge.sender == msg.sender, "Only sender");
        require(pledge.assetType == AssetType.ERC20, "Not token");
        require(pledge.status == PledgeStatus.Created, "Closed");
        require(pledge.depositedAmount + amount == pledge.totalAmount, "Wrong amount");

        IERC20(pledge.asset).transferFrom(msg.sender, address(this), amount);
        pledge.depositedAmount += amount;
        pledge.status = PledgeStatus.Funded;
        emit PledgeFunded(pledgeId, pledge.depositedAmount);
    }

    function release(uint256 pledgeId) external {
        Pledge storage pledge = pledges[pledgeId];
        require(msg.sender == pledge.merchant, "Only merchant");
        require(pledge.status == PledgeStatus.Funded, "Not funded");

        pledge.status = PledgeStatus.Released;

        if (pledge.assetType == AssetType.Native) {
            payable(pledge.merchant).transfer(pledge.totalAmount);
        } else {
            IERC20(pledge.asset).transfer(pledge.merchant, pledge.totalAmount);
        }

        emit PledgeReleased(pledgeId, pledge.merchant, pledge.totalAmount);
    }

    function _createPledge(
        address merchant,
        address asset,
        AssetType assetType,
        uint256 totalAmount,
        uint256 depositedAmount
    ) private returns (uint256 pledgeId) {
        pledgeId = nextPledgeId++;
        pledges[pledgeId] = Pledge({
            sender: msg.sender,
            merchant: merchant,
            asset: asset,
            assetType: assetType,
            totalAmount: totalAmount,
            depositedAmount: depositedAmount,
            status: depositedAmount == totalAmount ? PledgeStatus.Funded : PledgeStatus.Created
        });

        emit PledgeCreated(pledgeId, msg.sender, merchant, asset, totalAmount);
        if (depositedAmount == totalAmount) {
            emit PledgeFunded(pledgeId, depositedAmount);
        }
    }
}
