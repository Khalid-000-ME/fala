import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { dkimSign } from "mailauth";
import { keyFromTxt } from "../dkim";
import { relayRaw, type RelayDeps } from "../relay";
import { approvalEmail, approvalSubject, friendlyExpiry, receiptEmail } from "../mail";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const txt = `v=DKIM1; k=rsa; p=${(publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64")}`;
const APPROVER = "approver@gmail.com";

async function eml(subject: string, from = `Approver <${APPROVER}>`, domain = "gmail.com") {
  const raw = `From: ${from}\r\nTo: approve@fala.example\r\nSubject: ${subject}\r\nDate: Mon, 26 Oct 2026 10:00:00 +0000\r\nMessage-ID: <x@mail.gmail.com>\r\n\r\nbody\r\n`;
  const { signatures } = await dkimSign(raw, {
    canonicalization: "relaxed/relaxed",
    signatureData: [{ signingDomain: domain, selector: "unit", privateKey: pem, algorithm: "rsa-sha256", canonicalization: "relaxed/relaxed", headerList: "from:to:subject:date:message-id" }],
  } as never);
  return new TextEncoder().encode(signatures + raw);
}

const outcome = { txHash: "0xabc", explorerUrl: "https://explorer.example/tx/0xabc", gasUsed: 400_000n };
function deps(over: Partial<RelayDeps> = {}): RelayDeps & { submit: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> } {
  return {
    approverEmail: APPROVER,
    getKey: () => keyFromTxt(txt),
    check: vi.fn(async () => ({ verb: 1, id: 42n })),
    submit: vi.fn(async () => ({ ...outcome, verb: "APPROVE", paid: true })),
    intent: async () => ({ id: "42", payee: "0xvendor", amount: "2.00", memo: "annual API plan", status: "APPROVED" }),
    errorName: (e) => (e as Error).message,
    label: () => "DataCo",
    ...over,
  } as never;
}

