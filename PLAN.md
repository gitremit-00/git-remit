# RemitSafe — Co-Dev Build Plan

**Hackathon:** Build In! Payments — Morph x Blockchain4Youth x DVCode
**Track:** Cross-Border Remittance
**Deadline:** May 29, 2026
**Prize Pool:** $3,500 USDC
**Chain:** Morph L2 (Holesky Testnet)

---

## Tech Stack

### Smart Contracts

| Tool / Library | Version | Purpose |
| -------------- | ------- | ------- |
| Solidity | 0.8.x | Core contract language for `RemittancePledge.sol` |
| OpenZeppelin | latest | `ReentrancyGuard`, `Ownable`, ERC20 interface |
| Hardhat | latest | Compile, test, and deploy contracts locally |
| ethers.js | v6 | Connect contracts to frontend and backend |
| Morph Holesky Testnet | — | Free testnet for deployment and demo |

### Backend

| Tool / Library | Version | Purpose |
| -------------- | ------- | ------- |
| Next.js API Routes | 14 | Route handlers inside `/app/api/` — replaces Express entirely |
| Node.js | 18+ | Runtime (built into Next.js, no separate process) |
| ethers.js | v6 | Contract event listener (read-only, throwaway wallet) |
| pg (node-postgres) | latest | PostgreSQL client for Node.js |
| dotenv | latest | Environment variable management |

### Frontend

| Tool / Library | Version | Purpose |
| -------------- | ------- | ------- |
| Next.js | 14 (App Router) | Full-stack framework — pages, SSR, type safety |
| TypeScript | latest | Type safety across all components and API calls |
| Tailwind CSS | v3 | Utility-first styling |
| ethers.js | v6 | MetaMask wallet connection and contract calls |
| MetaMask | — | Browser wallet for signing transactions |

### Database

| Tool | Purpose |
| ---- | ------- |
| PostgreSQL | Relational DB for off-chain user and pledge data |
| Supabase | Hosted PostgreSQL — free tier, zero DevOps |

### DevOps & Hosting

| Tool | Purpose |
| ---- | ------- |
| Vercel | Full-stack Next.js deployment — frontend + API in one deploy |
| GitHub | Version control and public repo for submission |
| Morph Explorer | Verify deployed contracts on Holesky testnet |
| Postman | API endpoint testing |
| Hardhat Network | Local blockchain with 20 pre-funded wallets for unit tests |

---

## What We're Building

A **Payment Pledge System** for OFWs. Instead of sending money now or not at all, a sender can:

1. Lock partial USDC into a smart contract escrow
2. Commit to depositing the remainder on a future date
3. Give merchants (schools, landlords, clinics) on-chain proof they can trust

---

## Team Roles

| Role | Responsibilities |
| ---- | --------------- |
| **M1 — Contract Dev** | `RemittancePledge.sol`, `MockUSDC.sol`, Hardhat tests, testnet deploy |
| **M2 — Backend Dev** | Next.js API routes (`/app/api/`), Supabase/PostgreSQL, event listeners, cron notifications |
| **M3 — Frontend Dev** | Sender & Merchant dashboards, MetaMask integration, ethers.js contract calls |
| **M4 — Demo / Docs** | Architecture diagram, README, demo video script, Build Diary posts on X |

> If team is 3 people, M4 tasks split between M2 and M3.

---

## Repo Structure (Target)

```text
git-remit/
├── contracts/
│   ├── RemittancePledge.sol
│   └── MockUSDC.sol
├── test/
│   └── RemittancePledge.test.js
├── scripts/
│   └── deploy.js
├── hardhat.config.js
├── app/
│   ├── sender/
│   │   └── page.tsx
│   ├── merchant/
│   │   └── page.tsx
│   └── api/
│       ├── pledge/
│       │   ├── create/route.ts
│       │   └── [id]/route.ts
│       └── user/route.ts
├── lib/
│   ├── db.ts          (Supabase client)
│   └── contract.ts    (ethers.js helpers)
├── .env.example
└── PLAN.md
```

