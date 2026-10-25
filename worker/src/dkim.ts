/**
 * DKIM helpers shared by the dashboard, the email Worker and the agent (the Worker keeps an identical copy).
 *
 * Builds exactly what Fala's contract verifies: the relaxed-canonicalized signed header block (RFC 6376 §3.4.2,
 * a=rsa-sha256, c=relaxed/relaxed) followed by the DKIM-Signature header itself with `b=` emptied and no trailing CRLF.
 * Bytes are handled as latin1 so the signed bytes round-trip exactly.
 */

type Bytes = Uint8Array<ArrayBuffer>;

export type Header = { name: string; value: string };

export type ParsedEmail = {
  headerBlock: Bytes;
  sig: Bytes;
  d: string;
  s: string;
  t: number;
  from: string; // address only, lowercased
  subject: string;
  signedHeaders: string[];
};

export const latin1ToBytes = (s: string): Bytes => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
export const bytesToLatin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};
export const bytesToHex = (b: Uint8Array): `0x${string}` => ("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
export const hexToBytes = (h: string): Bytes => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out: Bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
export const base64ToBytes = (b64: string): Bytes => {
  const bin = atob(b64.replace(/\s+/g, ""));
  return latin1ToBytes(bin);
};

/** Split a raw RFC 5322 message into its header fields (folding preserved in `value`). */
export function parseHeaders(raw: string | Uint8Array): Header[] {
  const text = typeof raw === "string" ? raw : bytesToLatin1(raw);
  const lines = text.split(/\r?\n/);
  const headers: Header[] = [];
  for (const line of lines) {
    if (line === "") break; // end of header section
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].value += "\r\n" + line;
      continue;
    }
    const i = line.indexOf(":");
    if (i < 1) continue;
    headers.push({ name: line.slice(0, i), value: line.slice(i + 1) });
  }
  return headers;
}

/** RFC 6376 §3.4.2 relaxed header canonicalization (without the trailing CRLF). */
export function canonHeaderRelaxed(name: string, value: string): string {
  const v = value
    .replace(/\r?\n(?=[ \t])/g, "") // unfold
    .replace(/[ \t]+/g, " ") // compress whitespace runs
    .replace(/^ /, "") // whitespace after the colon
    .replace(/ $/, ""); // whitespace at the end
  return `${name.trim().toLowerCase()}:${v}`;
}

/** Split DKIM tags, keeping the original text of every segment so `b=` can be emptied without touching `bh=`. */
export function parseTags(value: string): { raw: string[]; tags: Record<string, string> } {
  const raw = value.split(";");
  const tags: Record<string, string> = {};
  for (const seg of raw) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    const name = seg.slice(0, eq).trim();
    if (!(name in tags)) tags[name] = seg.slice(eq + 1).replace(/\s+/g, " ").trim();
  }
  return { raw, tags };
}

/** The DKIM-Signature value with the `b=` tag emptied (and only that tag). */
export function emptySignatureTag(value: string): string {
  return value
    .split(";")
    .map((seg) => {
      const eq = seg.indexOf("=");
      return eq >= 0 && seg.slice(0, eq).trim() === "b" ? seg.slice(0, eq + 1) : seg;
    })
    .join(";");
}

export function extractAddress(fromValue: string): string {
  const v = fromValue.trim();
  const lt = v.lastIndexOf("<");
  const addr = lt >= 0 ? v.slice(lt + 1, v.indexOf(">", lt) < 0 ? undefined : v.indexOf(">", lt)) : v;
  return addr.trim().toLowerCase();
}

export type ParseOptions = { domain?: string; selector?: string };

