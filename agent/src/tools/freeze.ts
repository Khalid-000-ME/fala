/** FREEZE by email, a refused agent request, then the owner unfreezes. Prints every tx for the evidence table. */
import { chainClient } from "../../../worker/src/chain.js";
import { relayRaw } from "../../../worker/src/relay.js";
import { keyFromTxt } from "../../../src/lib/dkim.js";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { requestPayment, subjectFor, write } from "../lib/fala.js";
import { signStandin } from "./standin.js";
import { vendors } from "../lib/config.js";

const env = process.env as unknown as Parameters<typeof chainClient>[0];
const c = chainClient(env);
const approver = process.env.APPROVER_EMAIL!;
const pub = crypto.createPublicKey(readFileSync(new URL("../../../.secrets/test-key-standin.pem", import.meta.url)));
const txt = `v=DKIM1; k=rsa; p=${(pub.export({ type: "spki", format: "der" }) as Buffer).toString("base64")}`;

const raw = new TextEncoder().encode(await signStandin({ subject: await subjectFor(0n, 3), from: `Approver <${approver}>` }));
const res = await relayRaw(raw, { approverEmail: approver, getKey: () => keyFromTxt(txt), check: c.check, submit: c.submit, intent: c.intent, errorName: c.errorName });
console.log("freeze email  ->", res.kind === "done" ? res.text.replace("\n", "  ") : JSON.stringify(res));

const r = await requestPayment(vendors().VENDOR_A, "0.10", "after freeze");
console.log(`agent request -> ${r.status} (${r.reason})  ${r.explorerUrl}`);

const u = await write("owner", "unfreeze", []);
console.log(`owner unfreeze -> ${c.explorerTx(u.hash)}`);
