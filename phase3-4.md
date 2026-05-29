# RemitSafe — Phase 3 & 4 Implementation Plan

This document is the implementation contract for the backend (Phase 3) and frontend (Phase 4) work, following the completed contract rewrite in Phase 1.

It assumes:
- The new `RemittancePledge.sol` is deployed to a fresh contract address on Morph testnet
- Decisions 1–23 from the spec are locked
- The data mapping audit is the source of truth for state ownership

---

## Status (2026-05-30)

**Phase 1 contract — complete and verified.** `RemittancePledge.sol` (v2, account-keyed) is
finalized and passes the full test stack:

- **Hardhat:** 277 passing — 100% statements / functions / lines, ~89% branches. Covers
  linking, escrow, tiered withdrawals, P2P, pledges, recurring pledges, reputation, and all
  reachable auth/state revert guards. (See [test/TESTING.md](test/TESTING.md) for the
  branch-coverage breakdown — the remainder is OZ-modifier negative paths and a handful of
  provably-unreachable defensive guards.)
- **Foundry:** 6 fuzz + 5 invariant passing; escrow conservation holds across random call
  sequences.
- **Slither:** 0 actionable findings (operator zero-address checks are intentional
  "disabled" states, suppressed inline).
- **Deployed size:** 20.6 KiB — under the 24.576 KiB EIP-170 limit.
- **Security review (automated, 2026-05-30):** no high-confidence vulnerabilities in the
  contract against signature-replay, reentrancy, fund-accounting/escrow, withdrawal-timelock,
  and access-control classes. Off-chain findings to fix before deploy are tracked in the new
  **"Pre-deploy security fixes"** section below.

Not yet done: a professional human audit (recommended before mainnet / real value), and the
Phase 3/4 backend + frontend work described in the rest of this document.

---

# Phase 3 — Backend + Database (5–7 days)

## 3.1 Database migration

### 3.1.1 New table: `profile_wallets`

```sql
CREATE TABLE IF NOT EXISTS public.profile_wallets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  is_primary     boolean NOT NULL DEFAULT false,
  confirmed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_wallets_wallet_unique UNIQUE (wallet_address)
);

CREATE UNIQUE INDEX one_primary_per_profile
  ON public.profile_wallets (profile_id) WHERE is_primary;

CREATE INDEX idx_profile_wallets_profile ON public.profile_wallets (profile_id);
```

**Migration of existing data:**

```sql
INSERT INTO public.profile_wallets (profile_id, wallet_address, is_primary)
SELECT id, lower(wallet_address), true
FROM public.profiles
WHERE wallet_address IS NOT NULL AND wallet_address != '';
```

**Drop old column:**

```sql
ALTER TABLE public.profiles DROP COLUMN IF EXISTS wallet_address;
```

### 3.1.2 RLS policies for `profile_wallets`

```sql
ALTER TABLE public.profile_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own wallets"
  ON public.profile_wallets FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id);

CREATE POLICY "Users insert own wallets"
  ON public.profile_wallets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users delete own wallets"
  ON public.profile_wallets FOR DELETE
  TO authenticated
  USING (auth.uid() = profile_id);
```

Service role bypasses these for admin operations.

### 3.1.3 Optional: `withdrawal_notifications` table

For tracking which timelocked-withdrawal notifications have been sent to users:

```sql
CREATE TABLE IF NOT EXISTS public.withdrawal_notifications (
  withdrawal_id bigint PRIMARY KEY,         -- on-chain pendingWithdrawal id
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notified_at   timestamptz NOT NULL DEFAULT now(),
  claimable_at  timestamptz NOT NULL
);

CREATE INDEX idx_withdrawal_notifications_profile ON public.withdrawal_notifications (profile_id);
```

---

## 3.2 Shared `accountId` helper

The same hash must be computable from both backend and frontend. Create a shared utility:

**`frontend/lib/accountId.ts`** (used by both Next.js API routes and React components):

```typescript
import { ethers } from "ethers";

export function deriveAccountId(profileUuid: string): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(`remitsafe:account:${profileUuid}`)
  );
}
```

**Invariant**: anywhere the contract is called with an `accountId`, it MUST be derived via this single function. No inline hashing elsewhere.

---

## 3.3 API endpoints

### 3.3.1 `POST /api/wallet/check`

Public endpoint (with session) — checks if a wallet is available to link.

**Request:**
```json
{ "walletAddress": "0xabc..." }
```

