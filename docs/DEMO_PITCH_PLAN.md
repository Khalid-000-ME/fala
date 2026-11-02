# Fala — demo pitch plan

A slide-by-slide brief for building the pitch deck. Each slide gives the one idea it must land,
the words on screen, the asset to show, and what to say over it.

**Rules for whoever builds this**
- One idea per slide. If a slide needs two sentences to explain, it is two slides.
- Dark theme throughout: background `#030712`, text `#F4F6FB`, muted `#8B93A7`, accent `#60A5FA`.
- Logo: `public/media/fala/brand/fala-logo.svg` (white dots on a black rounded tile).
- Wordmark FALA in Bricolage Grotesque, uppercase. Body text in Geist. Numbers and hashes in JetBrains Mono.
- Every clip is silent, 30fps, and loops. Let each one run its full length before cutting away.
- Do not invent statistics. Every number below is either cited or measured from this project.

Assets live in `public/media/fala/clips/` (`.mp4` plus a matching `.jpg` poster frame).
They are also served at `https://fala-approve.vercel.app/media/fala/clips/<name>.mp4`.

---

## Act 1 — The problem (slides 1–5)

### Slide 1 — Title
- **Visual:** logo tile, large, centred on black. Nothing else moving.
- **Headline:** FALA
- **Subhead:** Approve your agent's payments from Gmail.
- **Say:** "Agents can already spend money. The question nobody has answered is how a human stays in the loop without living in a dashboard."

### Slide 2 — The problem: every tool invents its own front door
- **Visual:** a loose scatter of 8–10 small rounded rectangles, each a different muted colour, drifting slowly. No labels, no arrows, no flowchart. They should feel uncoordinated.
- **Headline:** Every tool builds its own interface.
- **Body:** A dashboard to check. An app to install. An extension to approve in. A wallet to sign with. Each one is another place you have to learn, and another place you have to be.
- **Say:** "This is the real cost of software right now. Not the features, the fragmentation. Every product assumes you will come to it."

### Slide 3 — The numbers that do not fragment
- **Visual:** three large mono numerals, staggered, counting up on entry.
- **Numbers:**
  - **4.6 billion** — people using email worldwide (Radicati projection for 2025, via Statista)
  - **376 billion** — emails sent and received every day in 2025 (Radicati, via Statista)
  - **1.5 billion** — Gmail active users, Google's last official figure (2018)
- **Body:** Email is the one interface that was never fragmented. No install, no onboarding, no new account.
- **Say:** "Nobody needs to be taught how to reply to an email. That is the only interface on earth you can assume."
- **Note for builder:** keep the attributions on the slide in small muted text. The 2018 Gmail figure is the most recent one Google has published; label it as such rather than implying it is current.

### Slide 4 — And agents already live there
- **Visual:** a single envelope shape rendered in ASCII-style dots, slowly drifting. Abstract, not literal.
- **Headline:** Agents read email first.
- **Body:** The inbox is where the receipts, the invoices, the quotes and the confirmations already arrive. An agent that does real work is already reading mail. The human on the other side is already reading mail too.
- **Say:** "So the channel is already shared. We just never used it for the one thing that matters: permission."

### Slide 5 — The gap
- **Headline:** An agent can spend. A human can't easily say yes.
- **Body:** Give an agent a card and you have no control. Put a human in front of a wallet and you have no speed. Both choices are bad, so most teams just don't let agents spend at all.
- **Say:** "That is the gap. Not capability — consent."

---

## Act 2 — The project (slides 6–9)

### Slide 6 — What Fala is
- **Visual:** logo tile, small, top. Three short lines appearing in sequence.
- **Headline:** Your agent asks. You reply. Arc verifies.
- **Body:**
  1. Small spends go through on their own, inside limits you set.
  2. Anything bigger becomes a request that lands in your inbox.
  3. You reply to the email. That reply is the signature.
- **Say:** "No new app. No wallet prompt. The approval is an email reply, and that reply is cryptographically binding."

