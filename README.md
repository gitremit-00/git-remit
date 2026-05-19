# RemitSafe

> Turning remittance promises into cryptographic commitments.

A blockchain-backed OFW payment pledge system built on **Morph L2**. RemitSafe lets overseas workers lock partial funds into escrow now and commit to a future deposit date — giving merchants verifiable, on-chain proof of payment before the full amount arrives.

**Hackathon:** Build In! Payments — Morph x Blockchain4Youth x DVCode  
**Track:** Cross-Border Remittance  
**Build Period:** May 18–29, 2026  
**Blockchain:** Morph L2 (EVM-compatible, Holesky Testnet)

---

## The Problem

OFW payday rarely aligns with Philippine bill due dates. Tuition, rent, and medical bills don't wait. Traditional remittance apps are transactional — you either send now or you don't. There's no way to make a verifiable future payment promise, no commitment layer, and no credit history for OFWs despite consistent foreign income.

## The Solution

RemitSafe introduces **Payment Pledges** — smart contract-enforced commitments that:

- Lock partial funds into escrow immediately
- Record a cryptographic commitment for the remaining balance on a future date
- Give merchants on-chain proof they can act on — no wire transfer waiting required
- Auto-release the full amount when the sender deposits the remainder
- Build an on-chain reputation score that follows the sender's wallet permanently

---

## How It Works

```
Juan has 50 USDC. Tuition = 150 USDC. Payday = June 5.

1. Juan locks 50 USDC into escrow → sets commitment date: June 5
2. School sees pledge on-chain → enrolls Juan's child immediately
3. June 5: Juan deposits 100 USDC → contract auto-releases 148.5 USDC to school (1% protocol fee deducted)
4. If Juan misses deadline → 3-day grace period begins
5. After grace period → merchant calls claimPartial() → receives full deposit (no fee on default)
6. If merchant never claims (180 days) → Juan calls reclaimDeposit() → deposit returned, default recorded on reputation
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Solidity 0.8.x, OpenZeppelin |
| Blockchain | Morph L2 (Holesky Testnet) |
| Blockchain Tooling | Hardhat, ethers.js v6 |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS v3 |
| Backend | Next.js API Routes (`/app/api/`) |
| Database | PostgreSQL via Supabase |
| Wallet | MetaMask |
| Hosting | Vercel |

---

## Smart Contract — `RemittancePledge.sol`

### Core Functions

| Function | Description |
|---|---|
| `createPledge()` | Lock partial USDC, set merchant wallet, total amount, and commitment deadline |
| `depositRemaining(pledgeId, amount)` | Deposit remaining balance — auto-triggers release when full amount is reached |
| `claimPartial(pledgeId)` | Merchant claims locked deposit after grace period ends (no expiry) |
| `reclaimDeposit(pledgeId)` | Sender recovers deposit if merchant never claimed after 180 days — records a default |
| `extendDeadline(pledgeId, newDate, merchantSig)` | Extend deadline up to 30 days with merchant's off-chain signature approval |
| `cancelPledge(pledgeId, merchantSig)` | Cancel pledge by mutual agreement — sender gets full deposit back, no reputation impact |
| `getReputation(wallet)` | Returns sender's weighted trust score (0–10000 basis points), counts, and history |
| `getRequiredDepositPct(wallet)` | Returns the minimum upfront deposit % required based on sender's trust score |
| `getMaxActivePledges(wallet)` | Returns how many concurrent active pledges this sender is allowed |
| `getPledge(pledgeId)` | Returns full pledge details — status, amounts, dates, parties |
| `getSenderPledges(wallet)` | Returns all pledge IDs created by a sender |
| `getMerchantPledges(wallet)` | Returns all pledge IDs for a merchant |

### Pledge States

| State | Description |
|---|---|
| `PENDING` | Partial funds locked, awaiting remaining deposit |
| `COMPLETED` | Full amount deposited and released to merchant |
| `DEFAULTED` | Sender missed deadline — deposit claimed by merchant or reclaimed by sender after 180 days |
| `CANCELLED` | Pledge cancelled by mutual agreement — deposit returned to sender |

### On-Chain Constants

```solidity
uint256 public constant GRACE_PERIOD      = 3 days;    // window after deadline for late payment
uint256 public constant MAX_PLEDGE_DAYS   = 90 days;   // max commitment date from now
uint256 public constant MAX_EXTENSION     = 30 days;   // max deadline extension per request
uint256 public constant UNCLAIMED_TIMEOUT = 180 days;  // sender can reclaim if merchant never claims
uint256 public constant FEE_BPS           = 100;       // 1% protocol fee on completed pledges
```

---

## Reputation Score

Every sender wallet has a public on-chain **weighted trust score** (0–10000 basis points):

```
Score = sum(pledgeAmount × weight) / sum(pledgeAmount)

