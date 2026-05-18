# GitRemit — Local Testing & Deployment Guide

---

## Prerequisites

Make sure the following are installed before running anything:

- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node.js)

Then install project dependencies:

```bash
npm install
```

---

## Environment Setup

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set:

```env
PRIVATE_KEY=your_throwaway_wallet_private_key_here
MORPH_RPC=https://rpc-quicknode-holesky.morphl2.io
```

> **WARNING:** Never use your main wallet private key. Use a throwaway wallet only.
> Never commit `.env` to GitHub — it is already listed in `.gitignore`.

---

## Local Testing

### 1. Run Unit Tests

Runs all 35 unit tests against an in-memory Hardhat network. No node needed.

```bash
npx hardhat test
```

Expected output: `35 passing`

---

### 2. Start a Local Hardhat Node

Required before running any simulation script. Keep this terminal open.

```bash
npx hardhat node
```

This starts a local blockchain at `http://127.0.0.1:8545` with pre-funded test accounts.

> If you see `Error: listen EADDRINUSE`, a node is already running — skip this step.

---

### 3. Automated Simulation (4 Scenarios)

Runs four scripted scenarios end-to-end: happy path, default, late payment, and reputation tracking. No input required.

```bash
npx hardhat run scripts/simulate.js --network localhost
```

**What it covers:**

| Scenario | Description                                                        |
| -------- | ------------------------------------------------------------------ |
| 1        | Full payment on time — funds auto-released to merchant             |
| 2        | Sender defaults — merchant claims deposit after grace period       |
| 3        | Late payment during grace period — lower reputation weight applied |
| 4        | Reputation score shown after all scenarios                         |

---

### 4. Deposit Tier Test

Proves all four trust-based deposit tiers (20% → 30% → 40% → 50%) with blocked and allowed deposit attempts at each tier boundary.

```bash
npx hardhat run scripts/simulate-tiers.js --network localhost
```

**What it covers:**

| Tier | Trigger Condition                           | Required Upfront |
| ---- | ------------------------------------------- | ---------------- |
| 20%  | No history                                  | 20%              |
| 30%  | Score drops to 50% (1 on-time + 1 default)  | 30%              |
| 40%  | Score drops to 40% (2 on-time + 3 defaults) | 40%              |
| 50%  | Score drops to 0% (0 on-time + 1 default)   | 50%              |

Also demonstrates recovery: paying on-time rebuilds trust score and lowers the required deposit tier.

---

### 5. Interactive Simulation (Manual Testing)

A menu-driven CLI that lets you manually create pledges, send payments, skip time, and view wallet balances and trust scores — simulating the real app experience.

```bash
npx hardhat run scripts/simulate-interactive.js --network localhost
```

**Menu options:**

```text
1. Make a Payment Commitment
2. Send Remaining Balance
3. Claim Missed Payment (Receiver only)
4. View Payment Details
5. View Trust Score
6. View Wallet Balances
7. Skip Days (simulate time passing)
8. Add USDC to Wallet
0. Exit
```

**Test wallets (each starts with $500 USDC):**

| Name  | Role     |
| ----- | -------- |
| Juan  | Sender   |
| Maria | Receiver |
| Pedro | Extra    |

**Sample scenario to try:**

```text
1 → Juan → Maria → $100 total → $20 deposit → 7 days
7 → skip 8 days (past deadline + grace)
3 → claim payment #1 (Maria gets the deposit)
5 → view Juan's trust score (drops from 100% to 50%)
1 → try creating new pledge with $20 deposit → blocked (now requires 30%)
1 → try again with $30 deposit → succeeds
```

---

## Deployment to Morph Holesky Testnet

### Step 1 — Get Test ETH

You need a small amount of Morph Holesky ETH for gas fees.

1. Go to the Morph Holesky faucet and request test ETH for your throwaway wallet address
2. Confirm the balance in [Morph Explorer](https://explorer-holesky.morphl2.io)

### Step 2 — Deploy MockUSDC

```bash
npm run deploy:mockusdc
```

This deploys the fake USDC token and saves the contract address to `deployments/holesky.json`.

### Step 3 — Deploy RemittancePledge

```bash
npm run deploy
```

This reads the MockUSDC address from `deployments/holesky.json`, deploys the main contract, and exports the ABI to `deployments/RemittancePledge.abi.json`.

### Step 4 — Share with the Team

After both contracts are deployed, share the `deployments/` folder contents with M2 (backend) and M3 (frontend):

- `deployments/holesky.json` — contract addresses
- `deployments/RemittancePledge.abi.json` — ABI for calling the contract

### Step 5 — Verify on Explorer (Optional)

Check that both contracts appear on [Morph Holesky Explorer](https://explorer-holesky.morphl2.io) by searching for your deployer wallet address.

---

## Quick Reference

| Command | What it does |
| ------- | ------------ |
| `npx hardhat test` | Run all 35 unit tests |
| `npx hardhat node` | Start local blockchain |
| `npx hardhat run scripts/simulate.js --network localhost` | Automated 4-scenario test |
| `npx hardhat run scripts/simulate-tiers.js --network localhost` | Deposit tier progression test |
| `npx hardhat run scripts/simulate-interactive.js --network localhost` | Interactive manual simulation |
| `npm run deploy:mockusdc` | Deploy MockUSDC to Morph Holesky |
| `npm run deploy` | Deploy RemittancePledge to Morph Holesky |
