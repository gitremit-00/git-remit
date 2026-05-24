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

---

## Post-Hackathon Roadmap — Mobile App (Capacitor) + E2EE

> These phases begin **after** the hackathon submission. The mobile app is built using **Capacitor** wrapping the existing Next.js frontend. E2EE is added after the mobile app is stable.

---

### Decision Log

| Decision | Choice | Reason |
|----------|--------|--------|
| Mobile framework | **Capacitor** | Wraps existing Next.js UI — no rewrite. Camera is server-side only. |
| Face recognition | **Server-side (InsightFace buffalo_s)** | buffalo_l = 327 MB, buffalo_s = 159 MB — too large for on-device. README confirms server-side architecture. |
| On-device ML | **Not used** | Models are ONNX/InsightFace format, not TFLite/CoreML. No on-device conversion path. |
| Wallet on mobile | **WalletConnect v2** | `window.ethereum` does not exist in a native WebView. WalletConnect is the standard replacement. |
| E2EE crypto primitives | **@noble/curves + @noble/hashes** | Already in frontend deps. X25519 ECDH + AES-256-GCM. |
| Auth layers | **Wallet sig + Native biometric + Camera KYC (registration only)** | Camera re-scan only at registration (KYC). Native Face ID/fingerprint for daily login. |

---

### Phase 8 — Capacitor Mobile App Setup

Owner: M3

#### Step 1 — Install Capacitor

```bash
cd frontend
npm install @capacitor/core @capacitor/cli
npx cap init RemitSafe com.remitsafe.app --web-dir=out
npm install @capacitor/android @capacitor/ios
```

#### Step 2 — Enable Static Export

Update [frontend/next.config.mjs](frontend/next.config.mjs):

```js
const nextConfig = {
  output: "export",
  trailingSlash: true,
};
```

> **Important**: `output: "export"` disables Next.js API routes. The `/api/rpc` route must be moved to an external server before this change.

#### Step 3 — Move `/api/rpc` to External Server

Options (pick one):

| Option | Cost | Effort |
|--------|------|--------|
| Cloudflare Workers | Free | Low |
| Railway / Render | Free tier | Low |
| Vercel serverless (separate project) | Free tier | Low |

#### Step 4 — Add Native Platforms

```bash
npx next build        # outputs static files to /out
npx cap add android
npx cap add ios
npx cap sync          # copies /out into native projects
```

#### Step 5 — Replace Web APIs with Capacitor Plugins

| Web API | Capacitor Plugin | Why |
|---------|-----------------|-----|
| `navigator.clipboard` | `@capacitor/clipboard` | Clipboard access in WebView |
| `localStorage` | `@capacitor/preferences` | Persistent key-value storage |
| `window.ethereum` | `@walletconnect/modal` | MetaMask doesn't inject in WebView |
| Push notifications | `@capacitor/push-notifications` | Native push (FCM / APNs) |
| Camera (KYC) | `@capacitor/camera` | Photo capture for face verification |
| Biometric auth | `@capacitor-community/biometric-auth` | Face ID / fingerprint for login |
| Secure key storage | `@capacitor-community/secure-storage` | Store E2EE private keys in Keychain/Keystore |

#### Step 6 — Fix Wallet Connection for Mobile

In [frontend/context/WalletContext](frontend/context/WalletContext), detect native vs browser:

```ts
const isNative = !(window as any).ethereum;

if (isNative) {
  // WalletConnect modal → connects MetaMask Mobile or any WalletConnect wallet
  const modal = new WalletConnectModal({ projectId: "YOUR_PROJECT_ID" });
  await modal.openModal();
} else {
  // Existing MetaMask browser extension flow — unchanged
}
```

#### Step 7 — Build & Run on Device

```bash
# After every code change
npx next build && npx cap sync

# Android (requires Android Studio)
npx cap open android

# iOS (requires Mac + Xcode)
npx cap open ios
```

