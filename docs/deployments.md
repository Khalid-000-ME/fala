# Deployments

## Arc testnet (chain 5042002)

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
| DKIM key | `gmail.com` / `falastandin` — **a stand-in key I control**, not Gmail's. See [spike.md](spike.md). |

Policy: auto ≤ 0.20 USDC per tx, 1.00 USDC per day, hard cap 5.00 USDC, request TTL 30 days (so the forge panel cases stay valid), relayer tip 0.02 USDC.

## Arc mainnet (chain 5042)

Not deployed. Needs the real Gmail selector/key (see [spike.md](spike.md)) and mainnet USDC.

## Retired testnet vaults

`0x56a88A27DfbF3EC39ff8E5682BA80b498Ed673FE` and `0x9e745D53A0332d2945Cd1Cec5B8f36544D88d6ad` belong to the earlier spend-policy design and are no longer used.
