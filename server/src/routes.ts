import { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isAddress, keccak256, toBytes, type Address } from "viem";
import { z } from "zod";
import { all, id, now, one, run } from "./db.js";
import { requireUser, agentFromKey, type Me } from "./auth.js";
import { agentCfg, deployVault, explorerTx, publicClient, readVault, sendGas, vaultState } from "./chain.js";
import { newApiKey, seal, sha256, unseal } from "./crypto.js";
import { allowanceFor, payFor, statusFor } from "./agentops.js";
import { runManaged } from "./runner.js";
import { env } from "./env.js";

type Vars = { Variables: { me: Me } };
export const api = new Hono<Vars>();
api.use("/api/*", requireUser);

const usdc = (v: bigint | number) => (Number(v) / 1e6).toString();
const gmail = z.string().trim().toLowerCase().email().refine((e) => e.endsWith("@gmail.com"), "the approver must be a Gmail address (@gmail.com)");
const bad = (c: any, e: unknown) => c.json({ error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e as Error).message }, 400);

// A vault only exists on the chain it was deployed to, so every lookup is scoped to the active network.
async function ownVault(c: any, vaultId: string) {
  return one<any>(`SELECT * FROM vaults WHERE id=? AND user_id=? AND network=?`, [vaultId, c.get("me").id, env.network]);
}
async function ownAgent(c: any, agentId: string) {
  return one<any>(`SELECT a.*, v.address AS vault_address, v.user_id FROM agents a JOIN vaults v ON v.id=a.vault_id WHERE a.id=? AND v.user_id=? AND v.network=?`, [agentId, c.get("me").id, env.network]);
}

async function vaultView(v: any) {
  const st = await vaultState(v.address).catch(() => undefined);
  const balance = st ? Number(st.balance) : 0;
  const agents = await all<any>(`SELECT id,name,kind,provider,address,created_at FROM agents WHERE vault_id=? ORDER BY created_at`, [v.id]);
  return {
    id: v.id, name: v.name, address: v.address, ownerAddress: v.owner_address, approverEmail: v.approver_email, deployBlock: v.deploy_block,
    deployTx: v.deploy_tx ? explorerTx(v.deploy_tx) : null, minBalance: usdc(v.min_balance), balance: usdc(balance), frozen: st?.frozen ?? false,
    belowMin: balance < v.min_balance, shortfall: usdc(Math.max(0, v.min_balance - balance)), agentCount: agents.length, agents,
  };
}

// ---------------------------------------------------------------- me
api.get("/api/me", (c) => c.json(c.get("me")));

// ---------------------------------------------------------------- vaults
const newVault = z.object({ name: z.string().trim().min(1).max(60), approverEmail: gmail, minBalance: z.number().min(0).max(100000).default(0) });

