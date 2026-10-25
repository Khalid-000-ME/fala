import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { dkimSign, dkimVerify } from "mailauth";
import { bytesToLatin1, canonHeaderRelaxed, emptySignatureTag, extractAddress, keyFromTxt, parseEmail, verifyBlock } from "../dkim";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const spkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
const txt = `v=DKIM1; k=rsa; p=${spkiB64}`;

const base = (subject: string, extra = "") =>
  `From: Fala Approver <Approver@Gmail.com>\r\nTo: approve@fala.example\r\nSubject: ${subject}\r\nDate: Mon, 26 Oct 2026 10:00:00 +0000\r\nMessage-ID: <abc@mail.gmail.com>\r\n${extra}\r\nhello body\r\n`;

async function signed(subject: string, opts: { extra?: string; headers?: string } = {}) {
  const raw = base(subject, opts.extra);
  const { signatures, errors } = await dkimSign(raw, {
    canonicalization: "relaxed/relaxed",
    signTime: new Date("2026-10-26T10:00:00Z"),
    signatureData: [
      {
        signingDomain: "gmail.com",
        selector: "unit",
        privateKey: pem,
        algorithm: "rsa-sha256",
        canonicalization: "relaxed/relaxed",
        headerList: opts.headers ?? "from:to:subject:date:message-id",
      },
    ],
  });
  expect(errors).toEqual([]);
  return signatures + raw;
}

describe("relaxed canonicalization (RFC 6376 §3.4.2)", () => {
  it("lowercases the name, unfolds, compresses whitespace and trims", () => {
    expect(canonHeaderRelaxed("Subject ", "  hello \t  world \r\n  again  ")).toBe("subject:hello world again");
  });
  it("only empties b=, never bh=", () => {
    const out = emptySignatureTag(" v=1; bh=AAAA; b=BBBB\r\n CCCC; h=from");
    expect(out).toContain("bh=AAAA");
    expect(out).toContain(" b=;");
    expect(out).not.toContain("BBBB");
  });
  it("extracts the address from the last <...>", () => {
    expect(extractAddress('"x <victim@gmail.com>" <Real@Gmail.com>')).toBe("real@gmail.com");
    expect(extractAddress("plain@gmail.com")).toBe("plain@gmail.com");
  });
});

describe("block matches an independent DKIM implementation (mailauth)", () => {
  it("verifies a mailauth-signed email with the block we send to the contract", async () => {
    const eml = await signed("FALA APPROVE 42 7f3a9c1b");
    const p = parseEmail(eml);
    expect(p.d).toBe("gmail.com");
    expect(p.from).toBe("approver@gmail.com");
    expect(p.subject).toBe("FALA APPROVE 42 7f3a9c1b");
    const { spki } = await keyFromTxt(txt);
    expect(await verifyBlock(p.headerBlock, p.sig, spki)).toBe(true);

    // sanity: the independent verifier agrees the email is valid
    const res = await dkimVerify(eml, { resolver: async () => [[txt]] } as never);
    expect(res.results[0].status.result).toBe("pass");
  });

  it("ends with the DKIM-Signature line, b= empty, no trailing CRLF", async () => {
    const p = parseEmail(await signed("FALA APPROVE 1 deadbeef"));
    const block = bytesToLatin1(p.headerBlock);
    const lines = block.split("\r\n");
    expect(lines.at(-1)!.startsWith("dkim-signature:")).toBe(true);
    expect(lines.at(-1)!).toMatch(/b=$/);
    expect(block.endsWith("\r\n")).toBe(false);
    expect(lines.filter((l) => l.startsWith("from:")).length).toBe(1);
  });

  it("detects tampering (changed subject)", async () => {
    const eml = (await signed("FALA APPROVE 42 7f3a9c1b")).replace("FALA APPROVE 42", "FALA APPROVE 43");
    const p = parseEmail(eml);
    const { spki } = await keyFromTxt(txt);
    expect(await verifyBlock(p.headerBlock, p.sig, spki)).toBe(false);
  });

  it("handles folded headers and LF-only line endings", async () => {
    const eml = await signed("FALA APPROVE 7 0a0b0c0d", { extra: "X-Long: aaa\r\n bbb\r\n\tccc\r\n", headers: "from:to:subject:date:x-long" });
    const { spki } = await keyFromTxt(txt);
    const crlf = parseEmail(eml);
    expect(bytesToLatin1(crlf.headerBlock)).toContain("x-long:aaa bbb ccc");
    expect(await verifyBlock(crlf.headerBlock, crlf.sig, spki)).toBe(true);
    const lf = parseEmail(eml.replace(/\r\n/g, "\n"));
    expect(await verifyBlock(lf.headerBlock, lf.sig, spki)).toBe(true);
  });

  it("uses the bottom-most instance of a repeated signed header", async () => {
    const raw = `From: a@gmail.com\r\nSubject: first\r\nSubject: FALA DENY 5 11223344\r\nTo: x@y.z\r\n\r\nbody\r\n`;
    const { signatures } = await dkimSign(raw, {
      canonicalization: "relaxed/relaxed",
      signatureData: [{ signingDomain: "gmail.com", selector: "unit", privateKey: pem, algorithm: "rsa-sha256", canonicalization: "relaxed/relaxed", headerList: "from:subject:to" }],
    });
    const p = parseEmail(signatures + raw);
    expect(p.subject).toBe("FALA DENY 5 11223344");
    expect(await verifyBlock(p.headerBlock, p.sig, (await keyFromTxt(txt)).spki)).toBe(true);
  });

  it("ignores signatures from other domains", async () => {
    const eml = await signed("FALA APPROVE 1 deadbeef");
    expect(() => parseEmail(eml, { domain: "example.org" })).toThrow(/No DKIM-Signature with d=example.org/);
  });

  it("rejects unsupported algorithms", () => {
    const eml = "DKIM-Signature: v=1; a=rsa-sha1; c=relaxed/relaxed; d=gmail.com; s=x; h=from; bh=a; b=b\r\nFrom: a@gmail.com\r\n\r\n";
    expect(() => parseEmail(eml)).toThrow(/Unsupported DKIM algorithm/);
  });
});

describe("DKIM key records", () => {
  it("exports modulus and exponent from the TXT record", async () => {
    const k = await keyFromTxt(`"v=DKIM1; k=rsa; " "p=${spkiB64}"`);
    expect(k.n.length).toBe(256);
    expect([...k.e]).toEqual([1, 0, 1]);
  });
});
