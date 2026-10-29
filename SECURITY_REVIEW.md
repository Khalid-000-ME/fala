# FalaVault / DkimVerifier security review

Scope: `contracts/FalaVault.sol`, `contracts/DkimVerifier.sol` (solc 0.8.28, OpenZeppelin 5.6.1, Arc Testnet 5042002).
Method: Slither, manual review of the focus areas you listed, plus two independent automated reviews at the deepest tier.
This is a best-effort review, not a substitute for a paid third-party audit.

## Test result

`forge test`: **63 passed, 0 failed, 1 skipped** (64 total). Your 41 original tests all still pass; 22 new ones were added.

- ffi works in this sandbox. Tests sign synthetic emails with `script/sign-email.mjs` through `vm.ffi`, using throwaway RSA keys.
- The skipped test is `test_T31_realGmailFixture`: it needs `contracts/test/fixtures/gmail-real.json`, which is not in the project.
  **Nothing here has been verified against a real Gmail-signed message.** Capture one before trusting this on real funds.
- Layout fixes needed to run at all: the test moved to `contracts/test/` (this project's `foundry.toml` has `test = "contracts/test"`),
  and its imports changed from `../src/...` to `../...`. `foundry.toml` gained `ffi = true` and a read permission for the fixtures folder.
- Runtime size is 23,013 bytes (limit 24,576). Little headroom is left for more features.

## Gmail key check

The modulus in `context/gmail-n.txt` was compared with the live DNS record `20260707._domainkey.gmail.com`:
**exact match**, 2048-bit, e = 65537.

## Findings fixed (each has a regression test that fails on the old code)

| # | Severity | Issue | Fix | Test |
|---|----------|-------|-----|------|
| 1 | High | `From` parsing took the last `<` anywhere in the value. An address placed in a comment, e.g. `mallory@gmail.com (<approver@gmail.com>)`, or a second mailbox after a comma, was read as the sender. A different Gmail user could pass the approver check if Gmail signs such a header (not confirmed here). | Quote-aware parser: no comments, no lists, one `<...>` that must end the value. | S1 |
| 2 | Medium | APPROVE and DENY skipped the "signed after the intent existed" check when the signature had no `t=`. | Missing `t=` is refused (`StaleTimestamp`). | S2 |
| 3 | Medium | FREEZE had no freshness bound. A withheld freeze email could be applied months later, and a far-future `t` could block all real freezes. | Must be newer than the last freeze, at most 1 day old, at most 5 minutes in the future. | S3 |
| 4 | Medium | The FREEZE subject (`FALA FREEZE 0 0`) named no vault or chain, so one email froze every vault sharing the approver and key. | FREEZE now carries a code bound to chain and vault: `subjectFor(0, 3)` returns `FALA FREEZE 0 <code>`. **This changes the email format**; read it from `subjectFor` or `freezeCode()`. | S17 |
| 5 | Medium | `renounceOwnership` was live. It would strand funds and make `unfreeze` and key revocation impossible. | Disabled (`RenounceDisabled`); two-step transfer still works. | S18 |
| 6 | Low | `withdraw` reverted on token failure, against your "payouts never revert" rule. | Uses the same low-level payout; emits `PayoutFailed`, and `Withdrawn` only on success. Access control still reverts. | S19 |
| 7 | Low | Auto-pay failure emitted only `IntentRejected(5)`, and a failed relayer tip emitted nothing. | Both now emit `PayoutFailed`. Auto-pay state is updated before the transfer and rolled back on failure. | S5, S6 |
| 8 | Low | `setApprover` accepted a domain whose keys were all revoked or still in the timelock. | Requires a registered, active, non-revoked key. | S20 |
| 9 | Low | Constructor accepted a USDC address with no code; a call to it "succeeds" silently. | Reverts `InvalidConfig`. | S4 |
| 10 | Info | `checkEmail` NatSpec claimed identical behaviour to `approveByEmail`; for an expired intent it reverts while execution closes the intent. | Documented as the one deliberate difference. | T28 |

Slither's only medium after fixes is `locked-ether`. It is a false positive on Arc: native and ERC-20 USDC are one pool
(checked live: native balance = ERC-20 balance x 1e12 for the same address), so `withdraw` moves deposited funds.
On a chain without that property, deposits would be stuck.

## Focus areas, as reviewed

- **Line-start matching:** only a line that begins with `from:` or `subject:` counts, so `x-from:` and `subject:x from:...` do nothing (T22, S10a).
  Relaxed canonicalization unfolds values, so a CRLF always separates two headers. Bare CR or LF is rejected (S10b).
- **Duplicates:** two `from`, two `subject`, or any `dkim-signature` line before the last one is refused (T21, S10a).
- **dkim-signature last:** a missing or non-final signature line, or a block ending in CRLF, is refused (T23, S10b).
- **h= coverage:** `from` and `subject` must be listed, matched case-insensitively (T25, S10c). Duplicate tags, an unemptied `b=`, and look-alike tags such as `bh=` are handled (`test_malformedTags`).
- **Signature scope:** the RSA check covers the whole block, so the relayer cannot add, drop, or reorder a line without breaking it.
  OpenZeppelin's RSA enforces 2048+ bits, signature < modulus, and strict PKCS#1 v1.5 padding.
- **Subject parsing:** strict grammar, no leading zeros, at most 18 digits, 8 lowercase hex, one optional `Re:` (T20, S11).
- **Replay:** an intent is single-use (T12, S12). The code covers chain, vault, id, agent, payee, and amount, so an email cannot move to another intent, vault, or chain (T19, S15).
- **Key registry:** timelock is exact to the second, revocation is immediate and owner-only (S14).
- **Reentrancy:** `approveByEmail`, `request`, and `withdraw` are guarded; a token that re-enters during payout is rejected, and the payout lands once (S7).
- **Payout failure:** a failed transfer never reverts the call; it emits `PayoutFailed` (T29, S5, S6, S19).
  An approved intent that cannot pay becomes `FAILED` (terminal).
- **Gas starvation:** a relayer cannot under-gas the call to force `FAILED`. The outer call needs about 8k gas after the transfer, which requires about 500k handed to the token; a USDC transfer needs far less, so a starved call reverts instead (S9 sweeps gas limits).

## Can the relayer influence an outcome?

No outcome, only timing. Anyone can submit a valid email and the result is identical (fuzzed in S8); only the tip recipient changes.
A relayer can still: delay or withhold an email (an intent then expires), choose which of two conflicting valid emails lands first
(APPROVE vs DENY for the same intent: first one wins), and be front-run for the tip (at most 0.05 USDC).

## Residual risks and design notes (not changed)

1. **The code is not a secret.** It is a public function of on-chain data. Anyone can email the approver a message whose subject is `FALA APPROVE <id> <code>`; if the approver replies, that reply is a valid approval. The approver must check amount and payee on-chain or in the official notification, not trust the subject.
2. **`FAILED` is terminal.** An underfunded vault at approval time burns that approval; the agent must request again.
3. **Not enforced:** DKIM `x=` expiry and the body hash `bh=`. Neither matters for the headers-only design, but a signature never expires on its own; the time windows above are the only freshness control.
4. **Multiple `From` headers** in the original message are resolved by Gmail's `h=` selection, which does not oversign. The contract relies on Gmail rejecting such messages.
5. **Owner is fully trusted:** it can withdraw everything, so the key timelock is a notice period for the approver, not a protection from the owner.
6. **Selector rotation:** Gmail rotates selectors. Propose the new key at least a day ahead (`keyTimelock`), or approvals fail with `UnknownKey`.
7. Skipped on purpose: revert-data parameters on custom errors (a diagnostics nicety), and `Unfrozen(address)` indexing.

## Deployment

See the chat summary for the result.
