# Evidence (Arc testnet)

Every row is a real transaction on the vault in [deployments.md](deployments.md), run with a **stand-in Gmail key** (a throwaway
RSA key registered as `gmail.com`/`falastandin`). The contract path is identical to the real one; what is not yet proven is that
*Gmail's own* key verifies — that needs the real `.eml` (see [spike.md](spike.md)).

| Step | What it proves | Tx |
|---|---|---|
| Deploy `FalaVault` | constructor registers the approver hash + DKIM key | [`0x78d02794…`](https://explorer.testnet.arc.io/tx/0x78d027945d45c9580d76727369376416f194dc2651b3e492ce49ffdeeed7a123) |
| `deposit()` payable, 3 USDC | native 18-dp value becomes 6-dp vault balance | [`0x1212e8be…`](https://explorer.testnet.arc.io/tx/0x1212e8be7b9d8fadd75d8226ee0296eef68160a744b4ed851ba69518a5e433be) |
| Agent `request` 0.10 → known payee | small spend is **auto-paid** | [`0x2aae2961…`](https://explorer.testnet.arc.io/tx/0x2aae29613133b50366e1371687af180206f8ac2d17737884945260e0c4dca892) |
| Agent `request` 2.00 | above the allowance → intent #1 `PENDING` | [`0x5130f9d0…`](https://explorer.testnet.arc.io/tx/0x5130f9d03175ac178c719319754fe5466e47939c0e1314ade8039f367bbebf33) |
| `approveByEmail` (intent #1) | DKIM RSA verified onchain, code matched, 2.00 USDC paid | [`0xa4b6df6f…`](https://explorer.testnet.arc.io/tx/0xa4b6df6f130c5856e17ca307d65157a0eaa3c3ea633e7e4a84464e5e52026a00) |
| `approveByEmail` via the Worker's relay code (1.50) | inbound-email path end to end | [`0x02078766…`](https://explorer.testnet.arc.io/tx/0x020787665991f9cea47fbda15abf619f401b6c9da01acdd491575736248a31b0) |
| `approveByEmail` DENY | a signed DENY closes the request, no funds move | [`0xaee99d86…`](https://explorer.testnet.arc.io/tx/0xaee99d86c560cdb38cf94f8022392b3e5dd6dfaf97f95db12f4ded9cb310d102) |
| `approveByEmail` FREEZE | a signed FREEZE email freezes the vault | [`0x30a3ad9b…`](https://explorer.testnet.arc.io/tx/0x30a3ad9b748c090484356ead9e91e9088b12f27ab0491494330b09d436169b31) |
| Agent request while frozen | refused with `FROZEN`, no revert | [`0xff057726…`](https://explorer.testnet.arc.io/tx/0xff057726be244d942538562736233daba29e679fb18b39eb3d1019f8fd0a6eb4) |
| Owner `unfreeze` | only the owner can lift a freeze | [`0xee06c484…`](https://explorer.testnet.arc.io/tx/0xee06c4842616e5076d219fc4108a259054dae30729a63c05e22e21aa6aaca38f) |
| Underfunded approval (1.50 with 0.88 in the vault) | `PayoutFailed`, intent `FAILED`, funds untouched | see activity feed, request #2 |

Also run live by the Groq agent (`npm run agent`): it auto-paid 0.10, requested 2.00, followed intent #5 and reported it approved.

## Cost

| Call | Gas | Cost at the effective 21 gwei |
|---|---|---|
| `approveByEmail` APPROVE | 449,978 – 451,896 | ≈ **0.0095 USDC** |
| `approveByEmail` DENY | 393,351 | ≈ 0.0083 USDC |
| `approveByEmail` FREEZE | 387,766 | ≈ 0.0081 USDC |
| RSA-2048 verify alone (Foundry, synthetic) | ~290,000 | — |

## Tests

- Contracts: `forge test` → 41 pass, 1 skipped (T31, waits for a real Gmail fixture); fuzz: random bytes never pay.
- TypeScript: `npx vitest run` → 20 pass (canonicalizer cross-checked against the independent `mailauth` DKIM implementation; Worker relay paths).
- Forge panel: 11 attack emails, each refused with the expected named error by the live contract (`public/forge/cases.json`).
