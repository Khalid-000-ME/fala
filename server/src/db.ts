import { createClient } from "@libsql/client";
import { env } from "./env.js";

export const db = createClient({ url: env.dbUrl });

export async function migrate() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS vaults (
       id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL UNIQUE, deploy_block INTEGER NOT NULL,
       approver_email TEXT NOT NULL, min_balance INTEGER NOT NULL DEFAULT 0, owner_address TEXT NOT NULL, deploy_tx TEXT,
       cursor INTEGER NOT NULL, low_notified_at INTEGER, created_at INTEGER NOT NULL,
       network TEXT NOT NULL DEFAULT 'testnet')`,
    `CREATE TABLE IF NOT EXISTS agents (
       id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, provider TEXT,
       address TEXT NOT NULL, enc_key TEXT, created_at INTEGER NOT NULL, UNIQUE(vault_id, address))`,
    `CREATE TABLE IF NOT EXISTS api_keys (
       id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, label TEXT,
       created_at INTEGER NOT NULL, last_used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS notified (vault_id TEXT NOT NULL, intent_id INTEGER NOT NULL, PRIMARY KEY (vault_id, intent_id))`,
    `CREATE TABLE IF NOT EXISTS handled_mail (key TEXT PRIMARY KEY)`,
  ]);
  await dropUserEmails();
  await addVaultNetwork();
}

/**
 * A vault address only exists on the chain it was deployed to. Without this column, switching
 * NETWORK would list the old chain's vaults and the relay would poll addresses that hold no code.
 * Existing rows predate mainnet, so they are testnet by definition.
 */
async function addVaultNetwork() {
  const cols = await db.execute(`PRAGMA table_info(vaults)`);
  if (cols.rows.some((c: any) => c.name === "network")) return;
  await db.execute(`ALTER TABLE vaults ADD COLUMN network TEXT NOT NULL DEFAULT 'testnet'`);
}

/** Older databases kept the signer's Google address. We no longer collect it, so erase what was stored. */
async function dropUserEmails() {
  const cols = await db.execute(`PRAGMA table_info(users)`);
  if (!cols.rows.some((c: any) => c.name === "email")) return;
  await db.batch([`UPDATE users SET email = NULL`, `ALTER TABLE users DROP COLUMN email`]);
}

export const now = () => Math.floor(Date.now() / 1000);
export const id = () => crypto.randomUUID();
export async function one<T = Record<string, any>>(sql: string, args: any[] = []): Promise<T | undefined> {
  return (await db.execute({ sql, args })).rows[0] as unknown as T | undefined;
}
export async function all<T = Record<string, any>>(sql: string, args: any[] = []): Promise<T[]> {
  return (await db.execute({ sql, args })).rows as unknown as T[];
}
export const run = (sql: string, args: any[] = []) => db.execute({ sql, args });