**Response:**
- `200 { "available": true }` — wallet is unlinked
- `409 { "available": false, "reason": "linked_to_other_account" }` — wallet belongs to a different profile
- `200 { "available": true, "alreadyOnSameAccount": true }` — wallet is already on the caller's account

**Logic:**
1. Validate `walletAddress` format (`^0x[0-9a-fA-F]{40}$`).
2. Query `profile_wallets` for that address.
3. If found and matches current `auth.uid()` → return alreadyOnSameAccount.
4. If found and differs → return 409.
5. Cross-check on-chain via `contract.walletToAccount(walletAddress)` for extra safety.

### 3.3.2 `POST /api/wallet/link-signature`

Authenticated endpoint — returns an operator-signed payload authorizing `linkWallet`.

**Request:**
```json
{ "walletAddress": "0xabc..." }
```

**Response:**
```json
{
  "accountId": "0xMARIA...",
  "sigExpiry": 1735000000,
  "operatorSig": "0x..."
}
```

**Logic:**
1. Authenticate session, get profile.
2. Derive `accountId = deriveAccountId(profile.id)`.
3. Pre-flight check: wallet not already linked elsewhere.
4. Rate limit: max 10 link-signature requests per profile per hour.
5. Compute `sigExpiry = now + 15 minutes`.
6. Read `linkNonce = contract.linkNonces(accountId)`.
7. Build message hash exactly matching contract:
   ```typescript
   ethers.solidityPackedKeccak256(
     ["uint256", "address", "string", "bytes32", "address", "uint256", "uint256"],
     [chainId, contractAddr, "link", accountId, walletAddress, sigExpiry, linkNonce]
   )
   ```
8. Sign with `LINK_OPERATOR_PRIVATE_KEY` (env var, never exposed to client).
9. Return the components.

**Security:**
- Operator key kept ONLY on the server (env var, never in code or git).
- Rate-limited to prevent signature harvesting.
- Pre-flight check minimizes useless signatures.

### 3.3.3 `POST /api/wallet/add`

Authenticated — confirms a successful on-chain link.

**Request:**
```json
{ "walletAddress": "0xabc...", "txHash": "0x..." }
```

**Logic:**
1. Authenticate session.
2. Verify `txHash` is confirmed on-chain.
3. Read `contract.walletToAccount(walletAddress)` → must equal `deriveAccountId(profile.id)`.
4. Insert row into `profile_wallets` (or upsert if already exists).
5. If this is the first wallet for the profile, mark `is_primary = true`.
6. If this profile already has KYC approval, trigger the KYC propagation for the new wallet (see 3.3.6).

### 3.3.4 `POST /api/wallet/remove`

Authenticated — removes a wallet.

**Request:**
```json
{ "walletAddress": "0xabc...", "signedMessage": "0x..." }
```

**Logic:**
1. Authenticate session.
2. Verify `signedMessage` is signed by `walletAddress` (proves ownership).
3. Disallow if it's the only linked wallet (HTTP 400 "must keep at least one wallet").
4. Disallow if it's the primary wallet AND there's a non-primary alternative — require user to set a new primary first.
5. Delete from `profile_wallets`.
6. **Note:** the on-chain `unlinkWallet()` is a separate transaction sent by the user from that wallet. Backend just mirrors the DB state.

### 3.3.5 `POST /api/wallet/set-primary`

Authenticated — changes which wallet is the primary for display purposes.

**Request:**
```json
{ "walletAddress": "0xabc..." }
```

**Logic:**
1. Authenticate.
2. Verify wallet belongs to profile.
3. Update `profile_wallets`: set `is_primary = false` on all rows for profile, then `is_primary = true` on the chosen one.

### 3.3.6 KYC route refactor

**File:** `frontend/app/api/admin/kyc/[id]/route.ts`

> ⚠ **Confirmed blocker (security review 2026-05-30).** The current code still calls
> `setMerchantVerified(profile.wallet_address, …)` / `setVerificationBaseline(profile.wallet_address, …)`.
> The contract keys identity by the UUID-derived `accountId` (`bytes32`), **not** the wallet
> address — ethers zero-pads the address into the `bytes32` slot, so the on-chain flag is
> written to a key that never matches `walletToAccount[...]`. This fails *safe* (no
> unauthorized access — transactions just revert with `PayerNotVerified` / `MerchantNotVerified`),
> but it means **no approved user can transact until this is changed to pass `accountId`.**
> This refactor is the fix; it must land before testnet flows will work end-to-end.

