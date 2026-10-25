/** Drives the Worker's own relay code against the live vault: ask -> email (stand-in Gmail) -> relay -> paid. */
import { chainClient } from "../../../worker/src/chain.js";
import { relayRaw } from "../../../worker/src/relay.js";
import { keyFromTxt } from "../../../src/lib/dkim.js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { requestPayment } from "../lib/fala.js";
import { signStandin } from "./standin.js";
import { vendors } from "../lib/config.js";

const env = process.env as unknown as Parameters<typeof chainClient>[0];
const c = chainClient(env);
const approver = process.env.APPROVER_EMAIL!;

// the registered stand-in public key, as a DNS-style record (no DNS needed)
const pub = crypto.createPublicKey(readFileSync(new URL("../../../.secrets/test-key-standin.pem", import.meta.url)));
const txt = `v=DKIM1; k=rsa; p=${(pub.export({ type: "spki", format: "der" }) as Buffer).toString("base64")}`;

const amount = process.argv[2] ?? "1.50";
const verb = (process.argv[3] ?? "APPROVE") as "APPROVE" | "DENY";
const ask = await requestPayment(vendors().VENDOR_A, amount, "relay-live check");
console.log(`request -> ${ask.status} #${ask.intentId}`);
const subject = await c.subject(BigInt(ask.intentId!), verb === "APPROVE" ? 1 : 2);
const raw = new TextEncoder().encode(await signStandin({ subject, from: `Approver <${approver}>` }));

const res = await relayRaw(raw, {
  approverEmail: approver,
  getKey: () => keyFromTxt(txt),
  check: c.check,
  submit: c.submit,
  intent: c.intent,
  errorName: c.errorName,
});
console.log(res.kind, "\n" + (res.kind === "ignored" ? res.why : res.text));
if (res.kind === "done") console.log("gas used:", res.outcome.gasUsed.toString());