api.post("/api/vaults", async (c) => {
  let body;
  try { body = newVault.parse(await c.req.json()); } catch (e) { return bad(c, e); }
  const me = c.get("me");
  // Deploying costs the platform wallet real money on mainnet, so refuse before spending any.
  const allowed = env.allowedApprovers();
  if (allowed.length && !allowed.includes(body.approverEmail.toLowerCase()))
    return c.json({ error: "this approver address is not on the access list for this deployment" }, 403);
  if (env.maxVaultsPerUser) {
    const mine = await one<any>(`SELECT COUNT(*) AS n FROM vaults WHERE user_id=? AND network=?`, [me.id, env.network]);
    if (Number(mine?.n ?? 0) >= env.maxVaultsPerUser)
      return c.json({ error: `you've reached the limit of ${env.maxVaultsPerUser} vaults on this deployment` }, 403);
  }
  const d = await deployVault(me.wallet as Address, body.approverEmail);
  const vid = id();
  await run(`INSERT INTO vaults (id,user_id,name,address,deploy_block,approver_email,min_balance,owner_address,deploy_tx,cursor,created_at,network) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [vid, me.id, body.name, d.address, d.block, body.approverEmail, Math.round(body.minBalance * 1e6), me.wallet, d.tx, d.block, now(), env.network]);
  return c.json(await vaultView((await one(`SELECT * FROM vaults WHERE id=?`, [vid]))!), 201);
});

api.get("/api/vaults", async (c) => {
  const rows = await all<any>(`SELECT * FROM vaults WHERE user_id=? AND network=? ORDER BY created_at DESC`, [c.get("me").id, env.network]);
  return c.json(await Promise.all(rows.map(vaultView)));
});

api.get("/api/vaults/:id", async (c) => {
  const v = await ownVault(c, c.req.param("id"));
  if (!v) return c.json({ error: "not found" }, 404);
  const view = await vaultView(v);
  const agents = await Promise.all(view.agents.map(async (a: any) => {
    const cfg = await agentCfg(v.address, a.address).catch(() => undefined);
    const keys = await all<any>(`SELECT id,prefix,label,created_at,last_used_at FROM api_keys WHERE agent_id=? AND revoked=0`, [a.id]);
    return { ...a, registered: cfg?.active ?? false, autoPerTx: usdc(cfg?.autoPerTx ?? 0n), autoDaily: usdc(cfg?.autoDaily ?? 0n), hardCap: usdc(cfg?.hardCap ?? 0n), autoSpentToday: usdc(cfg?.autoSpentToday ?? 0n), keys };
  }));
  return c.json({ ...view, agents });
});

api.patch("/api/vaults/:id", async (c) => {
  const v = await ownVault(c, c.req.param("id"));
  if (!v) return c.json({ error: "not found" }, 404);
  try {
    const b = z.object({ name: z.string().trim().min(1).max(60).optional(), minBalance: z.number().min(0).max(100000).optional() }).parse(await c.req.json());
    if (b.name !== undefined) await run(`UPDATE vaults SET name=? WHERE id=?`, [b.name, v.id]);
    if (b.minBalance !== undefined) await run(`UPDATE vaults SET min_balance=?, low_notified_at=NULL WHERE id=?`, [Math.round(b.minBalance * 1e6), v.id]);
  } catch (e) { return bad(c, e); }
  return c.json(await vaultView((await one(`SELECT * FROM vaults WHERE id=?`, [v.id]))!));
});

/** After the owner signs setApprover from their wallet, mirror it here once the chain agrees. */
api.post("/api/vaults/:id/approver-sync", async (c) => {
  const v = await ownVault(c, c.req.param("id"));
  if (!v) return c.json({ error: "not found" }, 404);
  try {
    const { approverEmail } = z.object({ approverEmail: gmail }).parse(await c.req.json());
    const onchain = (await readVault(v.address, "approverHash")) as string;
    if (onchain.toLowerCase() !== keccak256(toBytes(approverEmail)).toLowerCase()) return c.json({ error: "the vault doesn't use that approver yet — send the setApprover transaction first" }, 409);
    await run(`UPDATE vaults SET approver_email=? WHERE id=?`, [approverEmail, v.id]);
  } catch (e) { return bad(c, e); }
  return c.json(await vaultView((await one(`SELECT * FROM vaults WHERE id=?`, [v.id]))!));
});

// ---------------------------------------------------------------- agents
const PROVIDERS = ["claude", "chatgpt", "cursor", "custom"] as const;
const newAgent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("managed"), name: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal("connected"), name: z.string().trim().min(1).max(60), provider: z.enum(PROVIDERS) }),
  z.object({ kind: z.literal("byo"), name: z.string().trim().min(1).max(60), address: z.string().refine(isAddress, "enter a valid agent address") }),
]);

/** Creates the agent record (and its wallet for platform-held kinds). The owner then signs setAgent from their wallet. */
api.post("/api/vaults/:id/agents", async (c) => {
  const v = await ownVault(c, c.req.param("id"));
  if (!v) return c.json({ error: "not found" }, 404);
  let b;
  try { b = newAgent.parse(await c.req.json()); } catch (e) { return bad(c, e); }
  const aid = id();
  let address: string;
  let enc: string | null = null;
  let funded: string | undefined;
  if (b.kind === "byo") {
    address = b.address;
    if (address.toLowerCase() === v.owner_address.toLowerCase()) return c.json({ error: "the vault owner can't also be an agent" }, 400);
  } else {
    const key = generatePrivateKey();
    address = privateKeyToAccount(key).address;
    enc = seal(key);
    funded = explorerTx(await sendGas(address as Address)); // USDC is the gas token: give the new wallet a small float
  }
  try {
    await run(`INSERT INTO agents (id,vault_id,name,kind,provider,address,enc_key,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [aid, v.id, b.name, b.kind, b.kind === "connected" ? b.provider : null, address, enc, now()]);
  } catch { return c.json({ error: "that agent address is already on this vault" }, 409); }
  return c.json({ id: aid, name: b.name, kind: b.kind, address, vaultAddress: v.address, gasTx: funded, nextStep: "Sign setAgent from your wallet to activate it (auto limits are yours to choose)." }, 201);
});

