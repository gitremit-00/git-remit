# Testing Guide

This project uses three testing tools, each covering a different layer of contract verification.

```text
test/
├── hardhat/    — unit & integration tests (JavaScript)
├── foundry/    — fuzz tests (Solidity)
└── slither/    — static analysis (Python)
```

---

## Hardhat

**What it does:** Unit and integration tests. Covers every function, revert path, event, and reputation logic in the contract.

**Role model:** Identity is account-keyed — a `bytes32 accountId` derived off-chain from the RemitSafe profile UUID. Wallets are linked to accounts via `linkWallet` (co-signed by the link operator); one account may own several wallets. Merchants create pledges targeting a payer (OFW) account. The payer fulfils the pledge by calling `submitDeposit` from any linked wallet. Merchant and P2P receipts are credited to an account-held escrow balance and withdrawn to a linked wallet under tiered timelocks. This is the core cross-border remittance flow — the merchant invoices, the OFW pays.

### Setup

```bash
npm install
```

### Commands

```bash
# Run all tests
npx hardhat test

# Run a specific feature group
npx hardhat test --grep "linkWallet"
npx hardhat test --grep "unlinkWallet"
npx hardhat test --grep "panicUnlink"
npx hardhat test --grep "createPledge"
npx hardhat test --grep "submitDeposit"
npx hardhat test --grep "claimDefaultedDeposit"
npx hardhat test --grep "reclaimDeposit"
npx hardhat test --grep "extendDeadline"
npx hardhat test --grep "cancelPledge"
npx hardhat test --grep "withdraw"
npx hardhat test --grep "setWalletDailyCap"
npx hardhat test --grep "sendP2P"
npx hardhat test --grep "createRecurringPledge"
npx hardhat test --grep "payInstallment"
npx hardhat test --grep "markMissedInstallment"
npx hardhat test --grep "settleDebt"
npx hardhat test --grep "cancelRecurring"
npx hardhat test --grep "admin"
npx hardhat test --grep "recurring pledge reputation"
npx hardhat test --grep "views and fee tiers"

# Run a specific test by name
npx hardhat test --grep "completes the pledge when full gross is deposited"

# Run a specific test file
npx hardhat test test/hardhat/RemittancePledge.test.js

# Gas report per function (PowerShell)
$env:REPORT_GAS="true"; npx hardhat test

# Coverage report
npx hardhat coverage
```

### Expected output (Hardhat)

```text
277 passing
```

### Expected coverage

| File                 | Statements | Branches | Functions | Lines |
| -------------------- | ---------- | -------- | --------- | ----- |
| RemittancePledge.sol | 100%       | ~89%     | 100%      | 100%  |
| MockTokens.sol       | 100%       | 100%     | 100%      | 100%  |

Statements, functions, and lines are fully covered. The ~11% of uncovered **branches** are
all accounted for and fall into two buckets — neither is a coverage gap worth closing:

1. **Per-function modifier negative paths.** Every external function carries
   `whenNotPaused` (and most carry `nonReentrant`); admin functions carry `onlyOwner`.
   solidity-coverage counts the revert side of each of these per call site. The modifiers
   themselves are OpenZeppelin-audited and each is exercised at least once (e.g. `admin`
   tests confirm pause blocks `createPledge` and non-owners are rejected); we don't
   re-assert every function's paused / reentrant / non-owner revert individually.
   `nonReentrant`'s revert side in particular is not reachable without a malicious
   re-entering token, which the unit suite doesn't model.

2. **Defensive guards made unreachable by other invariants:**
   - `if (fee > 0)` in the installment/P2P paths — `fee = amount * feeBps / 10000` with a
     `MIN_PLEDGE_AMOUNT` of 1e6 and a minimum 75 bps fee is always ≥ 7500, so the
     zero-fee branch never executes.
   - `AllPeriodsAccounted` in `payInstallment` / `markMissedInstallment` — the preceding
     `status == ACTIVE` check fires first, since finalizing the last period flips the
     status away from `ACTIVE`.
   - the `refundTo == address(0)` fallback in `reclaimDeposit` — a non-zero deposit
     (required to reach it) guarantees a recorded `depositingWallet`.
   - the `periodsCompleted == 0` branch of `_finalizeRecurring`'s no-debt path — reaching
     it with zero debt implies all periods were completed, so `periodsCompleted > 0`.

Run `npx hardhat coverage` for the current figures. On Windows the run may end with a
harmless libuv `async.c` assertion *after* the reports are written — it's a Node teardown
race, not a failure (run under WSL to avoid it).

### Note: Stack Too Deep on Coverage

If you see this error when running coverage:

```text
CompilerError: Stack too deep. Try compiling with `--via-ir`
```