---

## Phase Breakdown

### Phase 1 — Setup & Architecture | Day 1–2 | May 18–19

Owner: Everyone

- [ ] Create public GitHub repo, everyone clones
- [ ] `npx hardhat init` inside `contracts/` folder
- [ ] `npx create-next-app@latest` with TypeScript + Tailwind in root
- [ ] Create Supabase project, copy connection string to `.env`
- [ ] Connect MetaMask to Morph Holesky testnet (chainId: 2810)
- [ ] Get test ETH from Morph Holesky Faucet
- [ ] Post **Build Diary #1** on X with `#MorphBuildSprint #MorphBuildPH`

#### Supabase Tables to Create

```sql
-- users
id, wallet_address, name, phone, created_at

-- pledges
id, pledge_id_onchain, sender_wallet, merchant_wallet,
total_amount, initial_deposit, remaining_amount,
commitment_date, status, created_at, updated_at

-- notifications
id, pledge_id, recipient_wallet, message, sent_at, type
```

---

### Phase 2 — Smart Contract | Day 3–4 | May 20–21

Owner: M1

#### `RemittancePledge.sol` — Functions to Write

| Function | What it does |
| -------- | ------------ |
| `createPledge(merchant, total, initialDeposit, commitmentDate)` | Locks initial USDC into escrow. Emits `PledgeCreated`. |
| `depositRemaining(pledgeId)` | Sender deposits remaining balance. Auto-triggers `releaseFunds()` when full. |
| `releaseFunds(pledgeId)` | Internal. Transfers full USDC to merchant. Sets status → `COMPLETED`. |
| `claimPartial(pledgeId)` | Merchant calls after grace period. Sets status → `DEFAULTED`, transfers locked funds. |
| `refundSender(pledgeId)` | Sender calls after 30-day claim window expires. Returns locked funds. |
| `extendDeadline(pledgeId, newDate)` | One-time extension with merchant signature. Must be before commitmentDate. |
| `getReputation(wallet)` | View. Returns score, pledgeCount, defaultCount. |
| `getPledge(pledgeId)` | View. Returns full pledge struct. |

#### Pledge States (enum)

```solidity
enum PledgeStatus { PENDING, COMPLETED, DEFAULTED, DISPUTED }
```

#### Constants (store on-chain)

```solidity
uint256 public constant GRACE_PERIOD = 3 days;
uint256 public constant CLAIM_WINDOW = 30 days;
```

#### Security Requirements (all must be done before deploy)

- [ ] Use `int256` for reputation score — NOT `uint256` (prevents underflow wrap-around)
- [ ] Accept USDC token address as constructor param — NOT hardcoded
- [ ] Import `ReentrancyGuard` from OpenZeppelin, add `nonReentrant` to all transfer functions
- [ ] `createPledge()` must require:
  - `initialDeposit >= totalAmount * 20 / 100` (minimum 20% upfront)
  - `commitmentDate <= block.timestamp + 90 days`
  - `totalAmount > 0`
- [ ] `depositRemaining()` must require:
  - `pledge.status == PENDING`
  - `block.timestamp <= commitmentDate + GRACE_PERIOD`
- [ ] `claimPartial()` sets `status = DEFAULTED` BEFORE transferring (prevents double claim)
- [ ] `claimPartial()` only callable after `commitmentDate + GRACE_PERIOD`
- [ ] `claimPartial()` only callable before `commitmentDate + GRACE_PERIOD + CLAIM_WINDOW`
- [ ] `extendDeadline()` requires `block.timestamp < pledge.commitmentDate`
- [ ] `releaseFunds()` is `internal` — never callable directly from outside or from backend

#### Reputation Score Formula

```text
score = (pledgesOnTime × 10) - (defaults × 25) - (latePayments × 5) + volumeBonus
```

