/**
 * Generates public/forge/cases.json for the live vault: real pending requests + attack variants signed with the
 * stand-in Gmail key. Every case is checked against the contract before it is written, so the file only contains
 * refusals that actually happened.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { decodeAbiParameters, type Hex } from "viem";
import { addressOf, checkEmail, errorName, publicClient, requestPayment, subjectFor, submitEmail, write } from "../lib/fala.js";
import { chain, vaultAddress, vendors } from "../lib/config.js";

const approver = process.env.APPROVER_EMAIL!;
const FROM = `Fala Approver <${approver}>`;
const signer = new URL("../../../contracts/script/sign-email.mjs", import.meta.url).pathname;
const cwd = new URL("../../../contracts/", import.meta.url).pathname;

function sign(spec: Record<string, unknown>) {
  const out = execFileSync("node", [signer, JSON.stringify({ key: "standin", from: FROM, d: "gmail.com", s: "falastandin", ...spec })], {
    cwd, env: { ...process.env, FALA_KEY_DIR: "../.secrets" },
  }).toString();
  const [headerBlock, sig] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], out as Hex);
  return { headerBlock, sig };
}

// long TTL so the "valid" case is still pending whenever someone opens the page
await write("owner", "setParams", [30 * 86400, 20_000n]);

const ask = async (amount: string, memo: string) => {
  const r = await requestPayment(vendors().VENDOR_A, amount, memo);
  if (r.status !== "pending") throw new Error(`expected pending, got ${r.status}`);
  const id = BigInt(r.intentId!);
  return { id, subject: await subjectFor(id, 1), code: (await subjectFor(id, 1)).split(" ")[3] };
};

const valid = await ask("1.25", "forge demo: a real approval");
const other = await ask("1.35", "forge demo: another request");
const replayed = await ask("1.15", "forge demo: already approved");

// the replay case is a genuine approval that is submitted once, for real
const replayMail = sign({ subject: replayed.subject });
await submitEmail(replayMail.headerBlock, replayMail.sig);

const now = Math.floor(Date.now() / 1000);
const lines = (subject: string, extra: string[] = []) => [`from:${FROM}`, ...extra, "to:approve@fala.example", `subject:${subject}`, "date:Mon, 26 Oct 2026 10:00:00 +0000"];

const defs = [
  { id: "valid", title: "A real approval", what: "A correctly signed reply from the approver for a pending request. This one is accepted.", expected: "OK", ...sign({ subject: valid.subject }) },
  { id: "tampered", title: "Edited after Google signed it", what: "One byte of the signed headers is changed after signing.", expected: "BadSignature", ...sign({ subject: valid.subject, flipByte: 62 }) },
  { id: "swapped-code", title: "Code from a different request", what: "Genuinely signed, but the subject carries another request’s code.", expected: "CodeMismatch", ...sign({ subject: `FALA APPROVE ${valid.id} ${other.code}` }) },
  { id: "other-sender", title: "Another Gmail account", what: "A genuine Gmail signature — from someone who isn’t the approver.", expected: "FromNotApprover", ...sign({ subject: valid.subject, from: "Mallory <mallory@gmail.com>" }) },
  { id: "replay", title: "Replaying an approval", what: "The exact email that already paid out, submitted again.", expected: "IntentNotPending", ...replayMail },
  { id: "injected-subject", title: "From: hidden inside the subject", what: "The subject tries to smuggle in a second From line.", expected: "SubjectMalformed", ...sign({ lines: lines(`x from:${approver} ${valid.subject}`) }) },
  { id: "two-from", title: "Two From headers", what: "A second From header is added to confuse the parser.", expected: "DuplicateHeader", ...sign({ lines: lines(valid.subject, ["from:Mallory <mallory@gmail.com>"]) }) },
  { id: "weak-algorithm", title: "Downgraded algorithm", what: "The signature claims rsa-sha1 instead of rsa-sha256.", expected: "WrongAlgorithm", ...sign({ subject: valid.subject, a: "rsa-sha1" }) },
  { id: "subject-unsigned", title: "Subject not covered", what: "The signature doesn’t cover the Subject header, so it could be swapped.", expected: "HeaderNotSigned", ...sign({ subject: valid.subject, h: "from:to:date" }) },
  { id: "unknown-key", title: "A key the vault doesn’t trust", what: "Signed with a selector that isn’t in the key registry.", expected: "UnknownKey", ...sign({ subject: valid.subject, s: "someotherkey" }) },
  { id: "stale", title: "Signed before the request existed", what: "An email dated a day before the payment was even asked for.", expected: "StaleTimestamp", ...sign({ subject: valid.subject, t: now - 86400 }) },
];

const cases = [];
for (const c of defs) {
  let got = "OK";
  try { await checkEmail(c.headerBlock, c.sig); } catch (e) { got = errorName(e); }
  console.log(`${got === c.expected ? "✓" : "✗"} ${c.id.padEnd(18)} expected ${c.expected.padEnd(18)} got ${got}`);
  if (got !== c.expected) throw new Error(`case ${c.id} did not behave as expected`);
  cases.push(c);
}

const out = new URL("../../../public/forge/cases.json", import.meta.url).pathname;
mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true });
writeFileSync(out, JSON.stringify({ vault: vaultAddress(), chainId: chain.id, generatedAt: new Date().toISOString(), cases }, null, 2));
console.log(`wrote ${out} (${cases.length} cases) for ${vaultAddress()}; agent ${addressOf("agent")}`);
void publicClient;
