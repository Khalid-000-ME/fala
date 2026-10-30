/**
 * One relay for every vault: reads the shared Gmail inbox over IMAP, finds the vault(s) whose approver sent the reply,
 * verifies + submits it onchain, and mails receipts. Also emails approval requests and low-balance alerts.
 */
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { BaseError, ContractFunctionRevertedError, parseEventLogs, type Address } from "viem";
import { all, one, run, now } from "./db.js";
import { env } from "./env.js";
import { intentInfo, publicClient, relayerClient, vaultAbi, vaultState } from "./chain.js";
import { approvalEmail, lowBalanceEmail, receiptEmail } from "../../worker/src/mail.js";
import { relayRaw, type RelayResult } from "../../worker/src/relay.js";
import { parseEmail } from "../../worker/src/dkim.js";

const log = (m: string) => console.log(`[relay ${new Date().toISOString().slice(11, 19)}] ${m}`);
const WINDOW = 9_999n;

export function errorName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

const smtp = () => nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: env.relayGmail(), pass: env.relayPass() } });
const send = (raw: string, to: string) => smtp().sendMail({ envelope: { from: env.relayGmail(), to }, raw });

const deps = (v: any, dry: boolean) => {
  const rc = relayerClient(v.address);
  return {
    approverEmail: v.approver_email, check: rc.check, intent: (id: bigint) => intentInfo(v.address, id), errorName,
    submit: dry ? async () => { throw new Error("dry"); } : rc.submit,
  };
};

async function handleReply(raw: Uint8Array) {
  let from = "";
  try { from = parseEmail(raw, { domain: "gmail.com" }).from; } catch { return log("ignored: no usable Gmail DKIM signature"); }
  const vaults = await all<any>(`SELECT * FROM vaults WHERE approver_email = ?`, [from]);
  if (!vaults.length) return log(`ignored: ${from} is not the approver of any vault`);

  // The code in the subject binds a reply to one vault; find the vault whose contract accepts it.
  let target = vaults[0];
  if (vaults.length > 1) {
    for (const v of vaults) {
      const dry = await relayRaw(raw, deps(v, true)).catch((e) => ((e as Error).message === "dry" ? "ok" : null));
      if (dry === "ok") { target = v; break; }
    }
  }
  const label = async (a: string) => (await one<any>(`SELECT name FROM agents WHERE vault_id=? AND lower(address)=lower(?)`, [target.id, a]))?.name ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
  const res: RelayResult = await relayRaw(raw, { ...deps(target, false), label: (p: string) => `${p.slice(0, 6)}…${p.slice(-4)}` });
  if (res.kind === "ignored") return log(`ignored: ${res.why}`);
  log(`[${target.name}] ${res.text.split("\n")[0]}`);
  await send(receiptEmail({ from: env.relayGmail(), to: target.approver_email, ...res.receipt }), target.approver_email);
  void label;
}

async function readInbox() {
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: env.relayGmail(), pass: env.relayPass() }, logger: false });
  // ImapFlow emits 'error' on socket timeouts/disconnects; without a listener Node kills the whole process.
  c.on("error", (e) => log(`imap socket: ${(e as Error).message}`));
  await c.connect();
  try {
    for (const box of ["INBOX", "[Gmail]/Spam"]) {
      let lock;
      try { lock = await c.getMailboxLock(box); } catch { continue; }
      try {
        const uids = (await c.search({ seen: false, from: "gmail.com" }, { uid: true })) || [];
        for (const uid of uids) {
          const msg = await c.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (msg && msg.source) {
            const key = `${box}:${msg.envelope?.messageId ?? uid}`;
            if (!(await one(`SELECT 1 FROM handled_mail WHERE key=?`, [key]))) {
              await run(`INSERT INTO handled_mail (key) VALUES (?)`, [key]);
              await handleReply(new Uint8Array(msg.source));
            }
          }
          await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        }
      } finally { lock.release(); }
    }
  } finally { await c.logout().catch(() => undefined); }
}

