import { PrivyClient } from "@privy-io/server-auth";
import type { Context, Next } from "hono";
import { env } from "./env.js";
import { all, db, now, one, run } from "./db.js";
import { sha256 } from "./crypto.js";

let privy: PrivyClient | undefined;
const client = () => (privy ??= new PrivyClient(env.privyAppId(), env.privySecret()));

/** Deliberately no email: vault mail goes to the vault's own approver address, so we never hold the owner's personal one. */
export type Me = { id: string; wallet: string };

/** Resolve (and upsert) the signed-in user from a Privy access token. */
export async function userFromToken(token: string): Promise<Me> {
  if (env.devLogin && token.startsWith("dev:")) {
    const [, id, wallet] = token.split(":");
    await upsert({ id, wallet });
    return { id, wallet };
  }
  const claims = await client().verifyAuthToken(token);
  const u = await client().getUser(claims.userId);
  const wallet = (u.linkedAccounts as any[]).find((a) => a.type === "wallet" && a.walletClientType === "privy")?.address
    ?? (u.linkedAccounts as any[]).find((a) => a.type === "wallet")?.address;
  if (!wallet) throw new Error("no wallet yet — finish signing in");
  const me = { id: claims.userId, wallet };
  await upsert(me);
  return me;
}

async function upsert(m: Me) {
  await run(`INSERT INTO users (id,wallet,created_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET wallet=excluded.wallet`, [m.id, m.wallet, now()]);
}

export async function requireUser(c: Context, next: Next) {
  const h = c.req.header("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return c.json({ error: "sign in required" }, 401);
  try {
    c.set("me", await userFromToken(h.slice(7)));
  } catch (e) {
    return c.json({ error: `invalid session: ${(e as Error).message}` }, 401);
  }
  await next();
}

/** Agent API-key auth (for Claude / MCP / REST). Returns the agent + its vault. */
export async function agentFromKey(key: string) {
  const row = await one<any>(
    `SELECT a.*, k.id AS key_id, v.address AS vault_address, v.id AS vault_id2, v.name AS vault_name FROM api_keys k
     JOIN agents a ON a.id = k.agent_id JOIN vaults v ON v.id = a.vault_id WHERE k.hash = ? AND k.revoked = 0`, [sha256(key)]);
  if (row) await run(`UPDATE api_keys SET last_used_at=? WHERE id=?`, [now(), row.key_id]);
  return row;
}
void all; void db;