/** Parse a raw .eml and build the contract inputs from its DKIM-Signature (default: the one with d=gmail.com). */
export function parseEmail(raw: string | Uint8Array, opts: ParseOptions = {}): ParsedEmail {
  const wantDomain = (opts.domain ?? "gmail.com").toLowerCase();
  const headers = parseHeaders(raw);

  const candidates = headers.filter((h) => h.name.toLowerCase() === "dkim-signature");
  if (!candidates.length) throw new Error("No DKIM-Signature header found in this email");
  const dkim = candidates.find((h) => {
    const t = parseTags(h.value).tags;
    return (t.d ?? "").toLowerCase() === wantDomain && (!opts.selector || t.s === opts.selector);
  });
  if (!dkim) throw new Error(`No DKIM-Signature with d=${wantDomain} found`);

  const { tags } = parseTags(dkim.value);
  if ((tags.a ?? "").toLowerCase() !== "rsa-sha256") throw new Error(`Unsupported DKIM algorithm a=${tags.a}`);
  const c = (tags.c ?? "simple/simple").toLowerCase();
  if (c !== "relaxed/relaxed" && c !== "relaxed") throw new Error(`Unsupported canonicalization c=${tags.c}`);
  if (!tags.b || !tags.h || !tags.d || !tags.s) throw new Error("DKIM-Signature is missing b=, h=, d= or s=");

  // headers named in h=, bottom-most unused instance first (RFC 6376 §5.4.2)
  const used = new Set<number>();
  const lines: string[] = [];
  const signedHeaders = tags.h.split(":").map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const name of signedHeaders) {
    for (let i = headers.length - 1; i >= 0; i--) {
      if (!used.has(i) && headers[i].name.trim().toLowerCase() === name) {
        used.add(i);
        lines.push(canonHeaderRelaxed(headers[i].name, headers[i].value));
        break;
      }
    }
  }
  const dkimLine = canonHeaderRelaxed(dkim.name, emptySignatureTag(dkim.value));
  const block = [...lines, dkimLine].join("\r\n");

  const find = (n: string) => headers.filter((h) => h.name.trim().toLowerCase() === n).at(-1);
  const from = find("from");
  const subject = find("subject");
  return {
    headerBlock: latin1ToBytes(block),
    sig: base64ToBytes(tags.b),
    d: tags.d.toLowerCase(),
    s: tags.s.toLowerCase(),
    t: tags.t ? Number(tags.t) : 0,
    from: from ? extractAddress(from.value) : "",
    subject: subject ? canonHeaderRelaxed("subject", subject.value).slice("subject:".length) : "",
    signedHeaders,
  };
}

// ------------------------------------------------------------------ local verification (WebCrypto)

export type DkimKeyMaterial = { spki: Bytes; n: Bytes; e: Bytes };

/** Parse a DKIM DNS TXT record ("v=DKIM1; k=rsa; p=<base64 SPKI>") and export its modulus/exponent. */
export async function keyFromTxt(txt: string): Promise<DkimKeyMaterial> {
  const p = /(?:^|;)\s*p=([^;]+)/.exec(txt.replace(/"/g, ""))?.[1]?.replace(/\s+/g, "");
  if (!p) throw new Error("DKIM key record has no p= value (revoked key?)");
  const spki = base64ToBytes(p);
  const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const b64u = (s: string) => base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/"));
  return { spki, n: b64u(jwk.n!), e: b64u(jwk.e!) };
}

/** Look up `<selector>._domainkey.<domain>` through Cloudflare DNS-over-HTTPS. */
export async function fetchDkimKey(domain: string, selector: string): Promise<DkimKeyMaterial> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(`${selector}._domainkey.${domain}`)}&type=TXT`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  const json = (await res.json()) as { Answer?: { data: string }[] };
  const txt = json.Answer?.map((a) => a.data).join("");
  if (!txt) throw new Error(`No DKIM key at ${selector}._domainkey.${domain}`);
  return keyFromTxt(txt);
}

/** RSASSA-PKCS1-v1_5 / SHA-256 over the header block — the same check the contract performs. */
export async function verifyBlock(headerBlock: Bytes, sig: Bytes, spki: Bytes): Promise<boolean> {
  const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, headerBlock);
}

/** Subject grammar the contract enforces. */
export const SUBJECT_RE = /^(?:[Rr][Ee]: )?FALA (APPROVE|DENY) ([1-9][0-9]{0,17}) ([0-9a-f]{8})$/;
export const FREEZE_SUBJECT = "FALA FREEZE 0 0";