async function notifyPending() {
  const tip = await publicClient.getBlockNumber();
  for (const v of await all<any>(`SELECT * FROM vaults`)) {
    let from = BigInt(v.cursor);
    while (from <= tip) {
      const to = from + WINDOW - 1n < tip ? from + WINDOW - 1n : tip;
      const raw = await publicClient.getLogs({ address: v.address as Address, fromBlock: from, toBlock: to });
      for (const l of parseEventLogs({ abi: vaultAbi, eventName: "IntentCreated", logs: raw }) as any[]) {
        const iid = Number(l.args.id);
        if (await one(`SELECT 1 FROM notified WHERE vault_id=? AND intent_id=?`, [v.id, iid])) continue;
        await run(`INSERT INTO notified (vault_id,intent_id) VALUES (?,?)`, [v.id, iid]);
        const i = await intentInfo(v.address, BigInt(iid));
        if (i.status !== "PENDING") continue;
        const subj = async (verb: number) => (await (await import("./chain.js")).readVault(v.address, "subjectFor", [BigInt(iid), verb])) as string;
        const agent = await one<any>(`SELECT name FROM agents WHERE vault_id=? AND lower(address)=lower(?)`, [v.id, i.agent]);
        await send(approvalEmail({
          from: env.relayGmail(), to: v.approver_email, inbound: env.relayGmail(), id: String(iid), amount: i.amount,
          payee: `${i.payee.slice(0, 6)}…${i.payee.slice(-4)}`, payeeAddress: i.payee, agent: agent?.name, vault: v.name, memo: i.memo,
          expiresAt: i.expiresAt, approveSubject: await subj(1), denySubject: await subj(2), freezeSubject: await subj(3),
        }), v.approver_email);
        log(`[${v.name}] approval email sent for request #${iid} (${i.amount} USDC)`);
      }
      from = to + 1n;
    }
    await run(`UPDATE vaults SET cursor=? WHERE id=?`, [Number(tip), v.id]);
  }
}

/** Low-balance alert: at most once a day per vault, and re-armed as soon as the vault is topped up. */
async function checkBalances() {
  for (const v of await all<any>(`SELECT v.*, u.email AS owner_email FROM vaults v JOIN users u ON u.id=v.user_id WHERE v.min_balance > 0`)) {
    const st = await vaultState(v.address).catch(() => undefined);
    if (!st) continue;
    const bal = Number(st.balance);
    if (bal >= v.min_balance) { if (v.low_notified_at) await run(`UPDATE vaults SET low_notified_at=NULL WHERE id=?`, [v.id]); continue; }
    if (v.low_notified_at && now() - v.low_notified_at < 86400) continue;
    if (!v.owner_email) continue;
    const f = (n: number) => (n / 1e6).toFixed(2);
    await send(lowBalanceEmail({ from: env.relayGmail(), to: v.owner_email, vault: v.name, balance: f(bal), minimum: f(v.min_balance), shortfall: f(v.min_balance - bal), vaultAddress: v.address, dashboardUrl: `${env.webOrigin}/vaults/${v.id}` }), v.owner_email);
    await run(`UPDATE vaults SET low_notified_at=? WHERE id=?`, [now(), v.id]);
    log(`[${v.name}] low-balance alert sent to ${v.owner_email}`);
  }
}

export function startRelay() {
  if (!env.relayGmail() || !env.relayPass()) return log("mail relay disabled (set RELAY_GMAIL and RELAY_APP_PASSWORD)");
  log(`running — shared inbox ${env.relayGmail()}`);
  const loop = async () => {
    for (const step of [notifyPending, readInbox, checkBalances]) {
      try { await step(); } catch (e) { log(`${step.name} error: ${(e as Error).message}`); }
    }
    setTimeout(loop, 15_000);
  };
  loop();
}