Weights:
  On-time payment  → 10000 (100%)
  Late payment     →  7000 (70%)
  Default          →     0 (0%)
```

Larger pledges carry more weight — a single large default outweighs many small on-time payments. The score is used to determine deposit requirements and active pledge limits.

### Deposit Tiers

| Trust Score | Required Upfront Deposit |
|---|---|
| No history | 20% |
| ≥ 80% | 20% |
| ≥ 50% | 30% |
| ≥ 20% | 40% |
| < 20% | 50% |

### Active Pledge Cap

| Trust Score | Max Concurrent Pledges |
|---|---|
| No history | 2 |
| ≥ 50% | 3 |
| ≥ 80% | 5 |

---

## Project Structure

```
remit-safe/
├── contracts/
│   ├── RemittancePledge.sol   # Core escrow and pledge logic
│   └── MockUSDC.sol           # ERC20 token for testnet simulation
├── test/
│   └── RemittancePledge.test.js
├── scripts/
│   ├── deploy.js
│   ├── deployMockUSDC.js
│   ├── simulate.js            # Automated 4-scenario simulation
│   ├── simulate-tiers.js      # Deposit tier progression demo
│   ├── simulate-interactive.js # Menu-driven manual simulation
│   └── GUIDE.md
├── app/
│   ├── sender/
│   │   └── page.tsx           # OFW sender dashboard
│   ├── merchant/
│   │   └── page.tsx           # Merchant dashboard
│   └── api/
│       ├── pledge/
│       │   ├── create/route.ts
│       │   └── [id]/route.ts
│       └── user/route.ts
├── hardhat.config.js
└── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MetaMask browser extension
- Morph Holesky testnet added to MetaMask

### Installation

```bash
git clone https://github.com/your-org/remit-safe
cd remit-safe
npm install
```

### Environment Variables

```bash
cp .env.example .env
```

```env
MORPH_HOLESKY_RPC_URL=https://rpc-holesky.morphl2.io
DEPLOYER_PRIVATE_KEY=your_deployer_private_key
NEXT_PUBLIC_CONTRACT_ADDRESS=deployed_contract_address
NEXT_PUBLIC_USDC_ADDRESS=deployed_usdc_address
DATABASE_URL=your_supabase_postgresql_url
```

### Run Tests

```bash
npx hardhat test
```

Expected output: `57 passing`

### Run Simulation Scripts

No separate node needed — runs on an in-memory chain:

```bash
npx hardhat run scripts/simulate.js --network hardhat
npx hardhat run scripts/simulate-tiers.js --network hardhat
```

For the interactive simulator, start a local node first:

```bash
# Terminal 1 — keep open
npx hardhat node

# Terminal 2
npx hardhat run scripts/simulate-interactive.js --network localhost
```

### Deploy to Morph Holesky Testnet

```bash
npm run deploy:mockusdc   # deploy MockUSDC first
npm run deploy            # deploy RemittancePledge
```

Verify the deployed contract at [explorer-holesky.morphl2.io](https://explorer-holesky.morphl2.io).

### Run the Frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## On-Chain vs Off-Chain Data

| Data | Location | Reason |
|---|---|---|
| USDC escrow & release | On-chain (Morph) | Trustless, immutable |
| Pledge amounts & dates | On-chain (Morph) | Core commitment — tamper-proof |
| Wallet addresses | On-chain (Morph) | Public identifiers for parties |
| Reputation score | On-chain (Morph) | Must be publicly verifiable |
| Transaction audit log | On-chain (Morph) | Permanent record for both parties |
| User profiles (name, phone) | PostgreSQL | Private PII — off-chain for privacy |
| Pledge metadata / notes | PostgreSQL | Non-financial, searchable data |
| Notification logs | PostgreSQL | Operational data, not financial |

---

## Security

Key mitigations implemented in `RemittancePledge.sol`:

- **Auto-release via contract only** — no backend involvement in fund transfers
- **ReentrancyGuard** on all token-transferring functions (OpenZeppelin)
- **Trust-based minimum deposit** — 20%–50% upfront depending on sender reputation
- **Commitment deadline cap** — `require(commitmentDate <= block.timestamp + 90 days)`
- **Weighted reputation score** — amount-weighted, prevents score manipulation via small pledges
- **Merchant signature required** — deadline extensions and cancellations need merchant approval
- **On-chain grace period constant** — not dependent on off-chain state
- **USDC address as constructor parameter** — no hardcoded token addresses
- **Active pledge cap** — limits concurrent exposure per trust tier

---

## Future Roadmap

- Mobile app (React Native)
- GCash and Maya merchant wallet integration
- Morph mainnet deployment with real USDC
- On-chain credit scoring API for Philippine banks and cooperatives
- Partnership with Philippine remittance centers
- OpenZeppelin `Pausable` for emergency contract pause

---

## License

MIT
