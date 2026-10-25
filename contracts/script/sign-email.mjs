#!/usr/bin/env node
// Test-fixture signer used by Foundry via `vm.ffi`. Builds a relaxed-canonicalized DKIM header block and signs it
// with a throwaway RSA-2048 key. NOT Gmail: it stands in for Gmail's key so every refusal path can be exercised.
//
//   node script/sign-email.mjs '{"mode":"key","key":"A"}'      -> abi.encode(bytes n, bytes e)
//   node script/sign-email.mjs '{"key":"A","from":..., ...}'   -> abi.encode(bytes headerBlock, bytes sig)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.env.FALA_KEY_DIR ?? "cache/fala-keys");
const keyPath = (name) => path.join(DIR, `test-key-${name}.pem`);

function privateKey(name) {
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(keyPath(name))) {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    try {
      fs.writeFileSync(keyPath(name), pem, { flag: "wx" }); // exclusive: parallel tests race safely
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  return crypto.createPrivateKey(fs.readFileSync(keyPath(name)));
}

const hex = (buf) => Buffer.from(buf).toString("hex");
const pad32 = (n) => n.toString(16).padStart(64, "0");
const padded = (buf) => hex(buf) + "00".repeat((32 - (buf.length % 32)) % 32);

function encodeBytesBytes(a, b) {
  const aSize = 32 + Math.ceil(a.length / 32) * 32;
  return "0x" + pad32(64) + pad32(64 + aSize) + pad32(a.length) + padded(a) + pad32(b.length) + padded(b);
}

const spec = JSON.parse(process.argv[2]);
const key = privateKey(spec.key ?? "A");

if (spec.mode === "keyhex") {
  const jwk = crypto.createPublicKey(key).export({ format: "jwk" });
  process.stdout.write(JSON.stringify({ n: "0x" + hex(Buffer.from(jwk.n, "base64url")), e: "0x" + hex(Buffer.from(jwk.e, "base64url")) }));
  process.exit(0);
}

if (spec.mode === "key") {
  const jwk = crypto.createPublicKey(key).export({ format: "jwk" });
  process.stdout.write(encodeBytesBytes(Buffer.from(jwk.n, "base64url"), Buffer.from(jwk.e, "base64url")));
  process.exit(0);
}

const d = spec.d ?? "gmail.com";
const s = spec.s ?? "test";
const t = spec.t ?? Math.floor(Date.now() / 1000);
const a = spec.a ?? "rsa-sha256";
const c = spec.c ?? "relaxed/relaxed";
const h = spec.h ?? "from:to:subject:date";

// canonical (relaxed) header lines, lowercase names, no space around the colon
const lines = spec.lines ?? [
  `from:${spec.from ?? "Fala Approver <approver@gmail.com>"}`,
  `to:${spec.to ?? "approve@fala.example"}`,
  `subject:${spec.subject ?? "FALA APPROVE 1 deadbeef"}`,
  `date:${spec.date ?? "Mon, 26 Oct 2026 10:00:00 +0000"}`,
];
let tags = `v=1; a=${a}; c=${c}; d=${d}; s=${s}; t=${t}; h=${h}; bh=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=; b=`;
if (spec.dkimTags) tags = spec.dkimTags; // full override for malformed-tag cases
const dkim = `dkim-signature:${tags}`;

let block = [...lines, ...(spec.noDkim ? [] : [dkim])].join("\r\n");
const sig = crypto.sign("sha256", Buffer.from(block, "latin1"), key);

if (spec.dkimNotLast) block += "\r\nx-trailing:1";
let out = Buffer.from(block, "latin1");
if (spec.flipByte !== undefined) out[spec.flipByte % out.length] ^= 0x01; // tamper AFTER signing

process.stdout.write(encodeBytesBytes(out, sig));
