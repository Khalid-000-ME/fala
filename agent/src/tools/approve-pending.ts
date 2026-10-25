/** Plays the human in tests: replies (stand-in Gmail signature) to every PENDING intent, through the Worker's relay code. */
import { chainClient } from "../../../worker/src/chain.js";
import { relayRaw } from "../../../worker/src/relay.js";
import { keyFromTxt } from "../../../src/lib/dkim.js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { signStandin } from "./standin.js";

const env = process.env as unknown as Parameters<typeof chainClient>[0];
const c = chainClient(env);
const approver = process.env.APPROVER_EMAIL!;
const verb = (process.argv[2] ?? "APPROVE") as "APPROVE" | "DENY";
const waitMs = Number(process.argv[3] ?? 0) * 1000;
const pub = crypto.createPublicKey(readFileSync(new URL("../../../.secrets/test-key-standin.pem", import.meta.url)));
const txt = `v=DKIM1; k=rsa; p=${(pub.export({ type: "spki", format: "der" }) as Buffer).toString("base64")}`;

const end = Date.now() + waitMs;
const seen = new Set<string>();
do {
  const next = (await c.read("nextIntentId")) as bigint;
  for (let id = next - 1n; id >= 1n && id > next - 6n; id--) {
    if (seen.has(String(id))) continue;
    const i = await c.intent(id);
    if (i.status !== "PENDING") continue;
    seen.add(String(id));
    const subject = await c.subject(id, verb === "APPROVE" ? 1 : 2);
    const raw = new TextEncoder().encode(await signStandin({ subject, from: `Approver <${approver}>` }));
    const res = await relayRaw(raw, { approverEmail: approver, getKey: () => keyFromTxt(txt), check: c.check, submit: c.submit, intent: c.intent, errorName: c.errorName });
    console.log(`[human] ${verb} #${id}: ${res.kind === "ignored" ? res.why : res.text.split("\n")[0]}`);
  }
  if (waitMs) await new Promise((r) => setTimeout(r, 3000));
} while (Date.now() < end);
