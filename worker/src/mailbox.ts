/**
 * Free, domain-less approval relay. Instead of Cloudflare Email Routing, a dedicated "relay" Gmail inbox receives the
 * approver's reply (Gmail→Gmail mail keeps the original DKIM-Signature), this process reads it over IMAP and runs the
 * exact same relay code as the Worker. It also emails the approval buttons over SMTP when a request is created.
 *
 *   npm run mailbox            # loop forever (every ~15 s)
 *   npm run mailbox -- --once  # one pass
 *   npm run mailbox -- --eml ../spike/approve1.eml [--dry]   # run one saved email through the same path
 *
 * Needs the relay Gmail's address + an App Password (Google Account → Security → 2-Step Verification → App passwords).
 */
import { config } from "dotenv";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEventLogs } from "viem";
import { falaVaultAbi } from "./abi";
import { chainClient, type ChainEnv } from "./chain";
import { approvalEmail, receiptEmail } from "./mail";
import { relayRaw } from "./relay";

const here = (p: string) => new URL(p, import.meta.url).pathname;
config({ path: here("../../agent/.env"), quiet: true });
config({ path: here("../.env"), override: true, quiet: true });

const env = process.env as unknown as ChainEnv & Record<string, string>;
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} (see worker/.env.example)`);
  return v;
};

const STATE_FILE = here("../.mailbox-state.json");
type State = { cursor?: string; notified: string[]; handled: string[] };
const state: State = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { notified: [], handled: [] };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state));

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const WINDOW = 9_999n;

const c = chainClient(env);
const approver = () => need("APPROVER_EMAIL");
const relayUser = () => need("RELAY_GMAIL");
const smtp = () =>
  nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: relayUser(), pass: need("RELAY_APP_PASSWORD") } });

const send = (raw: string, to: string) => smtp().sendMail({ envelope: { from: relayUser(), to }, raw });
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const labels = (() => {
  try { return Object.fromEntries(Object.entries(JSON.parse(process.env.LABELS ?? "{}") as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])); } catch { return {}; }
})() as Record<string, string>;
const label = (a: string) => labels[a.toLowerCase()] ?? `${a.slice(0, 6)}…${a.slice(-4)}`;

const deps = (dry: boolean) => ({
  approverEmail: approver(),
  check: c.check,
  submit: dry ? async () => { throw new Error("dry"); } : c.submit,
  intent: c.intent,
  errorName: c.errorName,
  label,
});

/** Email the three approval buttons for every pending request we haven't announced yet. */
async function notifyPending() {
  const tip = await c.publicClient.getBlockNumber();
  let from = BigInt(state.cursor ?? env.VAULT_DEPLOY_BLOCK ?? "0");
  while (from <= tip) {
    const to = from + WINDOW - 1n < tip ? from + WINDOW - 1n : tip;
    const raw = await c.publicClient.getLogs({ address: c.address, fromBlock: from, toBlock: to });
    for (const l of parseEventLogs({ abi: falaVaultAbi, eventName: "IntentCreated", logs: raw })) {
      const id = String(l.args.id);
      if (state.notified.includes(id)) continue;
      const i = await c.intent(l.args.id);
      state.notified.push(id);
      if (i.status !== "PENDING") continue;
      const [a, d, f] = await Promise.all([c.subject(l.args.id, 1), c.subject(l.args.id, 2), c.subject(l.args.id, 3)]);
      await send(approvalEmail({
        from: relayUser(), to: approver(), inbound: relayUser(), id, amount: i.amount, payee: label(i.payee), payeeAddress: i.payee,
        agent: label(i.agent), memo: i.memo, expiresAt: i.expiresAt, approveSubject: a, denySubject: d, freezeSubject: f,
      }), approver());
      log(`approval email sent for request #${id} (${i.amount} USDC)`);
    }
    from = to + 1n;
  }
  state.cursor = String(tip);
  save();
}

async function handle(raw: Uint8Array, dry = false) {
  const res = await relayRaw(raw, deps(dry)).catch((e) => (dry && (e as Error).message === "dry" ? null : Promise.reject(e)));
  if (res === null) return log("dry run: signature verified and the vault's checkEmail accepts it (nothing submitted)");
  if (res.kind === "ignored") return log(`ignored: ${res.why}`);
  log(res.text.split("\n")[0]);
  if (dry) return;
  await send(receiptEmail({ from: relayUser(), to: approver(), ...res.receipt }), approver());
}

/** Read unseen mail from the approver over IMAP and relay each one onchain. */
async function readReplies() {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: relayUser(), pass: need("RELAY_APP_PASSWORD") }, logger: false });
  await client.connect();
  try {
    for (const box of ["INBOX", "[Gmail]/Spam"]) {
      let lock;
      try { lock = await client.getMailboxLock(box); } catch { continue; }
      try {
        const uids = (await client.search({ from: approver(), seen: false }, { uid: true })) || [];
        for (const uid of uids) {
          const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const key = `${box}:${msg.envelope?.messageId ?? uid}`;
          if (!state.handled.includes(key)) {
            state.handled.push(key);
            save();
            await handle(new Uint8Array(msg.source));
          }
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout();
  }
}

async function pass() {
  try { await notifyPending(); } catch (e) { log(`notify error: ${(e as Error).message}`); }
  try { await readReplies(); } catch (e) { log(`mailbox error: ${(e as Error).message}`); }
}

const emlIdx = args.indexOf("--eml");
if (emlIdx >= 0) {
  await handle(new Uint8Array(readFileSync(args[emlIdx + 1])), flag("--dry"));
} else if (flag("--once")) {
  await pass();
} else {
  log(`mailbox relay running for vault ${c.address} — approver ${approver()}, inbox ${relayUser()}`);
  for (;;) {
    await pass();
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