**Changes:**
- Compute `accountId = deriveAccountId(profile.id)`.
- Replace `setMerchantVerifiedOnChain(walletAddress, ...)` with `setMerchantVerifiedOnChain(accountId, ...)`.
- Replace `setPayerVerifiedOnChain(walletAddress, ...)` with `setVerificationBaselineOnChain(accountId, ...)`.
- Only ONE on-chain call per KYC decision (the role is account-keyed, not wallet-keyed).
- No more "no wallet address" warning — KYC operates on accountId, which always exists.

**On approve:**
- Update DB `kyc_status = 'verified'`.
- Call `setMerchantVerified(accountId, true)` or `setVerificationBaseline(accountId, 5000)`.

**On reject:**
- Update DB.
- Call `setMerchantVerified(accountId, false)` or `setVerificationBaseline(accountId, 0)`.

### 3.3.7 Avatar boost — auto on upload (hybrid mode)

**File:** `frontend/app/api/profile/route.ts` (PATCH handler).

When `avatar_url` is being set (null → value transition):
1. Update DB as usual.
2. Check on-chain `accountVerificationBaseline(accountId)`. If equal to `BASELINE_KYC` (5000), trigger boost.
3. Call `contract.boostVerificationBaseline(accountId)` via the `VERIFICATION_OPERATOR_PRIVATE_KEY`.
4. If the call fails or the baseline is not exactly 5000, silently succeed the DB update — boost will retry on next interaction.

**Admin spot-check page (new):**
- `app/admin/avatars/page.tsx` listing recent avatar uploads with images.
- Per row: a "Revoke boost" button calling owner-only `setVerificationBaseline(accountId, 5000)` if the avatar is inappropriate.

### 3.3.8 `GET /api/users/:uuid`

Public endpoint (with auth session) — looks up account info for a recipient by their profile UUID.

**Response:**
```json
{
  "uuid": "7a3f9c12-...",
  "accountId": "0xMARIA...",
  "displayName": "Maria S.",
  "role": "ofw_sender",
  "verified": true,
  "hasAvatar": true,
  "hasLinkedWallet": true
}
```

Used by:
- Recipient confirmation screen when a user pastes a UUID
- P2P send confirmation
- Pledge request creation

**Privacy**: don't expose email, full name, or any KYC details. Only public-facing info.

### 3.3.9 Profile deletion guard

**File:** wherever profile deletion is handled (probably a future admin endpoint or user-account-settings flow).

Before allowing deletion, check on-chain state for the accountId:

```typescript
const accountId = deriveAccountId(profile.id);
const wallets = await contract.getAccountWallets(accountId);
if (wallets.length > 0) {
  return NextResponse.json({
    error: "Cannot delete profile: linked wallets exist. Unlink first."
  }, { status: 409 });
}

// Check escrow balances for each whitelisted token
for (const token of WHITELISTED_TOKENS) {
  const balance = await contract.getAccountBalance(accountId, token);
  if (balance > 0n) {
    return NextResponse.json({
      error: `Cannot delete profile: ${token} balance in escrow. Withdraw first.`
    }, { status: 409 });
  }
}

// Check active pledges
const activeCount = await contract.accountActivePledgeCount(accountId);
if (activeCount > 0n) {
  return NextResponse.json({
    error: "Cannot delete profile: active pledges exist."
  }, { status: 409 });
}
```

If reputation exists (non-zero `totalCount`), accept silent orphaning — that's historical record, not blocking.

---

## 3.4 Operator key management

Two separate keys, both stored as env vars and used ONLY server-side:

| Env var | Purpose | Scope |
|---|---|---|
| `LINK_OPERATOR_PRIVATE_KEY` | Signs `linkWallet` approvals | Per-link signatures |
| `VERIFICATION_OPERATOR_PRIVATE_KEY` | Sends `boostVerificationBaseline` txs | Avatar boost only |
| `OWNER_PRIVATE_KEY` | Sends admin txs (`setVerificationBaseline`, `setMerchantVerified`, etc.) | KYC actions |

**Wallet topup:**
- Owner & verification operator wallets need Morph ETH to pay gas.
- Add a balance monitor: check each wallet's ETH balance daily, alert when < 0.01 ETH equivalent.

**Future hardening (mainnet):**
- Migrate `OWNER_PRIVATE_KEY` to a 2-of-3 multisig (Gnosis Safe).
- Keep operator keys as single EOAs — limited blast radius.

---

## 3.5 Event indexer (optional but recommended)

A worker that listens for on-chain events and updates derived DB state.