### Slide 7 — Why the reply can be trusted
- **Visual:** the words of a DKIM signature header, mono, with the signature portion highlighted.
- **Headline:** Google already signs your mail. We check it on-chain.
- **Body:** Every Gmail message carries a DKIM RSA signature from Google. The Fala contract holds Google's public key and verifies that signature itself, inside the transaction. Nobody can approve on your behalf — not us, not the agent, not the relay.
- **Say:** "This is zk-email without the zk. The contract does the RSA check directly, against the real `gmail.com` key, selector `20260707`."
- **Note for builder:** this is the technical heart of the pitch. Give it room, do not rush past it.

### Slide 8 — What that buys you
- **Visual:** three columns, no icons, generous spacing.
- **Columns:**
  - **Accessible** — if you can reply to an email, you can approve a payment. No wallet, no seed phrase, no app.
  - **Bounded** — per-payment, per-day and hard caps. The agent physically cannot exceed them.
  - **Verifiable** — the approval is checked on-chain and leaves a public trace.
- **Say:** "The accessibility is the point. The guardrails are table stakes."

### Slide 9 — Built on Arc
- **Headline:** USDC is the gas token.
- **Body:** Fala runs on Arc, where payments and fees are both USDC. No second token to hold, no conversion step between approving and paying.
- **Say:** "That matters for the story — the thing you approve and the thing that pays the fee are the same unit."

---

## Act 3 — Demo one: setting it up (slides 10–15)

Frame this act as "sixty seconds from signed out to an agent with a budget."

### Slide 10 — Sign in
- **Clip:** `01-landing.mp4` (4.2s) then `02-sign-in.mp4` (7.6s)
- **Headline:** Sign in with Google.
- **Say:** "No wallet install. Google sign-in creates an embedded wallet behind the scenes."

### Slide 11 — Create a vault
- **Clip:** `03-create-vault.mp4` (6.9s)
- **Headline:** A vault holds the money and the rules.
- **Body on screen:** name, the Gmail address that approves, a minimum balance.
- **Say:** "One vault, one approver inbox. Note the contract stores only a hash of that address — the email itself never goes on-chain."

### Slide 12 — It deploys
- **Clip:** `04-vault-deploying.mp4` (6.0s)
- **Headline:** Its own contract, on Arc.
- **Say:** "Each vault is a real contract deployment, not a row in our database."

### Slide 13 — Fund it
- **Clip:** `05-fund-vault.mp4` (10.5s)
- **Headline:** Top it up in USDC.
- **Say:** "The vault warns you when it drops below the minimum you set, by email, before the agent gets stuck."

### Slide 14 — Add an agent and give it a budget
- **Clip:** `06-add-agent.mp4` (8.5s) then `07-agent-limits.mp4` (8.5s)
- **Headline:** Connect Claude, ChatGPT or Cursor. Set the ceiling.
- **Body on screen:** per payment `0.20 USDC` · per day `1 USDC` · largest request `1 USDC`
- **Say:** "Under the per-payment limit it just pays. Above it, you get an email. Above the largest-request line, it cannot even ask."

### Slide 15 — Live
- **Clip:** `08-agent-active.mp4` (5.5s), then `09-settings.mp4` (2.4s), then `10-vault-overview.mp4` (3.5s)
- **Headline:** One agent, one budget, one approver.
- **Say:** "That is the whole setup. From here the human does nothing until an email arrives."

---

## Act 4 — Demo two: the approval (slides 16–19)

This is the payoff. Slow down.

### Slide 16 — The ask arrives
- **Clip:** `11-approval-email.mp4` (5.7s)
- **Headline:** It lands in your inbox.
- **Body on screen:** "Approve 1.50 USDC to 0xFA1a…451c? (Request #2)"
- **Say:** "The agent wanted to buy something above its limit. So it asked. This is an ordinary email, in an ordinary inbox, on whatever device you already have."

### Slide 17 — You reply
- **Clip:** `12-reply-approve.mp4` (4.4s)
- **Headline:** Your reply is the key.
- **Body on screen:** `FALA APPROVE 2 cf4fe4ea`
- **Say:** "Tap Approve, press Send. That is the entire interaction. Google signs that reply on its way out."

