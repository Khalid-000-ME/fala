# Fala — DoraHacks submission copy

Copy-paste into the submission form. Three blocks: tagline, brief, detailed description.

---

## Tagline (one line)

**Approve your AI agent's payments by replying to an email. Arc verifies Google's signature on-chain.**

---

## Project brief (short description)

Fala gives an AI agent a vault it can spend from on its own, up to limits you set. Anything bigger becomes a request
that arrives as an ordinary email. You reply "approve" from Gmail — and that reply *is* the signature. The Fala contract
holds Google's public DKIM key and verifies the RSA-2048 signature on your reply **directly on-chain**, no
zero-knowledge circuit, for about a cent on Arc, before any money moves.

No wallet app. No seed phrase. No dashboard for the human. If you can reply to an email, you can approve a payment.

A prompt-injected agent can write any email it wants. It cannot make Google sign one from you.

**Live on Arc mainnet:** [`0xE20D31af287e546A35897FD65a822f3dEF7FA008`](https://explorer.arc.io/address/0xE20D31af287e546A35897FD65a822f3dEF7FA008)
· **App:** https://fala-approve.vercel.app · **Code:** https://github.com/Khalid-000-ME/fala

---

## Detailed description

### The problem

Every tool builds its own front door. A dashboard to check, an app to install, an extension to approve in, a wallet to
sign with. Each one assumes you will come to it.

Now give an AI agent a budget. There are two options, and both are bad:

- **Give it a card.** It spends without asking. You find out afterwards.
- **Put a human in front of a wallet.** Every purchase needs someone to open an app, read a hex string, and sign. The
  agent's speed is gone.

So most teams let agents do everything *except* spend money. The blocker is not capability — it is **consent**. There is
no way for a human to say "yes, that one" that is both fast and safe.

Meanwhile, one interface was never fragmented. Around **4.6 billion people** use email, sending roughly **376 billion
messages a day**. Nobody needs onboarding to reply to an email. And agents already live in the inbox — the invoices,
quotes and confirmations they act on arrive there. The channel is already shared. It was simply never used for the one
thing that matters: permission.

### What Fala does

An agent gets a vault with an automatic allowance. Under the limit, it just pays. Over the limit, it has to ask — and
asking means an email to you.

1. The agent calls `request(payee, amount, memo)`. Within its allowance and to a known payee, it is paid instantly.
2. Otherwise the vault stores an **intent** with a binding code and emits `IntentCreated`. The relay emails the approver.
3. The email's buttons open a reply with the subject pre-filled: `FALA APPROVE 42 7f3a9c1b`. The human presses Send.
4. **Gmail DKIM-signs that reply on the way out.** The relay verifies the signature locally, dry-runs `checkEmail` so no
   gas is wasted on junk, then submits `approveByEmail`.
5. The contract recomputes `sha256(headerBlock)`, verifies Google's RSA signature against the registered key, and
   requires `From == approver`, `From domain == d=`, the subject code to match this exact intent, and a fresh signing
   time — then pays.

Only header lines inside the block Google signed are trusted. Never the body. Never anything the relay adds. The relay
cannot alter the payee or amount: both come from the intent already stored on-chain.

### Why this is safe

The security argument is one sentence: **a prompt-injected agent can write any email it wants, but it cannot make
Google sign one from you.**

The signature is produced by Google's DKIM private key, at send time, over your headers. The contract holds Google's
public key and does the RSA-2048 verification itself, inside the transaction. This is *zk-email without the zk* — no
circuits, no prover, no trusted setup.

Failed verification reverts with a **named error**, and each one has a test behind it: `BadSignature`,
`FromNotApprover`, `DomainMismatch`, `CodeMismatch`, `IntentNotPending`, `StaleTimestamp`, `SubjectMalformed`,
`DuplicateHeader`, `MissingHeader`, `DkimNotLast`, `HeaderNotSigned`, `WrongAlgorithm`, `WrongCanonicalization`,
`UnknownKey`, `KeyRevoked`, `KeyNotActive`, `Frozen`, `IntentExpired`. Replay, header injection, cross-vault reuse and
key-rotation attacks are each refused by name.

### Why Arc

Fala is only possible because of what Arc makes cheap.

- **RSA-2048 on the modexp precompile.** One approval costs **533,230 gas ≈ 0.011 USDC**, measured on-chain with a real
  Gmail message. That is what makes direct signature verification viable where a ZK circuit would otherwise be required.
  On a chain with ordinary gas economics, this design simply would not ship.
- **USDC is the gas token.** The thing you approve and the thing that pays the fee are the same unit. No second token to
  hold, no swap between approving and paying — which matters enormously when the user is a person in an inbox who has
  never held crypto.
- **Deployment is cheap enough to give every user their own contract.** A vault costs **0.1116 USDC** to deploy, so
  per-user isolation is the default rather than a premium tier.
- **Fast finality** lets the "Payment sent" receipt land in the same email thread while the person is still reading it.

### How Arc Studio was used

The contracts were written locally, then taken through Arc Studio for review and deployment
([project `7b5f36e6`](https://studio.arc.io/app/7b5f36e6-a2d1-4ccc-b925-f3cf4a4bd39b)). Three runs, with the exact
prompts and full transcripts committed in `prompts/` and `docs/studio-runs/`:

1. **Review and harden.** Studio ran the Foundry suite plus a Slither and manual security review, focused on header
   parsing, replay, code binding, the key-registry timelock, reentrancy and payout-failure handling. It fixed real
   findings and **added 22 regression tests**, taking the suite from 41 to 63 passing. Findings are written up in
   `SECURITY_REVIEW.md`.
2. **Deploy to testnet.** Studio rebuilt, reran the suite, and deployed with the owner passed explicitly as a
   constructor argument rather than defaulting to the deployer.
3. **Verify.** Studio confirmed `owner()` on-chain, confirmed `approverHash` equalled `keccak256` of the lowercased
   approver address, and reported the exact strings `subjectFor` returns so the email templates could not drift from the
   contract.

One moment is worth recording. In run 2, Studio **refused to deploy**. The platform masked the approver address in what
it could see, so it received the literal text `[REDACTED_EMAIL]` — and it would not guess a value that gets hashed into
the constructor and cannot be changed afterwards without an owner transaction. It stopped and asked. That is the
behaviour you want from a tool that holds a deploy key.

### Proof it works

| | |
|---|---|
| **FalaVault on Arc mainnet** | [`0xE20D31af287e546A35897FD65a822f3dEF7FA008`](https://explorer.arc.io/address/0xE20D31af287e546A35897FD65a822f3dEF7FA008) |
| **Deploy tx** | [`0x19f32caa…ab72`](https://explorer.arc.io/tx/0x19f32caa0fb3c4f9f1b33e1546711afa5ad4d7392c34cdef3546fb2e5df7ab72), block 29095348 |
| **DKIM key registered** | `gmail.com` selector `20260707` — Google's **real production key**, 2048-bit |
| **A real Gmail reply released real money** | [`0x8fbe3ea6…f3adb`](https://explorer.testnet.arc.io/tx/0x8fbe3ea6ed2ebd2e576711ac2efa8188b81d3fe588d86d3b06d2bc889e1f3adb) — 2.00 USDC |
| **Tests** | 64 contract tests (fuzz, reentrancy, a real-Gmail fixture) · 17 relay tests |
| **Live app** | https://fala-approve.vercel.app |
| **Code** | https://github.com/Khalid-000-ME/fala |

Anyone can verify the mainnet deployment without trusting us:

```bash
V=0xE20D31af287e546A35897FD65a822f3dEF7FA008; R=https://rpc.mainnet.arc.io
cast call $V "approverHash()(bytes32)" --rpc-url $R   # 0xca56b56b…3d0c
cast keccak "fala.approver.1@gmail.com"               # the same value
cast call $V "getKeyIds()(bytes32[])" --rpc-url $R    # 0x15234f80…712b
dig +short TXT 20260707._domainkey.gmail.com          # Google's key, same modulus
```

The last line is the point: the key the contract verifies against is the one Google publishes in DNS, byte for byte.

### What is built

```
contracts/   DkimVerifier + FalaVault (Foundry, 64 tests)
src/         Next.js app — vaults, agents, requests, payees, activity
server/      API + mail relay (Hono, SQLite), deployed on Fly
worker/      Cloudflare Email Worker variant of the relay, with its own tests
agent/       Groq agent + fala-mcp MCP server, so Claude/ChatGPT/Cursor can hold a budget
```

Sign in with Google, and an embedded wallet is created for you. Create a vault — a real contract deployment, not a
database row. Fund it in USDC. Connect an agent and set its ceiling: per payment, per day, and a largest-request line it
cannot even ask above. From then on the human does nothing until an email arrives.

### Honest limits

- **Privacy:** the approval transaction carries email headers (From, To, Subject, Date) in calldata, readable by anyone.
  Use a dedicated Gmail. The message body is never sent on-chain.
- **Gmail only:** the From domain must equal the DKIM `d=`, which limits approvers to Gmail addresses today.
- **Key rotation:** Google rotates DKIM keys. New keys go through a timelock, old keys can be revoked instantly, and if
  Google rotates before a new key is registered, approvals **fail closed** rather than open.
- **Trust in Google:** whoever controls Google's DKIM private key can sign approvals.
- **Account takeover:** if someone owns your Gmail they can approve. The hard cap bounds the damage per request, and
  `FALA FREEZE` works from any device you still control.
- **Not audited.** Small amounts only.

### What is next

Outlook and Google Workspace keys. 2-of-3 approvers for team spend. Approval ceilings in the subject line
(`APPROVE UP TO 5`). Telegram and Slack as additional approval channels. An SDK for agent frameworks. A passkey owner
key, so the one remaining powerful key stops being a hot private key.