**Events to index:**
- `WalletLinked` → cross-check `profile_wallets` consistency
- `WalletUnlinked` → notify user, delete from `profile_wallets` if still present
- `WithdrawalQueued` → insert `withdrawal_notifications` row, send push/email
- `WithdrawalClaimed` / `WithdrawalCancelled` → mark notification as resolved
- `PledgeCompleted`, `PledgeDefaulted` → push notification to merchant/payer
- `InstallmentMissed` → push notification to payer
- `AccountVerificationBaselineChanged` → push notification ("your trust score changed")

**Implementation options:**
- Lightweight: a Next.js cron job polling logs every 60s.
- Production: a separate service (Node + ethers + Postgres) running continuously.

**Out of scope for v1**: skip if you want to ship faster. The frontend can read all of this on-demand. The indexer becomes valuable when you need email/push notifications.

---

## 3.6 Daily reconciliation job

Runs once per day. Walks `profile_wallets` and verifies on-chain consistency:

```typescript
for (const row of allProfileWallets) {
  const onChainAccountId = await contract.walletToAccount(row.wallet_address);
  const expectedAccountId = deriveAccountId(row.profile_id);

  if (onChainAccountId !== expectedAccountId) {
    log.warn({ row, onChainAccountId, expectedAccountId }, "wallet linkage drift");
    // Auto-correct: delete DB row (user must re-link)
    // OR alert ops for manual review
  }
}
```

For KYC drift:
```typescript
const verifiedProfiles = await db.query("SELECT id FROM profiles WHERE kyc_status = 'verified'");
for (const { id } of verifiedProfiles) {
  const accountId = deriveAccountId(id);
  const baseline = await contract.accountVerificationBaseline(accountId);
  if (baseline === 0n) {
    log.warn({ profileId: id, accountId }, "KYC baseline missing on-chain");
    // Retry pushing
  }
}
```

---

## 3.7 Backend testing

For each new endpoint, write integration tests using a local Hardhat node + Supabase test instance:

| Test | What |
|---|---|
| `wallet/check` | Returns 200 unlinked, 409 linked elsewhere, 200 same account |
| `wallet/link-signature` | Returns valid signature, rate-limited correctly |
| `wallet/add` | Inserts row, sets primary on first, rejects on tx mismatch |
| `wallet/remove` | Deletes row, refuses last wallet, requires signed message |
| KYC route | Account-keyed call, single tx per KYC action |
| Avatar route | Auto-triggers boost when avatar_url goes null→set |
| Profile lookup | Returns expected fields, omits PII |
| Profile deletion guard | Blocks on linked wallet, balance, active pledges |

Use a fork of the contract on a local Hardhat node for these tests.

---

## 3.8 Phase 3 deliverables checklist

- [ ] `profile_wallets` table created + migration applied
- [ ] `wallet_address` column dropped from `profiles`
- [ ] `deriveAccountId` helper in `frontend/lib/accountId.ts`
- [ ] `POST /api/wallet/check`
- [ ] `POST /api/wallet/link-signature`
- [ ] `POST /api/wallet/add`
- [ ] `POST /api/wallet/remove`
- [ ] `POST /api/wallet/set-primary`
- [ ] `GET /api/users/:uuid`
- [ ] KYC route updated to use accountId
- [ ] Avatar upload triggers `boostVerificationBaseline`
- [ ] Profile deletion guard
- [ ] `LINK_OPERATOR_PRIVATE_KEY` env var configured
- [ ] Operator wallet ETH balance monitor
- [ ] Integration tests for all new endpoints
- [ ] (Optional) Event indexer started
- [ ] (Optional) Daily reconciliation cron

---

# Phase 4 — Frontend (7–10 days)

## 4.1 ABI + contract address sync

- Copy fresh `RemittancePledge.json` from `artifacts/contracts/RemittancePledge.sol/` to `frontend/contracts/`.
- Update `frontend/contracts/addresses.ts` with the new contract address from Phase 1 deployment.
- Re-check that `frontend/contracts/MockTokens.json` matches the deployed mocks.

## 4.2 WalletContext rewrite

**File:** `frontend/context/WalletContext.tsx`