#### Checklist — Phase 8

- [ ] Capacitor installed and initialized
- [ ] `output: "export"` configured in next.config.mjs
- [ ] `/api/rpc` moved to external server
- [ ] Android platform added and syncing
- [ ] WalletConnect integrated, replaces `window.ethereum` on mobile
- [ ] `@capacitor/camera` installed and tested
- [ ] `@capacitor-community/biometric-auth` installed and tested
- [ ] App runs on Android emulator
- [ ] App runs on real Android device
- [ ] (Optional) iOS build on Mac

---

### Phase 9 — Camera Auth + Face KYC (Registration)

Owner: M2 (backend) + M3 (frontend)

#### Architecture

```
Mobile captures photo (camera)
  → JPEG sent to backend API
  → Backend runs InsightFace buffalo_s (Python server)
  → Returns: { match: true/false, confidence: 0.0–1.0 }
  → Frontend shows result, proceeds or blocks
```

> Uses buffalo_s (not buffalo_l) on the server — smaller footprint, adequate accuracy for KYC.
> Neither model runs on-device — they are server-side only.

#### Registration Flow

```
Step 1 → Connect wallet (WalletConnect or MetaMask)
Step 2 → Camera: capture face photo
Step 3 → POST photo to /api/kyc/register
  → Backend: detect face → generate embedding → store embedding (not the photo)
Step 4 → User is registered, wallet ↔ face embedding linked in DB
```

#### Login Flow (daily use)

```
Step 1 → Wallet signature (proves wallet ownership)
Step 2 → Native biometric (Face ID / fingerprint) — fast, offline, OS-trusted
  (Camera KYC only re-triggered for: new device, suspicious session, or high-value transfer)
```

#### Backend — New API Routes

| Route | Method | What it does |
|-------|--------|-------------|
| `/api/kyc/register` | POST | Receive photo, run buffalo_s, store face embedding |
| `/api/kyc/verify` | POST | Receive photo, compare embedding, return match result |

#### Environment Variables (add to `.env`)

```env
# Face Recognition
FACE_MODEL_DIR=./models/face-recognition
FACE_MODEL=buffalo_s
FACE_MATCH_THRESHOLD=0.45
```

#### Checklist — Phase 9

- [ ] Python face recognition server running (InsightFace + buffalo_s)
- [ ] `/api/kyc/register` endpoint built and tested
- [ ] `/api/kyc/verify` endpoint built and tested
- [ ] Face embedding stored in DB (not the raw photo)
- [ ] Camera capture UI on registration screen
- [ ] Native biometric wired up for daily login
- [ ] Camera re-verification on high-value transfers (>100 USDC)

---

### Phase 10 — End-to-End Encryption (E2EE)

Owner: M2 (backend) + M3 (frontend)

#### What Gets Encrypted

| Data | Encryption | Who Can Decrypt |
|------|-----------|----------------|
| Transfer memo / notes | AES-256-GCM (ECDH derived key) | Sender + Recipient only |
| Recipient PII (name, account) | AES-256-GCM | Sender only |
| Transfer confirmation (high-value) | TOTP challenge | Server validates hash only |
| Smart contract data (amounts, addresses) | Not encrypted — on-chain is public | Public |

> On-chain data cannot be E2EE'd. The EVM reads it. E2EE covers off-chain metadata only.

#### Two Encryption Modes

| Mode | Like | Use Case |
|------|------|---------|
| **Persistent Key Pair** (ECDH) | Signal / Messenger | Long-term secure channel between sender and recipient |
| **TOTP** (Time-based One-Time Password) | Google Authenticator | One-time confirmation code for high-value transfers |

---

#### Phase 10A — Key Infrastructure

##### Key Generation (client-side only)

```
User completes registration
  → Generate X25519 keypair on device (using @noble/curves)
  → Private key stored in @capacitor-community/secure-storage
      (uses iOS Keychain / Android Keystore natively)
  → Public key signed with wallet private key (non-repudiable)
  → POST { walletAddress, publicKey, signature } to /api/keys
```

