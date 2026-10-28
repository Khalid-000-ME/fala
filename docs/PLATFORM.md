# Platform

Sign in with Google (Privy) → your embedded wallet owns your vaults. Each vault has one approver Gmail, a minimum balance and any number of agents.

Run locally: `cd server && npm i && npx tsx src/index.ts` (needs `server/.env`, see `.env.example`), then `npm run dev` in the repo root.

Agent kinds: **managed** (our Groq agent), **connected** (platform wallet + API key; Claude/Cursor over MCP `POST /mcp`, or REST `/v1/*`), **byo** (your own key, registered by address).
Approver is per vault (the contract has one approver): to give an agent its own approval email, give it its own vault.
Low-balance emails go to the vault owner's Google email at most once a day.