**Old state:** single `account` (string), `signer`.
**New state:**
```typescript
{
  // The currently-active wallet for sending transactions
  activeWallet: string | null;
  activeSigner: Signer | null;

  // All wallets linked to the current profile's account
  linkedWallets: LinkedWallet[];  // { address, isPrimary }

  // The user's accountId derived from their profile UUID
  accountId: string | null;

  // Account-level info
  accountVerified: boolean;
  accountTrustScore: number;
  accountBalances: Record<TokenAddr, bigint>;  // token → balance

  // Methods
  connect: () => Promise<void>;        // connect MetaMask, no link yet
  linkActiveWallet: () => Promise<void>; // link via operator signature + on-chain tx
  unlinkWallet: (address: string) => Promise<void>;
  setActiveWallet: (address: string) => Promise<void>; // switch which linked wallet is "active"
  panicUnlink: () => Promise<void>;
  refresh: () => Promise<void>;        // refetch all account state
}
```

**Behavior:**
- On mount: derive accountId from session, fetch linked wallets from backend, fetch all on-chain state.
- On connect: trigger MetaMask connection but DON'T auto-link. Show UI prompting to link if address not in `linkedWallets`.
- `linkActiveWallet`: calls `/api/wallet/link-signature`, then `contract.linkWallet(accountId, sigExpiry, operatorSig)` from MetaMask, then `/api/wallet/add` to persist.
- `setActiveWallet`: prompts MetaMask to switch accounts, updates signer.

## 4.3 New pages

### 4.3.1 `/wallets` — Wallet manager

```
┌─ My Wallets ────────────────────────────────────────┐
│                                                      │
│ Account ID:  7a3f9c12-...  [📋 Copy]  [📷 QR]      │
│                                                      │
│ Linked Wallets (3 of 5)                              │
│ ┌──────────────────────────────────────────────┐    │
│ │ ⭐ 0x7A...3F9    Primary       │ Active   ✓ │    │
│ │   Daily cap: 500 USDC          │ [Edit cap] │    │
│ │   Balance:    125.30 USDC      │ [Remove]   │    │
│ └──────────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────────┐    │
│ │   0x4B...821    Cold storage              ⚙ │    │
│ │   Daily cap: Unlimited                       │    │
│ │   Balance:    5,000.00 USDC                  │    │
│ └──────────────────────────────────────────────┘    │
│                                                      │
│ [+ Add Wallet]   [🚨 Panic Unlink]                 │
└──────────────────────────────────────────────────────┘
```

**Behaviors:**
- "Add Wallet" → MetaMask account-switching prompt → link flow
- "Remove" → confirm dialog → sign message from wallet → unlinkWallet tx → backend remove
- "Set as Primary" → backend `set-primary` call
- "Edit cap" → daily cap config modal
- "Panic Unlink" → big red confirmation → calls `panicUnlink` from current wallet

### 4.3.2 `/withdraw` — Account balance withdrawal

```
┌─ Withdraw from Account ──────────────────────────────┐
│                                                       │
│ Token:        [USDC ▼]                                │
│ Amount:       [____________________]  USDC            │
│   Available:  525.30 USDC                             │
│                                                       │
│ Send to:      [⭐ 0x7A...3F9 (Main) ▼]                │
│   Daily cap remaining: 100 USDC                       │
│                                                       │
│ ┌─ Withdrawal Preview ──────────────────────────────┐ │
│ │ 50 USDC → Instant (within daily cap)              │ │
│ │ OR                                                 │ │
│ │ 200 USDC → 1-hour timelock                        │ │
│ │ OR                                                 │ │
│ │ 5,000 USDC → 24-hour timelock                     │ │
│ └────────────────────────────────────────────────────┘ │
│                                                       │
│ [Withdraw]                                            │
└───────────────────────────────────────────────────────┘
```

**Behavior:**
- Compute preview tier locally based on `getDailyCap`, `getDailyUsed`, amount.
- Submit calls `contract.withdraw(token, amount)` from chosen wallet.
- If returns id == 0 (instant): show success.
- If returns id > 0 (queued): redirect to pending withdrawals page.

### 4.3.3 `/withdrawals/pending` — Pending withdrawals list