### Slide 18 — Paid
- **Clip:** `13-payment-receipt.mp4` (2.2s)
- **Headline:** Payment sent.
- **Body on screen:** "1.50 USDC has been sent to 0xFA1a…451c. Arc verified Google's signature on your reply before releasing it."
- **Say:** "A receipt comes back to the same thread. You never left your inbox."

### Slide 19 — And it is on-chain
- **Clip:** `14-arc-onchain.mp4` (2.1s)
- **Headline:** Verified, not trusted.
- **Say:** "Here is that transaction on Arc. The RSA check happened inside it. If the signature had not matched, no money would have moved."

---

## Act 5 — Proof and close (slides 20–23)

### Slide 20 — This is real, and it is running
- **Visual:** a table, mono for all hashes and addresses.
- **Numbers (all measured or on-chain, safe to show):**
  - Vault contract: `0xfcf31860d0ef159b7967a72b37bc4b2104d5f127`, Arc testnet (chain 5042002), block 69628054
  - A real Gmail reply already released a live payment: tx `0x8fbe3ea6…f3adb`
  - 64 contract tests, 17 relay tests
  - Live app: `https://fala-approve.vercel.app`
- **Say:** "Every approval you just watched was a real email and a real transaction. None of it is mocked."

### Slide 21 — How it holds up
- **Headline:** The parts that had to be got right.
- **Body:**
  - The approver's email address is stored only as a `keccak256` hash. The plaintext is never on-chain.
  - Requests expire after one hour, so a stale approval cannot be replayed later.
  - A payout that fails emits an event rather than reverting, so one bad payee cannot wedge the vault.
  - Any vault can be frozen by email: `FALA FREEZE 0 <code>`.
- **Say:** "Most of the engineering went into the failure cases, not the happy path."

### Slide 22 — What's next
- **Headline:** Mainnet.
- **Body:** The contract, relay and app are deployed and working on Arc testnet against Google's real signing key. Mainnet is the next deployment, not the next rewrite.
- **Say:** Keep this honest and short. Do not promise features.

### Slide 23 — Close
- **Visual:** logo tile, centred, black. One line.
- **Line:** If you can reply to an email, you can approve a payment.
- **Say:** "That is the whole idea. Thank you."

---

## Clip index

| File | Length | Shows |
|---|---|---|
| `01-landing.mp4` | 4.2s | Landing page, hero |
| `02-sign-in.mp4` | 7.6s | Privy modal, Google account chooser, connected |
| `03-create-vault.mp4` | 6.9s | New-vault form: name, approver Gmail, minimum balance |
| `04-vault-deploying.mp4` | 6.0s | Create pressed, vault deploying |
| `05-fund-vault.mp4` | 10.5s | Below-minimum warning, deposit, balance updates |
| `06-add-agent.mp4` | 8.5s | Add-agent modal, provider choice, naming |
| `07-agent-limits.mp4` | 8.5s | Spending limits, create agent |
| `08-agent-active.mp4` | 5.5s | Agent active and connected |
| `09-settings.mp4` | 2.4s | Approver Gmail, minimum balance, vault address |
| `10-vault-overview.mp4` | 3.5s | Overview: balance, wallet, requests, agents |
| `11-approval-email.mp4` | 5.7s | Inbox, approval request opened |
| `12-reply-approve.mp4` | 4.4s | Reply `FALA APPROVE 2 …`, sent |
| `13-payment-receipt.mp4` | 2.2s | "Payment sent" receipt |
| `14-arc-onchain.mp4` | 2.1s | Arc explorer transaction details |

Clips 01–10 are 1920px wide, from the onboarding recording. Clips 11–14 are 1440px wide,
from the approval recording already used in the site hero.

## Sources for the slide 3 figures

- Email users worldwide and daily volume: https://www.statista.com/statistics/255080/number-of-email-users-worldwide/
- Gmail active users, Google's 2018 figure: https://techcrunch.com/2016/02/01/gmail-now-has-more-than-1b-monthly-active-users and https://www.phonearena.com/news/Gmail-now-has-1.5-billion-active-users_id110445