Score is public and stored on-chain. Any wallet or app can read it.

#### Hardhat Tests to Write (`test/RemittancePledge.test.js`)

| Scenario | Expected |
| -------- | -------- |
| Create pledge with 50 USDC | 50 USDC locked in contract |
| Deposit remaining 100 USDC | Contract holds 150, auto-releases to merchant |
| Deposit with 0% upfront | Reverted |
| Set commitment date > 90 days | Reverted |
| Miss deadline, try depositRemaining() | Reverted after grace period |
| Merchant calls claimPartial() during grace period | Reverted |
| Merchant calls claimPartial() after grace period | Receives 50 USDC, status DEFAULTED |
| Merchant misses 30-day window | refundSender() returns 50 USDC to sender |
| extendDeadline() after deadline | Reverted |
| Reputation score after default | Drops, never underflows |
| Reentrancy attempt on claimPartial | Reverted |

#### Deploy to Morph Holesky

```bash
npx hardhat run scripts/deploy.js --network morphHolesky
```

After deploy: paste contract address in `PLAN.md` and `.env`.

---

### Phase 3 — Backend API | Day 5–6 | May 22–23

Owner: M2

All routes live inside `/app/api/` — no Express, no separate server.

#### API Routes to Build

| Route | Method | What it does |
| ----- | ------ | ------------ |
| `/api/pledge/create` | POST | Saves pledge metadata to Supabase after on-chain creation |
| `/api/pledge/[id]` | GET | Returns pledge details (on-chain + off-chain merged) |
| `/api/user` | GET/POST | Fetch or create user profile by wallet address |
| `/api/notifications` | GET | Fetch notification history for a wallet |

#### Event Listener (ethers.js)

- Listen for `PledgeCreated`, `PledgeFulfilled`, `PledgeDefaulted` events
- On each event: update Supabase `pledges.status`, insert into `notifications`
- Use a **throwaway wallet with zero funds** for the backend listener — never store a funded private key

#### Cron Notification Jobs

Run daily via Vercel Cron or a simple Next.js route hit by a cron service:

| Trigger | Notification |
| ------- | ------------ |
| 3 days before `commitmentDate` | "Payment due in 3 days" → sender |
| 1 day before `commitmentDate` | "Payment due tomorrow" → sender |
| `commitmentDate` passed, status still PENDING | "Deadline missed — grace period active" → sender + merchant |
| Grace period ended | "Grace period over — merchant can now claim" → merchant |

---

### Phase 4 — Frontend | Day 7–8 | May 24–25

Owner: M3

#### Sender Page (`/app/sender/page.tsx`)

- [ ] Connect MetaMask wallet button
- [ ] Create Pledge form: total amount, initial deposit, merchant wallet, commitment date
- [ ] Show active pledges list with status badges
- [ ] "Deposit Remaining" button per pledge
- [ ] Reputation score display
- [ ] Notification feed

#### Merchant Page (`/app/merchant/page.tsx`)

- [ ] Connect MetaMask wallet button
- [ ] Incoming pledges table: sender wallet, amounts, deadline, status
- [ ] Sender reputation score per pledge row
- [ ] "Claim Partial" button (visible only after grace period ends)
- [ ] On-chain verification link → Morph Explorer per pledge

#### MetaMask + ethers.js Setup (`/lib/contract.ts`)

```typescript
// Connect to Morph Holesky
const provider = new ethers.BrowserProvider(window.ethereum)
const signer = await provider.getSigner()
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer)
```

> All state-changing calls (deposit, claim) go through the user's MetaMask — NEVER from the backend.

---

### Phase 5 — Integration & Testing | Day 9 | May 26

Owner: Everyone