Make sure `viaIR: true` is set in `hardhat.config.js` under `solidity.settings`:

```javascript
settings: {
  optimizer: { enabled: true, runs: 200 },
  viaIR: true,
  evmVersion: "cancun",
}
```

This is already configured in the project. `viaIR` enables the intermediate representation pipeline which handles deep stack contracts and is safe to leave on permanently.

---

## Foundry

**What it does:** Fuzz tests and invariant tests. Fuzz tests run randomized inputs against critical math properties. Invariant tests run random sequences of contract calls and verify core guarantees hold across all combinations.

### Foundry Setup

**On Windows, Foundry requires WSL (Windows Subsystem for Linux).** Install via WSL:

```bash
wsl bash -c "curl -L https://foundry.paradigm.xyz | bash"
wsl bash -c "~/.foundry/bin/foundryup"
```

Verify installation:

```bash
wsl bash -c "~/.foundry/bin/forge --version"
```

### Fuzz and Invariant Commands

All forge commands on Windows must be run through WSL:

```bash
# Run all fuzz tests
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test"

# Run with verbosity (shows test names)
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test -v"

# Run with full trace on failure
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test -vvvv"

# Run a specific test file
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test --match-path test/foundry/RemittancePledge.fuzz.t.sol"

# Run a specific test function
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test --match-test testFuzz_completionConservesMoney"

# Run with a custom fuzz seed (for reproducibility)
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test --fuzz-seed 12345"

# Run only fuzz tests
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test --match-path test/foundry/RemittancePledge.fuzz.t.sol -v"

# Run only invariant tests
wsl bash -c "cd '/mnt/c/Users/new user/git-remit' && ~/.foundry/bin/forge test --match-path test/foundry/RemittancePledge.invariant.t.sol -v"
```

> Fuzz runs are configured in `foundry.toml` — **1000 runs** per fuzz test, **64 runs × 30 depth** per invariant test.
>
> Invariant tests take longer (1-3 min) — the fuzzer builds random sequences of contract calls and checks guarantees after every step.

### Fork Commands

Fork tests run against the live Morph testnet **token** deployments.

> **Note:** The v2 RemittancePledge is account-keyed — every wallet must be linked to an
> account via an operator-co-signed `linkWallet` call before it can transact, and the
> production link-operator key is not available to the test runner. So the fork tests
> deploy a **fresh** RemittancePledge (with a test-controlled operator) on the fork and
> exercise the v2 flows against the **real forked MockUSDC / MockUSDT** contracts. Update
> `USDC_ADDR` / `USDT_ADDR` in `test/foundry/RemittancePledge.fork.t.sol` to match the
> current Morph deployment before running.

**Forked token addresses (Morph Holesky):**

| Contract | Address                                      |
| -------- | -------------------------------------------- |
| MockUSDC | `0x165186FCF4b2c145bEA0073ef3cb1f2b1F3837da` |
| MockUSDT | `0xb49a61765a05fE938491507e3A02873ACD4cD8dc` |

**Note:** WSL may have DNS issues resolving the RPC URL. If you get a DNS error, fix it first:

```bash
wsl bash -c "echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf"
```

Then run the fork tests:

```bash
wsl bash -c "cd /mnt/c/Users/<your-username>/git-remit && ~/.foundry/bin/forge test --match-path test/foundry/RemittancePledge.fork.t.sol --fork-url https://rpc-hoodi.morph.network -v"
```

### Gas Snapshot Commands

Records gas usage per test as a baseline. Diffs on subsequent runs to catch regressions.

```bash
# Create or update the baseline snapshot
wsl bash -c "cd /mnt/c/Users/<your-username>/git-remit && ~/.foundry/bin/forge snapshot --match-path test/foundry/RemittancePledge.fuzz.t.sol"

# Check for gas regressions without updating the baseline
wsl bash -c "cd /mnt/c/Users/<your-username>/git-remit && ~/.foundry/bin/forge snapshot --match-path test/foundry/RemittancePledge.fuzz.t.sol --diff"
```

> Baseline is stored in `.gas-snapshot` at the project root. Commit this file so the diff is tracked across changes.

### Expected output (Foundry)

