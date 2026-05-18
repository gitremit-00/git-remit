# RemittancePledge — Known Gaps & Improvement Areas

Identified after reviewing the contract against real-world OFW payment scenarios.
Ranked by production impact.

---

## 1. Locked Funds if Merchant Disappears (Critical)

**Problem:** After a pledge defaults, the sender's deposit sits in the contract until the merchant calls `claimPartial()`. There is no upper time limit. If the merchant's wallet is lost, compromised, or unresponsive, the USDC is permanently locked with no recovery path.

**Recommended Fix:** Add a protocol-owned timelock — e.g., 180 days after the grace period ends, an admin multisig or governance contract can sweep unclaimed deposits to a treasury or return them to the sender minus a penalty fee.

---

## 2. DISPUTED Status is Declared but Never Used

**Problem:** The `PledgeStatus` enum includes `DISPUTED` but no function can set it and nothing resolves it. This is a dead code path that will raise questions in any security audit and is misleading to integrators reading the ABI.

**Option A (quick):** Remove `DISPUTED` from the enum entirely.

**Option B (proper):** Implement a minimal dispute flow:

- Either party can call `flagDispute(pledgeId)` before the grace period ends
- Funds are frozen while status is `DISPUTED`
- A designated arbitrator address (multisig) calls `resolveDispute(pledgeId, recipientAddress)` to release funds

---

## 3. New Senders Can Game the Deposit Tier

**Problem:** A brand-new sender qualifies for the 20% deposit tier (no history). `getRequiredDepositPct()` only checks resolved pledges (completed + late + defaulted), so mid-flight pledges do not affect the tier calculation. A bad actor can open many simultaneous pledges at 20% upfront and default on all of them before any resolve.

**Recommended Fix:** Add a cap on concurrent active pledges per sender, scaled by trust tier:

| Trust Score | Max Active Pledges |
| ----------- | ------------------ |
| No history  | 2                  |
| 50–79%      | 3                  |
| 80%+        | 5                  |

Track active count with a `mapping(address => uint256) public activePledgeCount` and increment/decrement on create and resolve.

---

## 4. Pledge Size is Not Weighted in Reputation

**Problem:** Defaulting on a ₱500 pledge and a ₱50,000 pledge both count as 1 default. A sender with 10 small on-time payments can default on one large pledge and only drop to ~91% score — far too lenient given the financial impact.

**Recommended Fix:** Weight reputation events by USDC amount instead of pledge count. Store a running `weightedScore` and `totalWeight` (in USDC) per sender and derive the percentage from those instead of counts.

---

## 5. No Mutual Cancellation Path

**Problem:** If both Juan and Maria agree to cancel a pledge (e.g., the landlord accepts an alternate arrangement), there is no on-chain mechanism to do so. The deposit is trapped until default or completion. This forces unnecessary defaults that hurt the sender's reputation even in cooperative situations.

**Recommended Fix:** Add `cancelPledge(pledgeId)` that requires off-chain signatures from both sender and merchant (ECDSA, same pattern as `extendDeadline`). On success, return the full deposit to the sender and do not record a reputation event.

---

## 6. No Protocol Fee

**Problem:** The contract facilitates USDC transfers but retains nothing. There is no revenue model, which is a concern for long-term sustainability and a missed evaluation point for hackathon judges assessing business viability.

**Recommended Fix:** Collect a small fee (e.g., 0.5–1%) on `_releaseFunds()` when a pledge completes successfully. Send the fee to an `owner` or `feeRecipient` address set at deployment. Only charge on completion — not on defaults — to avoid penalizing already-harmed merchants.

---

## Summary Table

| # | Issue                               | Severity | Effort to Fix              |
| - | ----------------------------------- | -------- | -------------------------- |
| 1 | Locked funds if merchant disappears | High     | Medium                     |
| 2 | DISPUTED status unimplemented       | Medium   | Low (remove) / High (impl) |
| 3 | New sender deposit tier gaming      | Medium   | Low                        |
| 4 | Reputation ignores pledge size      | Medium   | Medium                     |
| 5 | No mutual cancellation              | Low      | Medium                     |
| 6 | No protocol fee                     | Low      | Low                        |

---

## What to Address for Hackathon Submission

- **Do now:** Remove or stub `DISPUTED` cleanly (Issue #2) — judges and auditors will read the code.
- **Mention in pitch:** Issues #1 and #3 as known risks with planned mitigations — shows security awareness.
- **Nice to have:** Issue #6 (protocol fee) strengthens the business model narrative.
