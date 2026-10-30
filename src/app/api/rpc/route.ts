// Same-origin JSON-RPC proxy to Arc.
//
// Arc's public RPC rate-limits per IP (HTTP 429). Called straight from the browser, Cloudflare's 429 carries no CORS
// headers, so it surfaced as "Failed to fetch" / viem "HTTP request failed." This proxy keeps the app under the limit:
// it caches reads, merges identical in-flight requests, caps concurrency and retries 429s with backoff.
const UPSTREAM =
  process.env.ARC_RPC_URL ??
  (process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "https://rpc.mainnet.arc.io" : "https://rpc.testnet.arc.io");

type Rpc = { jsonrpc: "2.0"; id: unknown; method: string; params?: unknown[] };
type Reply = { jsonrpc: "2.0"; id: unknown; result?: unknown; error?: unknown };

const g = globalThis as unknown as { __falaRpc?: { cache: Map<string, { at: number; ttl: number; reply: Reply }>; inflight: Map<string, Promise<Reply>> } };
const state = (g.__falaRpc ??= { cache: new Map(), inflight: new Map() });

// Reads whose answer can't change are cached for an hour; anything that tracks the chain head for 2 seconds.
const FOREVER = 60 * 60_000;
const SHORT = 2_000;
const isHexNumber = (x: unknown) => typeof x === "string" && /^0x[0-9a-f]+$/i.test(x);
function ttlFor(r: Rpc): number {
  const p = r.params ?? [];
  switch (r.method) {
    case "eth_chainId":
      return FOREVER;
    case "eth_getBlockByNumber":
      return isHexNumber(p[0]) ? FOREVER : SHORT;
    case "eth_getLogs": {
      const f = (p[0] ?? {}) as { toBlock?: unknown };
      return isHexNumber(f.toBlock) ? 30_000 : SHORT;
    }
    case "eth_getTransactionReceipt":
    case "eth_getTransactionByHash":
      return 0; // pending until mined: never serve a stale "null"
    case "eth_sendRawTransaction":
    case "eth_getTransactionCount":
    case "eth_estimateGas":
      return 0; // writes and nonce must always be live
    default:
      return SHORT; // eth_call, eth_blockNumber, eth_getBalance, gas price…
  }
}

// At most 4 upstream requests at a time. Calls a user is waiting on (nonce, gas, broadcast) jump the queue,
// so a click is never stuck behind background history paging.
const URGENT = new Set(["eth_getTransactionCount", "eth_estimateGas", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>, urgent = false): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => (urgent ? queue.unshift(r) : queue.push(r)));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

async function upstream(r: Rpc): Promise<Reply> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: r.method, params: r.params ?? [] });
  const urgent = URGENT.has(r.method);
  for (let attempt = 0; ; attempt++) {
    const res = await slot(() => fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store" }), urgent);
    if ((res.status === 429 || res.status >= 500) && attempt < 7) {
      const after = Number(res.headers.get("retry-after"));
      const backoff = Math.min(6_000, 250 * 2 ** attempt) + Math.random() * 250;
      await new Promise((ok) => setTimeout(ok, after > 0 ? after * 1000 : backoff));
      continue;
    }
    // -32603 (internal), not -32005: viem would mislabel -32005 as "Request exceeds defined limit."
    if (!res.ok) return { jsonrpc: "2.0", id: r.id, error: { code: -32603, message: `Arc RPC is busy (HTTP ${res.status}); try again in a moment` } };
    return (await res.json()) as Reply;
  }
}

async function one(r: Rpc): Promise<Reply> {
  const ttl = ttlFor(r);
  const key = `${r.method}:${JSON.stringify(r.params ?? [])}`;
  if (ttl > 0) {
    const hit = state.cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return { ...hit.reply, id: r.id };
  }
  let p = state.inflight.get(key);
  if (!p) {
    p = upstream(r).finally(() => state.inflight.delete(key));
    if (r.method !== "eth_sendRawTransaction") state.inflight.set(key, p);
  }
  const reply = await p;
  if (ttl > 0 && !reply.error) {
    state.cache.set(key, { at: Date.now(), ttl, reply });
    if (state.cache.size > 5000) state.cache.delete(state.cache.keys().next().value!);
  }
  return { ...reply, id: r.id };
}

export async function POST(req: Request) {
  let parsed: Rpc | Rpc[];
  try { parsed = await req.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  try {
    const out = Array.isArray(parsed) ? await Promise.all(parsed.map(one)) : await one(parsed);
    return Response.json(out);
  } catch (e) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `Arc RPC unreachable: ${(e as Error).message}` } }, { status: 502 });
  }
}
