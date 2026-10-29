# Deployments

## Arc testnet (chain 5042002)

### Primary — deployed through Arc Studio, trusts Google's real DKIM key

| Item | Value |
|---|---|
| FalaVault | [`0xfcf31860d0ef159b7967a72b37bc4b2104d5f127`](https://explorer.testnet.arc.io/address/0xfcf31860d0ef159b7967a72b37bc4b2104d5f127) |
| Deploy tx / block | [`0x60be8a3f…dedff`](https://explorer.testnet.arc.io/tx/0x60be8a3f36b76f5b3c943127abd20cd42d502864f9d1856615efcc4d5ccdedff) / 69628054 |
| Studio project | https://studio.arc.io/app/7b5f36e6-a2d1-4ccc-b925-f3cf4a4bd39b |
| Owner | `0x4d17A9BFC6d225A9d95869B922128c6412371Acc` |
| Approver / DKIM key | `fala.approver.1@gmail.com` / `gmail.com` `20260707` (Google's real key) |
| Contract version | includes the Studio security-review fixes (strict From parsing, bounded vault-bound FREEZE emails) |

Verified independently on-chain: `owner()`, `approverHash`, and Gmail's real signed email passes every check up to the intent lookup.

### Earlier vault (pre-review contract) — trusts Google's real DKIM key

| Item | Value |
|---|---|
| FalaVault | [`0xda18E4C2fD9e31946739f318324f4578DbD531fD`](https://explorer.testnet.arc.io/address/0xda18E4C2fD9e31946739f318324f4578DbD531fD) |
| Deploy tx / block | [`0xfd088803…2e53`](https://explorer.testnet.arc.io/tx/0xfd0888030fc104e4328077a858ee74391369af6cc377aef1a785b42924e82e53) / 69462444 |
| Approver | `fala.approver.1@gmail.com` |
| DKIM key | `gmail.com` / `20260707` — **Google's real key** |
| Policy | auto ≤ 0.20 USDC/tx, 1.00/day, hard cap 5.00, request TTL 3 days, relayer tip 0.02 |

### Secondary — stand-in key (forge panel cases)

| Item | Value |
|---|---|
| FalaVault | [`0x1F338BA8AB3e858e0c46a83a9959C06c437C5282`](https://explorer.testnet.arc.io/address/0x1F338BA8AB3e858e0c46a83a9959C06c437C5282) |
| Deploy tx | [`0x78d02794…a123`](https://explorer.testnet.arc.io/tx/0x78d027945d45c9580d76727369376416f194dc2651b3e492ce49ffdeeed7a123) (5,322,127 gas) |
| Deploy block | 69051544 |
| USDC (ERC-20 view, 6 dp) | `0x3600000000000000000000000000000000000000` |
| Owner | `0x4d17A9BFC6d225A9d95869B922128c6412371Acc` |
| Agent | `0x5Cb015C768fbf14780ffce0079265227c4091EDF` |
| Relayer | `0xa05EA1a9dA6301AD14E0501eC25ee6326D5fceF2` |
| Approver (placeholder) | `fala.demo.approver@gmail.com` |
| DKIM key | `gmail.com` / `falastandin` — a stand-in key the builder controls, used for the refusal-panel cases. |

Policy: auto ≤ 0.20 USDC per tx, 1.00 USDC per day, hard cap 5.00 USDC, request TTL 30 days (so the forge panel cases stay valid), relayer tip 0.02 USDC.

## Arc mainnet (chain 5042)

Not deployed yet (needs mainnet USDC). Same constructor args as the primary testnet vault: Google's `gmail.com`/`20260707` key — re-check the selector in DNS before deploying, as Gmail rotates keys.

## Retired testnet vaults

`0x56a88A27DfbF3EC39ff8E5682BA80b498Ed673FE` and `0x9e745D53A0332d2945Cd1Cec5B8f36544D88d6ad` belong to the earlier spend-policy design and are no longer used.
