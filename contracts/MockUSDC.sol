// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
    
    /// @notice Maximum tokens mintable per faucet() call — keeps test numbers sane.
    uint256 public constant MAX_FAUCET = 100_000 * 10 ** 6; // 100k USDC

    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 10 ** 6); // 1M USDC to deployer
    }

    /// @notice Mint free test USDC — callable by anyone on testnet.
    /// @param to Recipient of the minted test tokens
    /// @param amount Amount to mint (capped at MAX_FAUCET)
    function faucet(address to, uint256 amount) external {
        require(amount <= MAX_FAUCET, "Faucet: amount too large");
        _mint(to, amount);
    }

    /// @dev USDC uses 6 decimals, unlike the ERC20 default of 18. Pure — reads no state.
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
