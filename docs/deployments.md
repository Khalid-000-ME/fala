# Deployments

## Arc testnet (chain 5042002)

| Item | Value |
|---|---|
| FalaVault | [`0x9e745D53A0332d2945Cd1Cec5B8f36544D88d6ad`](https://explorer.testnet.arc.io/address/0x9e745D53A0332d2945Cd1Cec5B8f36544D88d6ad) |
| Deploy block | 68918586 |
| USDC (ERC-20 view, 6 dp) | `0x3600000000000000000000000000000000000000` |
| Owner | `0x4d17A9BFC6d225A9d95869B922128c6412371Acc` |
| Worker | `0x5Cb015C768fbf14780ffce0079265227c4091EDF` |
| Auditor | `0x30946c9E2aB7853c7C41Dba19a276F1505cC0efb` |

Worker policy: per-tx cap 3 USDC, daily cap 5, co-sign above 1, 8 tx/day, 14-day expiry.
Red-team results: [demo-report.md](demo-report.md).

An earlier vault (`0x56a88A27DfbF3EC39ff8E5682BA80b498Ed673FE`) was drained and retired after its daily counters were used up.

## Arc mainnet (chain 5042)

Not deployed yet.
