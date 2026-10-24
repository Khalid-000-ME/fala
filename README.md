# Fala

**AI agents can spend your USDC. They just can't be talked into it.**

Fala is an onchain spending-policy vault for AI agents on [Arc](https://docs.arc.io). Per-agent caps, a payee
allowlist, two-key approval for large spends and a kill switch — and every refused attempt is written to the chain as a
`SpendBlocked` event, a permanent public attack log.

```
contracts/   FalaVault.sol + Foundry tests + deploy scripts
src/         React dashboard (Vite, Tailwind, wagmi/viem)
agents/      MCP server, worker agent, auditor agent, red-team runner
```

## How it works

- **Block, don't revert.** A policy violation on `spend()` emits `SpendBlocked(reason)`, moves no funds and returns.
- **Two keys.** Spends above `coSignThreshold` are queued; only the agent's auditor (or the owner) can `approve`/`reject`.
  An agent can never be its own auditor.
- **Limits.** per-tx cap, daily cap, daily tx count (anti-salami), expiry, per-agent freeze, global pause.
- **USDC only, 6 decimals** via the ERC-20 interface `0x3600…0000`. No native value is ever accepted.

| # | Reason | # | Reason |
|---|---|---|---|
| 1 | PAUSED | 8 | OVER_PER_TX_CAP |
| 2 | UNKNOWN_AGENT | 9 | OVER_DAILY_TX_COUNT |
| 3 | AGENT_FROZEN | 10 | OVER_DAILY_CAP |
| 4 | POLICY_EXPIRED | 11 | INSUFFICIENT_VAULT_FUNDS |
| 5 | ZERO_AMOUNT | 12 | TRANSFER_FAILED |
| 6 | NOTE_TOO_LONG | 13 | PENDING_EXPIRED |
| 7 | PAYEE_NOT_ALLOWED | | |

## Contracts

```bash
cd contracts
npm install                          # OpenZeppelin
forge install foundry-rs/forge-std --no-git
forge test -vv                       # 40 tests incl. a daily-cap fuzz invariant
```

Deploy (Arc mainnet uses a 20 gwei fee floor):

```bash
forge script script/Deploy.s.sol --rpc-url $RPC --account <keystore> --broadcast \
  --gas-price 25gwei --priority-gas-price 1gwei
```

`script/DeployLocal.s.sol` deploys a mock USDC + vault + demo policy to a local `anvil`.

## Dashboard

```bash
npm install
cp .env.example .env     # VITE_NETWORK=local|testnet|mainnet, VITE_VAULT_ADDRESS, VITE_VAULT_DEPLOY_BLOCK
npm run dev
```

With no `VITE_VAULT_ADDRESS` the dashboard renders demo data and disables writes. Events are read from the vault only,
in 9,999-block `getLogs` windows. After changing the contract run `forge build && npm run abi`.

## Agents

```bash
cd agents && npm install && cp .env.example .env
npm run demo                  # red-team suite → docs/demo-report.md
npm run auditor               # standalone auditor loop
claude mcp add fala -- npx tsx $PWD/src/mcp-server.ts
```

The worker and auditor use `GROQ_API_KEY` (Groq, OpenAI-compatible); without it the auditor falls back to a keyword rule and LLM scenarios
run as direct calls. Run the suite once per UTC day — daily counters reset at 00:00 UTC.

## Security

Unaudited. Use small amounts. An agent's EOA holds a native USDC gas float that Fala does not protect; keep it tiny.