```text
Ran 6 tests for test/foundry/RemittancePledge.fuzz.t.sol
[PASS] testFuzz_completionConservesMoney(uint256)
[PASS] testFuzz_depositPctAlwaysValidTier(bytes32)
[PASS] testFuzz_escrowBalanceMatchesDeposit(uint256,uint256)
[PASS] testFuzz_feeBpsAlwaysValidTier(bytes32)
[PASS] testFuzz_grossNeverBelowNet(uint256)
[PASS] testFuzz_grossNoOverflow(uint256)

Ran 5 tests for test/foundry/RemittancePledge.invariant.t.sol
[PASS] invariant_completedPledgeHasZeroDeposit()
[PASS] invariant_contractBalanceMatchesFlow()
[PASS] invariant_depositNeverExceedsGross()
[PASS] invariant_noUnaccountedBalance()
[PASS] invariant_pledgeIdsAreSequential()

Ran 10 tests for test/foundry/RemittancePledge.fork.t.sol
[PASS] test_fork_createAndCompletePledgeUSDC()
[PASS] test_fork_createAndCompletePledgeUSDT()
[PASS] test_fork_feeIsDeducted()
[PASS] test_fork_feeRecipientIsSet()
[PASS] test_fork_operatorsAreSet()
[PASS] test_fork_pledgeCounterStartsAtZero()
[PASS] test_fork_usdcDecimals()
[PASS] test_fork_usdcIsWhitelisted()
[PASS] test_fork_usdtDecimals()
[PASS] test_fork_usdtIsWhitelisted()
```

---

## Slither

**What it does:** Static analysis. Scans the contract source for common Solidity vulnerabilities without executing any transactions.

### Slither Setup

Requires Python 3.8+.

```bash
pip install slither-analyzer
```

### Slither Commands

```bash
# Full analysis using hardhat as compiler
slither . --compile-force-framework hardhat

# Clean run using project config (filters node_modules noise)
slither . --compile-force-framework hardhat --config-file .slither.config.json

# Access control audit — shows who can call what
slither . --compile-force-framework hardhat --print vars-and-auth

# Contract summary — lines of code, assembly, features
slither . --compile-force-framework hardhat --print human-summary

# Save results to file
slither . --compile-force-framework hardhat --config-file .slither.config.json --json test/slither/results.json
```

> The `--compile-force-framework hardhat` flag is required because `foundry.toml` exists in the project root. Without it, Slither tries to use Forge which may not be installed.

### Notes

- All findings from `node_modules/@openzeppelin` are false positives — ignore them entirely
- The `timestamp` detector on `RemittancePledge.sol` is expected and safe. Every time-based function (deadlines, grace periods, claim windows) must compare against `block.timestamp`. There is no alternative. (Excluded by the config.)
- The operator setters/params (`linkOperator`, `verificationOperator`, `setLinkOperator`, `setVerificationOperator`) would otherwise raise `missing-zero-check`, but a zero operator address is an **intentional** "disabled" state — `linkOperator == address(0)` disables `linkWallet` (the `LinkingDisabled` revert path) and `verificationOperator == address(0)` disables `boostVerificationBaseline`. The constructor documents passing `address(0)` to disable an operator until later. These four spots carry inline `// slither-disable-next-line missing-zero-check` suppressions with a rationale comment, so a zero-check is not added (it would break the feature).
- Known suppressions are applied inline in the contract with `// slither-disable-next-line` (the `timestamp` comparisons and the four operator zero-checks above)
- The config file `.slither.config.json` at project root excludes node_modules, informational, and optimization findings automatically

### Contract summary (`--print human-summary`)

```text
Total contracts in source files : 1
Contracts in dependencies       : 23
Contracts in tests              : 3
SLOC (source files)             : 1132
SLOC (dependencies)             : 2072
Assembly lines                  : 0
Optimization issues             : 0
Informational issues            : 59   ← all from node_modules
Low issues                      : 19   ← all from node_modules (project zero-checks suppressed inline)
Medium issues                   : 9    ← all from node_modules
High issues                     : 1    ← all from node_modules
```

| Name             | Functions | Complex code | Features  |
| ---------------- | --------- | ------------ | --------- |
| RemittancePledge | 86        | Yes          | Ecrecover |

The high/medium issues are all from OpenZeppelin dependencies. `RemittancePledge.sol` itself has no actionable findings — the intentional `missing-zero-check` and `timestamp` items are suppressed inline (see Notes).

### Clean run result

Running `slither . --compile-force-framework hardhat --config-file .slither.config.json` produces **0 findings** from project contracts after filters and inline suppressions are applied. Raw output (without the config) will still show `timestamp` warnings from `RemittancePledge.sol` — these are intentional and not actionable.

---

## Running All Three Together

```bash
# 1. Hardhat — unit tests
npx hardhat test

# 2. Foundry — fuzz and invariant tests
wsl bash -c "cd '/mnt/c/Users/<your-username>/git-remit' && ~/.foundry/bin/forge test -v"

# 3. Slither — static analysis
slither . --compile-force-framework hardhat --config-file .slither.config.json
```

All three should pass before merging or deploying.
