/**
 * Day-1 go/no-go: take one REAL Gmail-signed email, rebuild the signed header block, verify Gmail's RSA signature
 * locally against its live DKIM key, and write the fixture the contract test (T31) runs on.
 *
 *   npx tsx src/tools/spike.ts ../spike/spike.eml
 *   SPIKE_KEY_TXT='v=DKIM1; k=rsa; p=…' npx tsx src/tools/spike.ts some.eml     # offline / stand-in key
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { bytesToHex, bytesToLatin1, fetchDkimKey, keyFromTxt, parseEmail, parseTags, parseHeaders, verifyBlock } from "../../../src/lib/dkim.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx src/tools/spike.ts path/to/message.eml");
  process.exit(2);
}
const raw = readFileSync(file);
const p = parseEmail(raw);
const dkim = parseHeaders(raw).find((h) => h.name.toLowerCase() === "dkim-signature" && parseTags(h.value).tags.d?.toLowerCase() === p.d)!;
const tags = parseTags(dkim.value).tags;

console.log("DKIM-Signature");
console.log(`  d=${p.d}  s=${p.s}  a=${tags.a}  c=${tags.c}  t=${p.t || "—"}`);
console.log(`  h=${tags.h}`);
console.log(`  from=${p.from}  subject="${p.subject}"`);
console.log(`  signed block: ${p.headerBlock.length} bytes, ${bytesToLatin1(p.headerBlock).split("\r\n").length} lines`);

const key = process.env.SPIKE_KEY_TXT ? await keyFromTxt(process.env.SPIKE_KEY_TXT) : await fetchDkimKey(p.d, p.s);
console.log(`  key: ${key.n.length * 8}-bit RSA, e=${[...key.e].map((x) => x.toString(16).padStart(2, "0")).join("")}`);

const ok = await verifyBlock(p.headerBlock, p.sig, key.spki);
console.log(ok ? "\n✅ local RSA-SHA256 verification PASSED — the block we send to Arc is exactly what Google signed" : "\n❌ local verification FAILED — do not continue; see Appendix B (Google Sign-In fallback)");
if (!ok) process.exit(1);

const out = new URL("../../../contracts/test/fixtures/gmail-real.json", import.meta.url).pathname;
mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true });
writeFileSync(out, JSON.stringify({ block: bytesToHex(p.headerBlock), sig: bytesToHex(p.sig), n: bytesToHex(key.n), e: bytesToHex(key.e), from: p.from, subject: p.subject, d: p.d, s: p.s }, null, 2));
console.log(`\nfixture written: contracts/test/fixtures/gmail-real.json`);
console.log(`next: (cd contracts && forge test --match-test T31 -vv)   # verifies it on the EVM and logs the gas`);
console.log(`      deploy a vault for this selector:`);
console.log(`      APPROVER_EMAIL=${p.from} DKIM_SELECTOR=${p.s} DKIM_N=${bytesToHex(key.n).slice(0, 14)}… (see fixture) forge script script/Deploy.s.sol …`);
