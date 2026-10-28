/**
 * Relay a REAL downloaded email through the Worker's own relay code (real Gmail key from DNS, real vault).
 *   npx tsx src/tools/relay-eml.ts ../spike/approve1.eml          # verify + dry-run + submit
 *   npx tsx src/tools/relay-eml.ts ../spike/approve1.eml --dry    # verify + dry-run only (free)
 */
import { readFileSync } from "node:fs";
import { chainClient } from "../../../worker/src/chain.js";
import { relayRaw } from "../../../worker/src/relay.js";

const file = process.argv[2];
if (!file) throw new Error("usage: tsx src/tools/relay-eml.ts <file.eml> [--dry]");
const dry = process.argv.includes("--dry");
const env = process.env as unknown as Parameters<typeof chainClient>[0];
const c = chainClient(env);

class DryRun extends Error {}

const res = await relayRaw(new Uint8Array(readFileSync(file)), {
  approverEmail: process.env.APPROVER_EMAIL!,
  check: c.check,
  submit: dry ? async () => { throw new DryRun(); } : c.submit,
  intent: c.intent,
  errorName: c.errorName,
}).catch((e) => {
  if (e instanceof DryRun) return null;
  throw e;
});
if (res === null) {
  console.log("✅ dry run passed: Google's signature verified locally and the vault's checkEmail accepts it (nothing submitted).");
  process.exit(0);
}
if (res.kind === "ignored") console.log("ignored:", res.why);
else if (res.kind === "rejected") console.log(`rejected (${res.stage}${res.error ? `: ${res.error}` : ""}):`, res.text);
else console.log(res.text, "\ngas:", res.outcome.gasUsed.toString());
