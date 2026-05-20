# Smart Contract Flow

## ETH

1. Sender calls `createEthPledge(merchant, totalAmount)` with an initial `msg.value`.
2. Contract stores the pledge and holds native ETH.
3. Sender later calls `completeEthPledge(pledgeId)` with the remaining ETH.
4. Merchant calls `release(pledgeId)` after the pledge is fully funded.
5. Contract transfers native ETH to the merchant.

## USDC and USDT

1. Sender calls `approve(remitSafeAddress, initialDeposit)` on the ERC-20 token.
2. Sender calls `createTokenPledge(merchant, token, totalAmount, initialDeposit)`.
3. Contract uses `transferFrom()` to lock the initial deposit.
4. Sender later approves the remaining amount.
5. Sender calls `completeTokenPledge(pledgeId, remainingAmount)`.
6. Merchant calls `release(pledgeId)`.
7. Contract uses `transfer()` to send the full token amount to the merchant.