```
┌─ Pending Withdrawals ────────────────────────────────┐
│                                                       │
│ ┌─ #42 — 5,000 USDC ─────────────────────────────┐  │
│ │ To: 0x4B...821 (Cold storage)                  │  │
│ │ Status: 22h 14m remaining                       │  │
│ │ [Cancel withdrawal] [Claim (locked)]            │  │
│ └─────────────────────────────────────────────────┘  │
│                                                       │
│ ┌─ #41 — 200 USDC ───────────────────────────────┐  │
│ │ To: 0x7A...3F9 (Main)                          │  │
│ │ Status: Ready to claim ✓                        │  │
│ │ [Cancel] [Claim now]                            │  │
│ └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

**Data source:** iterate `pendingWithdrawalCounter`, read each, filter to ones matching user's accountId AND `active = true`. Optionally cache the user's withdrawal IDs in DB for faster lookup.

### 4.3.4 Daily cap config modal

```
┌─ Daily Cap for 0x7A...3F9 ──────────────┐
│                                          │
│ Token: [USDC ▼]                          │
│                                          │
│ Current: 500 USDC/day                    │
│                                          │
│ ○ Use default (500 USDC/day)            │
│ ○ Custom: [_______] USDC/day            │
│ ○ Unlimited (no timelock, no cap)       │
│ ○ Disable withdrawals from this wallet  │
│                                          │
│ [Save] [Cancel]                          │
└──────────────────────────────────────────┘
```

**Encoded values:**
- Default → don't send tx (delete configuration if previously set... actually contract has no "delete" so call setWalletDailyCap with DEFAULT_DAILY_CAP)
- Custom → call `setWalletDailyCap(token, customAmount)`
- Unlimited → call `setWalletDailyCap(token, type(uint256).max)`
- Disable → call `setWalletDailyCap(token, 0)`

## 4.4 Updated existing pages

### 4.4.1 `/new-transfer` — recipient input rewrite

**File:** `frontend/app/new-transfer/page.tsx`

**Change Step 1:**
- Replace wallet address text field with **UUID paste field**.
- Add a recipient preview after paste (calls `GET /api/users/:uuid`):
  ```
  ┌─ Recipient ────────────────────────┐
  │ Maria S.                            │
  │ ✓ Verified merchant                 │
  │ [Wrong person? Clear]              │
  └─────────────────────────────────────┘
  ```
- Error states:
  - UUID format invalid → "Not a valid RemitSafe account ID"
  - UUID not found → "No account found"
  - Recipient has no linked wallet (for P2P) → "Recipient hasn't connected a wallet yet"
  - Recipient not KYC verified (for pledge) → "Recipient is not yet verified"

**Change `createPledge` call** (`frontend/app/merchant/transfers/requests/[id]/page.tsx`):
- Replace `req.sender_address` (wallet) with the resolved `payerAccountId` (derived from `req.sender_uuid`).
- The pledge_request table needs a `sender_uuid` column added.

### 4.4.2 `/profile` page

- Add **Account ID** section:
  ```
  Your Account ID
  7a3f9c12-4d8e-4b15-91f2-8c7d1e5b9a3f
  [📋 Copy] [📷 Show QR] [🔗 Share Link]
  ```
- Share link format: `https://remitsafe.app/send/{uuid}` — opens send page with recipient prefilled.
- Trust score display: read `getAccountTrustScore(accountId)` instead of `getTrustScore(wallet)`.

### 4.4.3 Trust score display refactor

Anywhere trust score is shown today (dashboard, profile, transaction confirmation):
- Change `await contract.getTrustScore(walletAddress)` to `await contract.getAccountTrustScore(accountId)`.
- Display unchanged: divide by 100, show as percentage.

### 4.4.4 Admin KYC page

**File:** `frontend/app/admin/kyc/page.tsx`

- Show account ID alongside user details.
- Approval action → backend route now handles single-tx-per-action.
- Add a small "linked wallets" panel showing all wallets currently linked to the account being reviewed.

### 4.4.5 Header / wallet picker

**Component update:**
- Replace the single "Connect Wallet" button with:
  - If not signed in: "Sign in"
  - If signed in, no linked wallets: "Connect your first wallet"
  - If linked wallets: dropdown showing all linked + active wallet, current balance

```
┌─ Active wallet ──────────────┐
│ ⭐ 0x7A...3F9                 │
│   USDC: 125.30                │
│ ─────────────────────────────│
│ 0x4B...821 (Cold)             │
│   USDC: 5,000.00              │
│ ─────────────────────────────│
│ + Add wallet                  │
│ ⚙ Manage wallets             │
└───────────────────────────────┘
```

## 4.5 P2P error handling

In `/new-transfer` when mode is P2P:
- Recipient input accepts either UUID or wallet address.
- If wallet address: call `contract.walletToAccount(address)` — if returns `bytes32(0)`, block with clear error:
  ```
  ⚠ This wallet isn't linked to a RemitSafe account.
  RemitSafe only allows sending to verified accounts.

  [Send to a different wallet]
  ```

## 4.6 Onboarding flow ("your wallet ≠ your account")