##### Backend — New DB Column + Route

```sql
ALTER TABLE users ADD COLUMN public_key TEXT;
```

| Route | Method | What it does |
|-------|--------|-------------|
| `/api/keys` | POST | Verify wallet signature, store public key |
| `/api/keys/:wallet` | GET | Return public key for a wallet address |

##### Key Exchange for a Transfer

```
Sender opens new-transfer form
  → Fetch recipient pubKey from /api/keys/:recipientWallet
  → sharedSecret = ECDH(senderPrivKey, recipientPubKey)  ← stays on device
  → encryptedMemo = AES-256-GCM(memo, sharedSecret)
  → Store encryptedMemo off-chain (backend DB or IPFS)
  → Recipient fetches and decrypts using their own privKey
```

---

#### Phase 10B — TOTP for High-Value Transfers

Install:

```bash
npm install otpauth qrcode
```

##### Setup (in `/settings` page)

```
User enables "Secure Transfer Confirmation"
  → Backend generates TOTP shared secret (RFC 6238)
  → Show QR code → user scans with authenticator app
      OR auto-store secret in @capacitor/preferences on mobile
  → User enters 6-digit code to confirm activation
```

##### Verification (in `/new-transfer` page)

```
Transfer amount > 100 USDC
  → Show 6-digit TOTP prompt
  → User enters code (auto-filled from on-device secret on mobile)
  → POST code to /api/totp/verify
  → Server validates (±1 window tolerance)
  → On success: proceed with smart contract call
```

##### Backend — New Routes

| Route | Method | What it does |
|-------|--------|-------------|
| `/api/totp/setup` | POST | Generate TOTP secret, return QR code data URL |
| `/api/totp/verify` | POST | Validate submitted 6-digit code |

---

#### Libraries Summary

| Purpose | Library | Already in deps? |
|---------|---------|-----------------|
| ECDH key generation | `@noble/curves` | Yes |
| Hashing / KDF | `@noble/hashes` | Yes |
| TOTP | `otpauth` | No — install |
| QR code (TOTP setup) | `qrcode` | No — install |
| Secure key storage | `@capacitor-community/secure-storage` | No — install |

---

#### Checklist — Phase 10

- [ ] `public_key` column added to users table
- [ ] `/api/keys` POST + GET routes built
- [ ] X25519 keypair generation on device (`@noble/curves`)
- [ ] Private key stored in `@capacitor-community/secure-storage`
- [ ] Transfer memos encrypted with ECDH + AES-256-GCM
- [ ] Encrypted memos decryptable by recipient only
- [ ] TOTP setup UI in `/settings`
- [ ] TOTP verification step in `/new-transfer` for transfers > 100 USDC
- [ ] Key rotation on wallet change

---

### Post-Hackathon Implementation Order

```
[MOBILE PHASE]
  1. Move /api/rpc to external server
  2. Configure next.config.mjs static export
  3. Install Capacitor + add Android platform
  4. Replace window.ethereum → WalletConnect
  5. Add Capacitor native plugins (camera, biometric, preferences)
  6. Test on Android emulator → real device
  7. (Optional) iOS build on Mac

[CAMERA + KYC PHASE]
  8. Set up Python InsightFace server (buffalo_s)
  9. Build /api/kyc/register and /api/kyc/verify
  10. Wire camera capture on registration screen
  11. Wire native biometric for daily login

[E2EE PHASE]
  12. Add public_key to users DB + /api/keys routes
  13. Key generation on onboarding (X25519 via @noble/curves)
  14. Secure key storage via @capacitor-community/secure-storage
  15. Encrypt transfer memos in new-transfer flow
  16. TOTP setup UI in /settings
  17. TOTP gate on transfers > 100 USDC
  18. Key rotation on wallet change
```
