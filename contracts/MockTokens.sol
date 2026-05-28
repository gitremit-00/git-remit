// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint256 public constant MAX_FAUCET = 100_000 * 10 ** 6;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }

    function faucet(address to, uint256 amount) external {
        require(amount <= MAX_FAUCET, "Faucet: amount too large");
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract MockUSDC is MockERC20 {
    constructor() MockERC20("Mock USDC", "USDC") {}
}

contract MockUSDT is MockERC20 {
    constructor() MockERC20("Mock USDT", "USDT") {}
}
