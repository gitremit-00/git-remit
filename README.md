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
3. June 5: Juan deposits 100 USDC → contract auto-releases 150 USDC to school
4. If Juan misses deadline → 3-day grace period begins
5. After grace period → merchant calls claimPartial() → receives 50 USDC
6. If merchant never claims (30 days) → Juan calls refundSender() → 50 USDC returned
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
| `depositRemaining(pledgeId)` | Deposit remaining balance — auto-triggers release when full amount is reached |
| `claimPartial(pledgeId)` | Merchant claims locked funds after grace period ends (within 30-day claim window) |
| `refundSender(pledgeId)` | Sender recovers funds after claim window expires if merchant never claimed |
| `extendDeadline(pledgeId, newDate)` | One-time deadline extension with merchant approval signature |
| `getReputation(wallet)` | Returns sender's on-chain reputation score, pledge count, and default count |
| `getPledge(pledgeId)` | Returns full pledge details — status, amounts, dates, parties |

### Pledge States

| State | Description |
|---|---|
| `PENDING` | Partial funds locked, awaiting remaining deposit |
| `COMPLETED` | Full amount deposited and released to merchant |
| `DEFAULTED` | Sender missed deadline — partial funds claimable by merchant |
| `DISPUTED` | Merchant raised a dispute during grace period |

### On-Chain Constants

```solidity
uint256 public constant GRACE_PERIOD = 3 days;
uint256 public constant CLAIM_WINDOW = 30 days;
```

---

## Reputation Score

Every sender wallet has a public on-chain reputation score readable by any wallet or application:

```
Score = (Pledges on time × 10) - (Defaults × 25) - (Late payments × 5) + Volume bonus
```

The longer a sender uses RemitSafe honestly, the more valuable their score becomes — making it increasingly costly to abandon a wallet and start fresh.

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
│   └── deploy.js
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

### Run Tests (Local Hardhat Network)

```bash
npx hardhat test
```

### Deploy to Morph Holesky Testnet

```bash
npx hardhat run scripts/deploy.js --network morphHolesky
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
- **Minimum 20% initial deposit** — `require(initialDeposit >= totalAmount * 20 / 100)`
- **Commitment deadline cap** — `require(commitmentDate <= block.timestamp + 90 days)`
- **`int256` reputation score** — prevents underflow on defaults
- **On-chain grace period constant** — not dependent on off-chain state
- **USDC address as constructor parameter** — no hardcoded token addresses
- **Dedicated read-only backend wallet** — all state-changing calls come from MetaMask only

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
