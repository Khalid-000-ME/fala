# Fala — mainnet slides

Drop-in slides for the pitch deck. Paste this whole file into Claude design.

**Style:** dark background `#030712`, text `#F4F6FB`, muted `#8B93A7`, accent `#60A5FA`.
Addresses, hashes and numbers in JetBrains Mono. Headings in Bricolage Grotesque. Body in Geist.
Logo: `public/media/fala/brand/fala-logo.svg`.

Every number below is measured on-chain. None of it is estimated.

---

## Slide — Only possible because Arc makes it cheap

**Layout:** three large mono numbers in a row, a one-line label under each.

| Number | Label |
|---|---|
| `0.011 USDC` | one on-chain approval — 533,230 gas for the RSA-2048 check |
| `0.1116 USDC` | deploying a whole vault, so every user gets their own contract |
| `USDC` | is the gas token — what you approve and what pays the fee are one unit |

**Say:** "On a chain with ordinary gas economics this design does not ship — you would be forced into a zero-knowledge circuit. Arc's modexp precompile makes the direct RSA check cost about a cent, and that is the whole reason Fala can be this simple."

---

## Slide — Deployed on Arc mainnet

**Layout:** a plain table, mono for every address and hash. No decoration. This slide's job is to be checkable.

| | |
|---|---|
| **FalaVault** | `0xE20D31af287e546A35897FD65a822f3dEF7FA008` |
| **Deploy tx** | `0x19f32caa…ab72` |
| **Chain / block** | Arc mainnet 5042 · block 29095348 |
| **Cost to deploy** | 5,577,308 gas = 0.1116 USDC |
| **DKIM key** | `gmail.com` selector `20260707` — Google's real production key, 2048-bit |
| **Approver** | stored only as `keccak256` — the address is never on-chain |
| **Tests** | 64 contract tests · 17 relay tests |
| **App** | `https://fala-approve.vercel.app` |

**Say:** "This is deployed and verifiable right now. The key it checks against is Google's real production key, not a stand-in we control."

Explorer link, if the slide shows one:
`https://explorer.arc.io/address/0xE20D31af287e546A35897FD65a822f3dEF7FA008`

---

## Slide — Don't take our word for it

**Layout:** four mono command lines, each with its result beneath in muted text. Make it look like a terminal, not a slide.

```
V=0xE20D31af287e546A35897FD65a822f3dEF7FA008

cast call $V "approverHash()(bytes32)"
  → 0xca56b56b…3d0c

cast keccak "fala.approver.1@gmail.com"
  → the same value

cast call $V "getKeyIds()(bytes32[])"
  → 0x15234f80…712b

dig +short TXT 20260707._domainkey.gmail.com
  → Google's published key, same modulus
```

**Say:** "That last line is the point. The key the contract verifies against is the one Google publishes in DNS, byte for byte. Anyone in this room can run these four commands."

**Note:** this is the most persuasive slide in the deck for a technical judge. Give it a full slide — do not fold it into the table above.

---

## Slide — A real reply has already moved real money

**Layout:** the receipt still (`public/media/fala/clips/13-payment-receipt.jpg`) with one line of text over or beside it.

**Headline:** 2.00 USDC, released by an email.

**Body:** A reply from a real Gmail account was verified against Google's own signature and released 2.00 USDC. 533,230 gas. Roughly one cent.

**Say:** "Every approval you just watched was a real email and a real transaction. None of it is mocked."

---

## Slide — What's next

**Headline:** More signers, more approvers.

- Outlook and Google Workspace keys, so approval is not Gmail-only
- Two-of-three approvers for team spend
- Approval ceilings in the subject line: `FALA APPROVE UP TO 5`
- An SDK, so any agent framework can hold a budget

**Say:** Keep this short. Do not oversell — the deployed thing is the argument.

---

## Closing slide

**Layout:** logo tile, centred, on black. One line.

**Line:** If you can reply to an email, you can approve a payment.
