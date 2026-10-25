import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { dkimSign } from "mailauth";
import { keyFromTxt } from "../dkim";
import { relayRaw, type RelayDeps } from "../relay";
import { approvalEmail } from "../mail";

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
    expect(((await relayRaw(await eml("FALA FREEZE 0 0"), mk("FREEZE", 3))) as { text: string }).text).toContain("frozen");
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

describe("approval email", () => {
  const raw = approvalEmail({
    from: "fala@fala.example", to: APPROVER, inbound: "approve@fala.example", id: "42", amount: "2.00", payee: "DataCo",
    memo: "annual API plan", expiresAt: 1_800_000_000, approveSubject: "FALA APPROVE 42 7f3a9c1b", denySubject: "FALA DENY 42 7f3a9c1b", freezeSubject: "FALA FREEZE 0 0",
  });
  const decoded = (() => {
    // decode the base64 parts to inspect the content
    return [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8")).join("\n");
  })();

  it("has three mailto buttons with url-encoded subjects", () => {
    expect(decoded).toContain("mailto:approve@fala.example?subject=FALA%20APPROVE%2042%207f3a9c1b");
    expect(decoded).toContain("mailto:approve@fala.example?subject=FALA%20DENY%2042%207f3a9c1b");
    expect(decoded).toContain("mailto:approve@fala.example?subject=FALA%20FREEZE%200%200");
  });
  it("carries a plain-text fallback and CRLF-separated headers", () => {
    expect(decoded).toContain("FALA APPROVE 42 7f3a9c1b");
    expect(raw.startsWith("From: Fala <fala@fala.example>\r\nTo: approver@gmail.com\r\nSubject: [Fala] Approve 2.00 USDC to DataCo? (#42)")).toBe(true);
  });
});
