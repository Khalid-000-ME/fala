import { EmailMessage } from "cloudflare:email";
import { parseEventLogs } from "viem";
import { falaVaultAbi } from "./abi";
import { chainClient, type ChainEnv } from "./chain";
import { approvalEmail, receiptEmail } from "./mail";
import { relayRaw } from "./relay";

export interface Env extends ChainEnv {
  APPROVER_EMAIL: string; // the dedicated Gmail that approves
  INBOUND_ADDRESS: string; // approve@<domain> (Email Routing -> this Worker)
  SEND_FROM: string; // sender on your Cloudflare domain, e.g. fala@<domain>
  NOTIFY_TOKEN: string;
  VAULT_DEPLOY_BLOCK: string;
  LABELS?: string; // JSON: {"0xabc…":"VendorA"}
  SEND_EMAIL: { send(message: EmailMessage): Promise<void> };
  STATE?: KVNamespace;
}

const WINDOW = 9_999n; // eth_getLogs is capped at ~10k blocks on Arc
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const labeler = (env: Env) => {
  let map: Record<string, string> = {};
  try { map = Object.fromEntries(Object.entries(JSON.parse(env.LABELS ?? "{}") as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])); } catch { /* no labels */ }
  return (a: string) => map[a.toLowerCase()] ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
};

async function send(env: Env, raw: string) {
  await env.SEND_EMAIL.send(new EmailMessage(env.SEND_FROM, env.APPROVER_EMAIL, raw));
}

/** Email the human the three mailto buttons for one pending intent. */
async function sendApproval(env: Env, id: bigint): Promise<"sent" | "not-pending"> {
  const c = chainClient(env);
  const i = await c.intent(id);
  if (i.status !== "PENDING") return "not-pending";
  const [a, d, f] = await Promise.all([c.subject(id, 1), c.subject(id, 2), c.subject(id, 3)]);
  await send(env, approvalEmail({
    from: env.SEND_FROM, to: env.APPROVER_EMAIL, inbound: env.INBOUND_ADDRESS, id: i.id, amount: i.amount,
    payee: labeler(env)(i.payee), payeeAddress: i.payee, agent: labeler(env)(i.agent), memo: i.memo, expiresAt: i.expiresAt, approveSubject: a, denySubject: d, freezeSubject: f,
  }));
  await env.STATE?.put(`notified:${id}`, "1", { expirationTtl: 60 * 60 * 24 * 7 });
  return "sent";
}

export default {
  /** POST /notify {id} (bearer NOTIFY_TOKEN) — the agent calls this right after `request()` returns pending. */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET") return json({ ok: true, service: "fala-approver", vault: env.VAULT_ADDRESS, network: env.NETWORK });
    if (req.method !== "POST" || url.pathname !== "/notify") return json({ error: "not found" }, 404);
    if (req.headers.get("authorization") !== `Bearer ${env.NOTIFY_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const { id } = (await req.json().catch(() => ({}))) as { id?: string | number };
    if (id === undefined || !/^\d+$/.test(String(id))) return json({ error: "id required" }, 400);
    // the intent is read from the chain; nothing in the request body is trusted
    const r = await sendApproval(env, BigInt(id));
    return json({ ok: r === "sent", result: r }, r === "sent" ? 200 : 409);
  },

  /** Your reply arrives: verify locally, dry-run onchain, relay, and email back the result. */
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const c = chainClient(env);
    const res = await relayRaw(raw, {
      approverEmail: env.APPROVER_EMAIL, check: c.check, submit: c.submit, intent: c.intent, errorName: c.errorName, label: labeler(env),
    });
    if (res.kind === "ignored") {
      console.log(`ignored inbound email: ${res.why}`);
      return;
    }
    await send(env, receiptEmail({ from: env.SEND_FROM, to: env.APPROVER_EMAIL, ...res.receipt }));
  },

  /** Backup poll: email any intent whose /notify call was missed. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (!env.STATE) return;
    const c = chainClient(env);
    const tip = await c.publicClient.getBlockNumber();
    let from = BigInt((await env.STATE.get("cursor")) ?? env.VAULT_DEPLOY_BLOCK);
    while (from <= tip) {
      const to = from + WINDOW - 1n < tip ? from + WINDOW - 1n : tip;
      const raw = await c.publicClient.getLogs({ address: c.address, fromBlock: from, toBlock: to });
      for (const l of parseEventLogs({ abi: falaVaultAbi, eventName: "IntentCreated", logs: raw })) {
        if (await env.STATE.get(`notified:${l.args.id}`)) continue;
        await sendApproval(env, l.args.id).catch((e) => console.log(`notify #${l.args.id} failed: ${e}`));
      }
      from = to + 1n;
    }
    await env.STATE.put("cursor", String(tip));
  },
};
