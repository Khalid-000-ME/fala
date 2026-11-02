import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { migrate } from "./db.js";
import { api, v1 } from "./routes.js";
import { handleMcp } from "./mcp.js";
import { relayEnabled, relayPass, startRelay } from "./relay.js";

await migrate();
const app = new Hono();
app.use("*", cors({ origin: env.webOrigin, allowHeaders: ["authorization", "content-type", "mcp-session-id", "mcp-protocol-version"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.get("/health", (c) => c.json({ ok: true, network: env.network }));
// Without this, a request that fails in the browser leaves no trace at all on the server.
app.use("*", async (c, next) => {
  const t = Date.now();
  await next();
  if (c.req.path !== "/health") console.log(`[http] ${c.req.method} ${c.req.path} -> ${c.res.status} ${Date.now() - t}ms`);
});
// Dev diagnostics: the dashboard posts failed-transaction details here so they land in the server log.
app.post("/debug/client-error", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  console.log("[client-error]", JSON.stringify(body, null, 2));
  return c.json({ ok: true });
});
/**
 * Runs one relay sweep on demand. A cron calls this where the host stops an idle machine,
 * so the relay still reads replies without a process resident around the clock.
 */
app.post("/relay/tick", async (c) => {
  if (c.req.header("authorization") !== `Bearer ${env.secret()}`) return c.json({ error: "unauthorized" }, 401);
  if (!relayEnabled()) return c.json({ error: "relay disabled: set RELAY_GMAIL and RELAY_APP_PASSWORD" }, 503);
  const t = Date.now();
  const result = await relayPass();
  return c.json({ ok: true, ms: Date.now() - t, ...result });
});
app.all("/mcp", (c) => handleMcp(c.req.raw));
app.route("/", v1);
app.route("/", api);
app.onError((e, c) => { console.error(e); return c.json({ error: e.message }, 500); });

// The API must outlive a flaky network: a dropped IMAP/RPC socket should never take the server down.
process.on("uncaughtException", (e) => console.error("uncaught:", e));
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e));

serve({ fetch: app.fetch, port: env.port }, (i) => console.log(`fala server on :${i.port} (${env.network})`));
if (process.env.RELAY !== "0") startRelay();
