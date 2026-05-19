# RemittancePledge — Known Gaps & Improvement Areas

Identified after reviewing the contract against real-world OFW payment scenarios.
Ranked by production impact.

---

## 1. Locked Funds if Merchant Disappears ✅ Fixed

**Problem:** After a pledge defaults, the sender's deposit sits in the contract until the merchant calls `claimPartial()`. There is no upper time limit. If the merchant's wallet is lost, compromised, or unresponsive, the USDC is permanently locked with no recovery path.

**Fix implemented:** Added `UNCLAIMED_TIMEOUT = 180 days` constant and `reclaimDeposit(pledgeId)` function. If the merchant has not called `claimPartial()` within 180 days after the grace period ends, the sender can call `reclaimDeposit()` to recover their full deposit. The pledge is marked `DEFAULTED` and a default is recorded on the sender's reputation (they did miss the payment regardless of the merchant's absence).

---

## 2. DISPUTED Status is Declared but Never Used ✅ Fixed

**Problem:** The `PledgeStatus` enum includes `DISPUTED` but no function can set it and nothing resolves it. This is a dead code path that will raise questions in any security audit and is misleading to integrators reading the ABI.

**Fix implemented (Option A):** Removed `DISPUTED` from the `PledgeStatus` enum entirely. The enum is now `{ PENDING, COMPLETED, DEFAULTED }` — clean, honest, and audit-ready. A proper dispute flow can be added as a roadmap item post-hackathon.

---

## 3. New Senders Can Game the Deposit Tier ✅ Fixed

**Problem:** A brand-new sender qualifies for the 20% deposit tier (no history). `getRequiredDepositPct()` only checks resolved pledges (completed + late + defaulted), so mid-flight pledges do not affect the tier calculation. A bad actor can open many simultaneous pledges at 20% upfront and default on all of them before any resolve.

**Fix implemented:** Added `mapping(address => uint256) public activePledgeCount` and `getMaxActivePledges()`. `createPledge` now enforces the cap and increments the count; `_releaseFunds` and `claimPartial` decrement it on resolve/default.

| Trust Score | Max Active Pledges |
| ----------- | ------------------ |
| No history  | 2                  |
| 50–79%      | 3                  |
| 80%+        | 5                  |

---

## 4. Pledge Size is Not Weighted in Reputation ✅ Fixed

**Problem:** Defaulting on a ₱500 pledge and a ₱50,000 pledge both count as 1 default. A sender with 10 small on-time payments can default on one large pledge and only drop to ~91% score — far too lenient given the financial impact.

**Fix implemented:** Added `weightedScore` and `totalWeight` fields to the `Reputation` struct. On every resolve, `weightedScore += pledgeAmount * weight` and `totalWeight += pledgeAmount`. Score is now `weightedScore / totalWeight` — a default on ₱50,000 correctly outweighs 10 on-time ₱500 pledges. All three score-reading functions (`getReputation`, `getRequiredDepositPct`, `getMaxActivePledges`) now use the weighted calculation.

---

## 5. No Mutual Cancellation Path ✅ Fixed

**Problem:** If both Juan and Maria agree to cancel a pledge (e.g., the landlord accepts an alternate arrangement), there is no on-chain mechanism to do so. The deposit is trapped until default or completion. This forces unnecessary defaults that hurt the sender's reputation even in cooperative situations.

**Fix implemented:** Added `cancelPledge(pledgeId, merchantSig)` using the same ECDSA pattern as `extendDeadline`. The sender calls it with the merchant's off-chain signature approving the cancellation. On success: full deposit is returned to the sender, no reputation event is recorded, `activePledgeCount` is decremented, and pledge is marked `CANCELLED` (new status — distinct from `DEFAULTED`).

---

## 6. No Protocol Fee ✅ Fixed

**Problem:** The contract facilitates USDC transfers but retains nothing. There is no revenue model, which is a concern for long-term sustainability and a missed evaluation point for hackathon judges assessing business viability.

**Fix implemented:** Added `FEE_BPS = 100` (1%) constant and `feeRecipient` address (set at deployment). `_releaseFunds()` now deducts the fee before sending the remainder to the merchant. A `FeeCollected` event is emitted on every successful completion. Defaults are not charged — only successful pledges.

---

## Summary Table

| # | Issue                               | Severity | Effort to Fix              |
| - | ----------------------------------- | -------- | -------------------------- |
| 1 | Locked funds if merchant disappears | Done     | ✅ Implemented             |
| 2 | DISPUTED status unimplemented       | Done     | ✅ Implemented             |
| 3 | New sender deposit tier gaming      | Done     | ✅ Implemented             |
| 4 | Reputation ignores pledge size      | Done     | ✅ Implemented             |
| 5 | No mutual cancellation              | Done     | ✅ Implemented             |
| 6 | No protocol fee                     | Done     | ✅ Implemented             |

---

## What to Address for Hackathon Submission

- **Do now:** Remove or stub `DISPUTED` cleanly (Issue #2) — judges and auditors will read the code.
- **Mention in pitch:** Issues #1 and #3 as known risks with planned mitigations — shows security awareness.
- **Nice to have:** Issue #6 (protocol fee) strengthens the business model narrative.