- [ ] Full end-to-end test on Morph Holesky: create pledge → deposit → auto-release
- [ ] Test default + grace period + claimPartial() flow on testnet
- [ ] Test refundSender() after claim window
- [ ] Fix any frontend ↔ backend ↔ contract wiring bugs
- [ ] Verify contract on Morph Explorer (submit ABI + source)

---

### Phase 6 — Polish | Day 10 | May 27

Owner: M3 + M4

- [ ] Loading states, error messages, mobile responsiveness
- [ ] Architecture diagram (Figma or draw.io) — required for bonus points
- [ ] Smart contract flow diagram
- [ ] Payment flow diagram
- [ ] Write `README.md` with: setup instructions, contract address, testnet link
- [ ] Prepare 3-minute demo script

**Demo Script Structure:**

- **0:00–0:30** — Problem: OFW payday vs. bill due date gap
- **0:30–2:30** — Live demo: create pledge → school sees it → Juan deposits → auto-release
- **2:30–3:00** — Future plans: GCash integration, mainnet, credit scoring API

- [ ] Post **Build Diary #2** on X with `#MorphBuildSprint #MorphBuildPH`

---

### Phase 7 — Submission | Day 11 | May 28–29

Owner: Everyone

- [ ] Record 3-minute demo video (1920×1080, 16:9)
- [ ] Upload to YouTube or X
- [ ] Write 200-word use case write-up (already drafted in project doc — review and finalize)
- [ ] Push all code to public GitHub repository
- [ ] Deploy frontend + API to Vercel
- [ ] Submit all materials before **May 29 deadline**
- [ ] Post **Build Diary #3** on X with `#MorphBuildSprint #MorphBuildPH`

---

## On-Chain vs Off-Chain — Quick Reference

| Data | Where | Why |
| ---- | ----- | --- |
| USDC escrow & release | On-chain (Morph) | Trustless, immutable |
| Pledge amounts & dates | On-chain (Morph) | Core commitment |
| Wallet addresses | On-chain (Morph) | Public identifiers |
| Reputation score | On-chain (Morph) | Must be publicly verifiable |
| Transaction audit log | On-chain (Morph) | Permanent record |
| User name, phone | PostgreSQL | Private PII |
| Pledge notes/metadata | PostgreSQL | Searchable, non-financial |
| Notification logs | PostgreSQL | Operational only |

---

## Environment Variables (`.env`)

```env
# Blockchain
MORPH_HOLESKY_RPC_URL=
CONTRACT_ADDRESS=
BACKEND_WALLET_PRIVATE_KEY=   # throwaway wallet, zero funds

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=

# Next.js
NEXT_PUBLIC_CONTRACT_ADDRESS=
NEXT_PUBLIC_MORPH_CHAIN_ID=2810
```

---

## Submission Checklist

### Required

- [ ] 200-word write-up
- [ ] Public demo URL (Vercel)
- [ ] Working prototype on Morph Holesky testnet
- [ ] Public GitHub repo
- [ ] 3-minute demo video on YouTube or X
- [ ] Build Diary Post #1
- [ ] Build Diary Post #2
- [ ] Build Diary Post #3
- [ ] All posts tagged `#MorphBuildSprint` and `#MorphBuildPH`

### Bonus (extra credit)

- [ ] Architecture diagram
- [ ] Smart contract flow diagram
- [ ] Payment flow diagram
- [ ] Working MetaMask + live contract integration
- [ ] Open-source quality README

---

## Key Rules to Never Break

1. **Fund release is on-chain only.** `releaseFunds()` is `internal`. No backend wallet triggers it.
2. **Backend wallet has zero funds.** It only reads events. All transactions go through MetaMask.
3. **State changes before transfers.** Always update `pledge.status` BEFORE calling token transfer.
4. **Reputation score uses `int256`.** Never `uint256` — it will underflow on default.
5. **Grace period is a contract constant.** Not a database value. Merchants can always claim on-chain even if backend is down.

---

RemitSafe — Build In! Payments Hackathon, May 18–29, 2026