describe("relayRaw", () => {
  it("relays a verified approval and reports it", async () => {
    const d = deps();
    const r = await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b"), d);
    expect(r.kind).toBe("done");
    expect(d.check).toHaveBeenCalledOnce();
    expect(d.submit).toHaveBeenCalledOnce();
    expect(r.kind === "done" && r.text).toContain("Paid ✅ 2.00 USDC to DataCo");
  });

  it("reports deny, freeze and expiry outcomes", async () => {
    const mk = (verb: string, v: number) => deps({ check: vi.fn(async () => ({ verb: v, id: 42n })), submit: vi.fn(async () => ({ ...outcome, verb })) as never });
    expect(((await relayRaw(await eml("FALA DENY 42 7f3a9c1b"), mk("DENY", 2))) as { text: string }).text).toContain("Denied");
    expect(((await relayRaw(await eml("FALA FREEZE 0 1a2b3c4d"), mk("FREEZE", 3))) as { text: string }).text).toContain("frozen");
    expect(((await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b"), mk("EXPIRED", 1))) as { text: string }).text).toContain("expired");
  });

  it("never spends gas on mail from anyone else", async () => {
    const d = deps();
    const r = await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b", "Mallory <mallory@gmail.com>"), d);
    expect(r.kind).toBe("ignored");
    expect(d.check).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("ignores unsigned mail, oversized mail and other domains", async () => {
    const d = deps();
    const plain = new TextEncoder().encode("From: approver@gmail.com\r\nSubject: FALA APPROVE 1 deadbeef\r\n\r\nhi\r\n");
    expect((await relayRaw(plain, d)).kind).toBe("ignored");
    expect((await relayRaw(new Uint8Array(300_000), d)).kind).toBe("ignored");
    expect((await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b", `Approver <${APPROVER}>`, "evil.example"), d)).kind).toBe("ignored");
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("stops at local DKIM verification for a tampered message", async () => {
    const d = deps();
    const bytes = await eml("FALA APPROVE 42 7f3a9c1b");
    const tampered = new TextEncoder().encode(new TextDecoder().decode(bytes).replace("APPROVE 42", "APPROVE 43"));
    const r = await relayRaw(tampered, d);
    expect(r).toMatchObject({ kind: "rejected", stage: "dkim" });
    expect(d.check).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("explains the contract's named refusal and does not submit", async () => {
    const d = deps({ check: vi.fn(async () => { throw new Error("CodeMismatch"); }) });
    const r = await relayRaw(await eml("FALA APPROVE 42 00000000"), d);
    expect(r).toMatchObject({ kind: "rejected", stage: "contract", error: "CodeMismatch" });
    expect(r.kind === "rejected" && r.text).toMatch(/exact payment request/);
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("fails closed when the DKIM key cannot be fetched", async () => {
    const d = deps({ getKey: async () => { throw new Error("no DNS answer"); } });
    const r = await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b"), d);
    expect(r).toMatchObject({ kind: "rejected", stage: "dkim" });
    expect(d.submit).not.toHaveBeenCalled();
  });
});

const decode = (raw: string) =>
  [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8")).join("\n");
const header = (raw: string, name: string) => {
  const v = raw.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";
  const enc = v.match(/^=\?UTF-8\?B\?(.+)\?=$/);
  return enc ? Buffer.from(enc[1], "base64").toString("utf8") : v;
};
const htmlPart = (raw: string) =>
  [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8")).at(-1)!;

describe("approval email", () => {
  const mail = {
    from: "fala.relay@gmail.com", to: APPROVER, inbound: "fala.relay@gmail.com", id: "42", amount: "2.00", payee: "DataCo",
    payeeAddress: "0xFA1aA7EF6530feeCE52b13C4B413Cf191091451c", memo: "annual API plan", agent: "Worker agent", vault: "Procurement vault",
    expiresAt: Math.floor(Date.now() / 1000) + 3600, approveSubject: "FALA APPROVE 42 7f3a9c1b", denySubject: "FALA DENY 42 7f3a9c1b", freezeSubject: "FALA FREEZE 0 0",
  };
  const raw = approvalEmail(mail);
  const body = decode(raw);

  it("has a friendly, specific subject and sender name", () => {
    expect(header(raw, "Subject")).toBe("Approve 2.00 USDC to DataCo? (Request #42)");
    expect(approvalSubject(mail)).toBe("Approve 2.00 USDC to DataCo? (Request #42)");
    expect(header(raw, "From")).toBe("Fala Approvals <fala.relay@gmail.com>");
  });

  it("has Approve and Deny buttons with url-encoded subjects and a pre-written friendly reply", () => {
    expect(body).toContain("mailto:fala.relay@gmail.com?subject=FALA%20APPROVE%2042%207f3a9c1b&amp;body=");
    expect(body).toContain("mailto:fala.relay@gmail.com?subject=FALA%20DENY%2042%207f3a9c1b&amp;body=");
    expect(body).toContain("mailto:fala.relay@gmail.com?subject=FALA%20FREEZE%200%200&amp;body=");
    expect(decodeURIComponent(body.match(/APPROVE%2042%207f3a9c1b&amp;body=([^"]+)"/)![1])).toContain("Yes, please go ahead and pay 2.00 USDC to DataCo.");
  });

  it("explains the code in plain words and shows the payment details", () => {
    expect(body).toContain("Google signs your reply");
    expect(body).toContain("Nothing moves until you say yes");
    expect(body).toContain("annual API plan");
    expect(body).toContain("Procurement vault");
    expect(body).toContain("Worker agent");
  });

  it("has a readable plain-text part with the exact subjects", () => {
    expect(body).toContain("TO APPROVE");
    expect(body).toContain("  FALA APPROVE 42 7f3a9c1b");
    expect(body).toContain("Why the code?");
  });

  it("escapes anything the agent controls", () => {
    const evil = htmlPart(approvalEmail({ ...mail, memo: '<script>alert(1)</script> "x"', payee: "<b>x</b>" }));
    expect(evil).not.toContain("<script>");
    expect(evil).toContain("&lt;script&gt;");
  });

  it("formats expiry in friendly terms", () => {
    const now = 1_800_000_000;
    expect(friendlyExpiry(now + 59 * 60, now)).toMatch(/^in 59 minutes \(/);
    expect(friendlyExpiry(now + 3 * 3600, now)).toMatch(/^in 3 hours \(/);
    expect(friendlyExpiry(now + 3 * 86400, now)).toMatch(/^in 3 days \(/);
    expect(friendlyExpiry(now - 5, now)).toMatch(/^expired/);
  });
});

describe("receipt emails", () => {
  const base = { from: "fala.relay@gmail.com", to: APPROVER };
  it("confirms a payment with a transaction link", () => {
    const raw = receiptEmail({ ...base, kind: "paid", amount: "1.20", payee: "DataCo", memo: "credits", id: "3", explorerUrl: "https://explorer.example/tx/0xabc" });
    expect(header(raw, "Subject")).toBe("Payment sent: 1.20 USDC to DataCo ✓");
    const body = decode(raw);
    expect(body).toContain("https://explorer.example/tx/0xabc");
    expect(body).toContain("Arc verified Google's signature");
  });
  it("has a clear subject for every outcome", () => {
    const subj = (kind: Parameters<typeof receiptEmail>[0]["kind"]) => header(receiptEmail({ ...base, kind, amount: "1.00", payee: "A" }), "Subject");
    expect(subj("denied")).toBe("You denied the 1.00 USDC payment to A");
    expect(subj("frozen")).toMatch(/^Vault frozen/);
    expect(subj("expired")).toMatch(/expired/);
    expect(subj("failed")).toMatch(/couldn't be sent/);
    expect(subj("refused")).toBe("We couldn't process that reply");
  });
  it("answers a duplicate reply calmly instead of sounding like an error", async () => {
    const d = deps({ check: vi.fn(async () => { throw new Error("IntentNotPending"); }) });
    const r = await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b"), d);
    expect(r.kind === "rejected" && r.receipt).toMatchObject({ kind: "duplicate", id: "42", status: "APPROVED", amount: "2.00", payee: "DataCo" });
    const raw = receiptEmail({ ...base, ...(r.kind === "rejected" ? r.receipt : { kind: "duplicate" as const }) });
    expect(header(raw, "Subject")).toBe("Already handled: request #42");
    expect(decode(raw)).toContain("was already approved");
    expect(decode(raw)).toContain("There's no need to reply again");
    expect(d.submit).not.toHaveBeenCalled();
  });
  it("relay results carry a structured receipt", async () => {
    const d = deps();
    const r = await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b"), d);
    expect(r.kind === "done" && r.receipt).toMatchObject({ kind: "paid", amount: "2.00", payee: "DataCo", id: "42" });
    const refused = await relayRaw(await eml("FALA APPROVE 42 7f3a9c1b"), deps({ check: vi.fn(async () => { throw new Error("CodeMismatch"); }) }));
    expect(refused.kind === "rejected" && refused.receipt.kind).toBe("refused");
  });
});
