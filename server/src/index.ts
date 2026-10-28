import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { migrate } from "./db.js";
import { api, v1 } from "./routes.js";
import { handleMcp } from "./mcp.js";
import { startRelay } from "./relay.js";

await migrate();
const app = new Hono();
app.use("*", cors({ origin: env.webOrigin, allowHeaders: ["authorization", "content-type", "mcp-session-id", "mcp-protocol-version"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.get("/health", (c) => c.json({ ok: true, network: env.network }));
app.all("/mcp", (c) => handleMcp(c.req.raw));
app.route("/", v1);
app.route("/", api);
app.onError((e, c) => { console.error(e); return c.json({ error: e.message }, 500); });

serve({ fetch: app.fetch, port: env.port }, (i) => console.log(`fala server on :${i.port} (${env.network})`));
if (process.env.RELAY !== "0") startRelay();
