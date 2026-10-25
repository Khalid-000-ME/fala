// The Worker keeps byte-identical copies of the shared DKIM helpers. `node scripts/sync-dkim.mjs` copies, `--check` fails on drift.
import { copyFileSync, readFileSync } from "node:fs";
const pairs = [["src/lib/dkim.ts", "worker/src/dkim.ts"], ["src/lib/refusals.ts", "worker/src/refusals.ts"]];
const check = process.argv.includes("--check");
let bad = false;
for (const [a, b] of pairs) {
  if (check) {
    if (readFileSync(a, "utf8") !== readFileSync(b, "utf8")) { console.error(`DRIFT: ${b} differs from ${a}`); bad = true; }
  } else copyFileSync(a, b);
}
if (check && !bad) console.log("worker copies are in sync");
process.exit(bad ? 1 : 0);