api.delete("/api/agents/:id", async (c) => {
  const a = await ownAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not found" }, 404);
  await run(`UPDATE api_keys SET revoked=1 WHERE agent_id=?`, [a.id]);
  await run(`DELETE FROM agents WHERE id=?`, [a.id]);
  return c.json({ ok: true, note: "Also deactivate it onchain (setAgent with active=false) so the key can't spend." });
});

api.post("/api/agents/:id/keys", async (c) => {
  const a = await ownAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not found" }, 404);
  if (!a.enc_key) return c.json({ error: "bring-your-own agents sign with their own key; they don't use API keys" }, 400);
  const label = String((await c.req.json().catch(() => ({}))).label ?? "").slice(0, 40) || null;
  const key = newApiKey();
  await run(`INSERT INTO api_keys (id,agent_id,hash,prefix,label,created_at) VALUES (?,?,?,?,?,?)`, [id(), a.id, sha256(key), key.slice(0, 12), label, now()]);
  return c.json({
    key, note: "Copy it now — it is shown only once.",
    mcp: { url: `${env.publicUrl}/mcp`, header: `Authorization: Bearer ${key}` },
    rest: { base: `${env.publicUrl}/v1`, header: `Authorization: Bearer ${key}` },
    claudeCode: `claude mcp add --transport http fala ${env.publicUrl}/mcp --header "Authorization: Bearer ${key}"`,
  }, 201);
});

api.delete("/api/agents/:id/keys/:keyId", async (c) => {
  const a = await ownAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not found" }, 404);
  await run(`UPDATE api_keys SET revoked=1 WHERE id=? AND agent_id=?`, [c.req.param("keyId"), a.id]);
  return c.json({ ok: true });
});

api.post("/api/agents/:id/run", async (c) => {
  const a = await ownAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not found" }, 404);
  if (a.kind !== "managed") return c.json({ error: "only the platform's managed agent can be run from here" }, 400);
  const { task } = z.object({ task: z.string().min(3).max(500) }).parse(await c.req.json());
  return c.json(await runManaged(a, task));
});

// ---------------------------------------------------------------- agent API (API key auth): REST for any provider
export const v1 = new Hono();
v1.use("/v1/*", async (c, next) => {
  const key = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
  const a = key ? await agentFromKey(key) : undefined;
  if (!a) return c.json({ error: "missing or invalid API key" }, 401);
  c.set("agent" as never, { address: a.address, enc_key: a.enc_key, vault_address: a.vault_address, kind: a.kind } as never);
  await next();
});
const ag = (c: any) => c.get("agent") as { address: string; enc_key: string; vault_address: string; kind: string };
v1.get("/v1/allowance", async (c) => c.json(await allowanceFor(ag(c))));
v1.post("/v1/payments", async (c) => {
  try {
    const b = z.object({ payee: z.string(), amount_usdc: z.string(), memo: z.string().default("") }).parse(await c.req.json());
    return c.json(await payFor(ag(c), b.payee, b.amount_usdc, b.memo));
  } catch (e) { return bad(c, e); }
});
v1.get("/v1/payments/:id", async (c) => {
  try { return c.json(await statusFor(ag(c), c.req.param("id"))); } catch (e) { return bad(c, e); }
});
void publicClient; void unseal;