**New first-login modal:**

```
┌─ Welcome to RemitSafe ────────────────────────────────┐
│                                                        │
│ Important: your wallet is NOT your account.           │
│                                                        │
│ Your RemitSafe ACCOUNT identifies who you are.        │
│ Your WALLETS hold money on the blockchain.            │
│                                                        │
│ You can link multiple wallets to your account.        │
│ Money sent to you is held by RemitSafe in escrow      │
│ until you choose which wallet to withdraw it to.      │
│                                                        │
│ Why? Safety. If one wallet is hacked, your            │
│ other wallets and your reputation stay safe.          │
│                                                        │
│ [I understand — let's link my first wallet]           │
└────────────────────────────────────────────────────────┘
```

Show once on first sign-in. Re-trigger on `/wallets` for users who skipped.

## 4.7 Notification system updates

**File:** wherever notifications are shown in the UI.

Add new notification types:
- "Withdrawal queued — claimable in 1 hour" / "in 24 hours"
- "Wallet linked successfully"
- "Wallet unlinked — pending withdrawals from it have been cancelled"
- "Avatar boost applied — your trust score is now 60%"
- "Pledge defaulted — claim window closes in X days"

Backend pushes these via the event indexer (Phase 3.5). Frontend subscribes via Supabase realtime or polls every 30s.

## 4.8 Component checklist

| Component | New / Updated | Notes |
|---|---|---|
| `WalletContext.tsx` | Rewritten | Multi-wallet aware, accountId derivation |
| `Header.tsx` | Updated | Active wallet picker dropdown |
| `app/wallets/page.tsx` | New | Wallet manager |
| `app/withdraw/page.tsx` | New | Withdrawal flow |
| `app/withdrawals/pending/page.tsx` | New | Pending list with countdown |
| `app/profile/page.tsx` | Updated | Account ID display, trust score from account |
| `app/admin/kyc/page.tsx` | Updated | Show accountId, linked wallets |
| `app/admin/avatars/page.tsx` | New | Avatar spot-check review |
| `app/new-transfer/page.tsx` | Updated | UUID-based recipient, P2P validation |
| `app/merchant/transfers/requests/[id]/page.tsx` | Updated | accountId-based createPledge |
| Daily cap modal | New | Reused from wallet manager |
| Onboarding modal | New | First-login education |
| Notification system | Updated | New event types |

## 4.9 Frontend testing

For each user flow, test on Morph testnet end-to-end:

| Flow | Verify |
|---|---|
| Sign up + link first wallet | Account created, wallet linked, primary set |
| Link second wallet | Both show in manager, switching works |
| Try to link wallet linked elsewhere | Blocked with clear error |
| Receive a pledge → release to escrow | Balance appears in account, not wallet |
| Withdraw within cap | Instant transfer |
| Withdraw above cap | Queued with correct timelock |
| Cancel queued withdrawal | Funds return to balance |
| Wait for timelock + claim | Funds transfer to wallet |
| Unlink wallet with pending withdrawal | Claim auto-cancels |
| Panic unlink | All other wallets unlinked, survivor stays |
| P2P to linked recipient | Credited to their escrow |
| P2P to unlinked wallet | Blocked at input |
| KYC approval | Account flagged on-chain, all wallets work |
| Avatar upload | Boost applied automatically |
| Admin avatar revoke | Baseline drops to 5000 |
| Try to delete profile with balance | Blocked |

## 4.10 Phase 4 deliverables checklist

- [ ] ABI synced from new contract
- [ ] Contract address updated in `addresses.ts`
- [ ] WalletContext rewritten for multi-wallet
- [ ] `/wallets` page complete
- [ ] `/withdraw` page complete
- [ ] `/withdrawals/pending` page complete
- [ ] Daily cap config modal
- [ ] Panic unlink confirmation flow
- [ ] `/new-transfer` UUID-based recipient
- [ ] P2P unregistered-wallet error handling
- [ ] `/profile` showing account ID + copy/QR
- [ ] Trust score reads from `getAccountTrustScore`
- [ ] Admin KYC page updated
- [ ] Admin avatar spot-check page
- [ ] Onboarding modal for first-time users
- [ ] Header wallet picker
- [ ] Updated notification system
- [ ] All flows tested on testnet

---

# Phase ordering & dependencies

