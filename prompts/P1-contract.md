Build on the attached FalaVault and DkimVerifier for Arc, with comprehensive Foundry tests, then deploy FalaVault to Arc Testnet.

Purpose: an AI agent spends USDC from a vault within a small automatic allowance; anything bigger becomes an intent that the human approves, denies or freezes by replying to an email. The contract verifies the Gmail DKIM signature (rsa-sha256, relaxed header canonicalization) on the reply's signed header block with RSA PKCS#1 v1.5 over the modexp precompile (OpenZeppelin RSA).

Hard constraints:
- Deposits are a payable deposit() using msg.value (18 decimals, a multiple of 1e12); store and pay out in 6-decimal units through the USDC ERC-20 interface at 0x3600000000000000000000000000000000000000. receive() reverts.
- Payouts use a low-level call to transfer and never revert the whole call; failure emits PayoutFailed.
- Agent policy outcomes never revert; they emit events. Email verification failures revert with the named custom errors.
- solc 0.8.28, OpenZeppelin 5.x Ownable2Step, ReentrancyGuard, RSA.

The attached contracts/FalaVault.sol, contracts/DkimVerifier.sol and test/FalaVault.t.sol are a working implementation (41 tests pass locally). Do NOT rewrite them from scratch. Your job:
1. Run forge test and report the result. The tests sign synthetic emails with a Node script via vm.ffi (script/sign-email.mjs, attached); if ffi is unavailable in your sandbox, say so and keep the tests as they are.
2. Run a security review (Slither + manual) focused on header parsing (line-start matching, duplicate headers, dkim-signature last, h= coverage), subject parsing, replay (intent reuse, FREEZE timestamps), code binding, key registry timelock/revocation, reentrancy, payout failure handling, and whether the relayer can influence any outcome. Fix real issues and add a test per fix.
3. Deploy FalaVault to Arc Testnet with constructor args: usdc 0x3600000000000000000000000000000000000000, owner = deployer, approver email "fala.approver.1@gmail.com", domain "gmail.com", selector "20260707", n = the hex in the attached context/gmail-n.txt, e = 0x010001. Report the address, tx hash and block.
Write findings to SECURITY_REVIEW.md.
