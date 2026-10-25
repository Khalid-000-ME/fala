# Day-1 spike: does a real Gmail signature verify on Arc?

**Status:** everything downstream is built and verified with a stand-in key. The one open item is a *real* Gmail-signed email.

## What is already proven
- The canonicalizer (`src/lib/dkim.ts`) produces exactly the bytes an independent DKIM implementation (`mailauth`) signs/verifies.
- Arc's modexp precompile verifies RSA-2048 PKCS#1 v1.5 inside `approveByEmail` (≈ 450k gas, ≈ 0.0095 USDC).
- The full flow (request → email → relay → paid) runs on testnet with a stand-in key.

## What you need to do
1. From a **dedicated Gmail** account, send any message to an address you own with the subject `FALA APPROVE 1 deadbeef`.
2. In Gmail open it in **Sent** → ⋮ → **Show original** → **Download original** → save as `spike/spike.eml` (gitignored).
3. Run:
   ```bash
   cd agent && npx tsx src/tools/spike.ts ../spike/spike.eml
   ```
   It prints `d=`, `s=` (the selector), `a=`, `c=`, fetches Gmail's live DKIM key from DNS, rebuilds the signed header block,
   verifies the RSA signature locally, and writes `contracts/test/fixtures/gmail-real.json`.
4. `cd contracts && forge test --match-test T31 -vv` verifies the same fixture **on the EVM** and logs the gas.
5. Deploy a vault with the real selector and key (the constructor key is active immediately):
   ```bash
   APPROVER_EMAIL=<your gmail> DKIM_DOMAIN=gmail.com DKIM_SELECTOR=<s=> DKIM_N=<n from the fixture> \
   forge script script/Deploy.s.sol --rpc-url $RPC --private-key $OWNER_KEY --broadcast --gas-price 25000000000 --priority-gas-price 1000000000
   ```

**Go:** step 3 passes and step 4 passes. **No-go:** switch to the Google Sign-In fallback (RS256 JWT, PRD Appendix B).