| Order | Phase | Depends on |
|---|---|---|
| 1 | Contract deployment | Phase 1 contract done ✅ |
| 2 | Phase 3.1 DB migration | Fresh testnet deploy |
| 3 | Phase 3.2 accountId helper | Phase 3.1 |
| 4 | Phase 3.3 endpoints | Phase 3.2 |
| 5 | Phase 3.4 keys | Independent — can be done in parallel |
| 6 | Phase 4 frontend | Phase 3.3 (needs endpoints) |
| 7 | End-to-end testing | All of above |

**Critical path:** DB migration → accountId helper → wallet endpoints → frontend wallet manager. The other items can interleave.

---

# Pre-deploy security fixes (from 2026-05-30 review)

The contract is clean; these are **off-chain** issues found during the security review. Fix
before relying on a deploy.

| # | Severity | Location | Issue | Fix |
|---|---|---|---|---|
| 1 | Blocker (fails safe) | `frontend/app/api/admin/kyc/[id]/route.ts` | KYC approval calls the contract with `wallet_address` instead of the UUID-derived `accountId`; on-chain verification never matches, so approved users can't transact. | Apply the §3.3.6 refactor — derive `accountId = deriveAccountId(profile.id)` and pass it to `setMerchantVerified` / `setVerificationBaseline`. |
| 2 | Medium | `frontend/lib/session.ts:35-37` | `sessionSecret()` falls back to `SUPABASE_SERVICE_ROLE_KEY` (and a hardcoded string) when `AUTH_SESSION_SECRET` is unset. The session HMAC then reuses the crown-jewel DB key; every cookie is an HMAC oracle over it, and the whole admin authz model trusts this one signature. | Require `AUTH_SESSION_SECRET` (non-empty) and **throw at boot if missing**; remove the service-role-key and hardcoded fallbacks. Rotate `SUPABASE_SERVICE_ROLE_KEY` (and `GMAIL_APP_PASSWORD`) if they've been on disk. Add `AUTH_SESSION_SECRET` to env docs. |
| 3 | Low (latent) | `frontend/app/api/profile/route.ts` + `frontend/lib/routes.ts:28` | GET/PATCH `/api/profile` has no auth and trusts a caller-supplied `address`. Currently mitigated only because it uses the anon Supabase client and `profiles` RLS denies the anon role — but it's an IDOR/PII leak the moment RLS, the client, or the auth model changes. | Add `verifySessionCookie` and scope to `session.userId` (mirror `/api/user/profile`), or delete this route. Stop treating all of `/api` as public in `routes.ts` — require explicit opt-in. |

Defense-in-depth (optional but recommended): re-verify the user's role against the DB on
admin actions rather than trusting the cookie role alone.

---

# Cutover plan (when ready to deploy)

1. **Pause v1 contract** (if it had any usage): call `pause()`.
2. **Deploy new contract** with constructor args:
   - `initialTokens = [USDC_ADDR, USDT_ADDR]`
   - `_feeRecipient = TREASURY_ADDR`
   - `_linkOperator = LINK_OPERATOR_WALLET`
   - `_verificationOperator = AVATAR_OPERATOR_WALLET`
3. **Set new contract address** in `frontend/contracts/addresses.ts`.
4. **Run DB migration** for `profile_wallets`.
5. **Run frontend build** and deploy.
6. **Manually verify** by running through the test plan in 4.9.
7. **Communicate to users** (testers): the contract has changed, they need to re-link wallets via the new flow.

---

# What's NOT in Phase 3/4

Out of scope for v1, to ship faster:

- ❌ Gas sponsorship via meta-transactions for `linkWallet` — defer to post-launch.
- ❌ Multi-token batched withdrawals — one token per call is fine.
- ❌ Account-to-account internal transfers without a pledge — use P2P or pledge.
- ❌ Full event indexer (basic on-demand reads work fine for testnet).
- ❌ Multisig owner key — single EOA acceptable for testnet, plan migration before mainnet.
- ❌ Two-factor / passkey authentication on RemitSafe profile — existing Supabase auth is fine.

---

# Open questions to confirm before starting

1. **`pledge_requests.sender_uuid` column** — does the current schema need this added, or do we already have a way to map a payment request to a user UUID?
2. **Existing pledges** — are there any active pledges on the current contract that need user communication before deploy, or is testnet clean?
3. **Withdrawal notification delivery** — push notification, email, or in-app banner? Determines event indexer scope.
4. **Operator wallet funding** — who tops up Morph ETH balances, and how often?
5. **Admin avatar review** — what's the criteria for revoking a boost? (Inappropriate, fake, low-quality, blank?)

Answer these in flight or before starting Phase 3.
