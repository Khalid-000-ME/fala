/**
 * Stand-in for Gmail while testing: signs a real RFC 5322 message with DKIM (mailauth, an independent implementation)
 * using a throwaway key whose public half is registered in the testnet vault as selector "falastandin".
 * The .eml it produces is shaped like a Gmail reply, so everything downstream is the same code path.
 */
import { dkimSign } from "mailauth";
import { readFileSync } from "node:fs";

const KEY_FILE = new URL("../../../.secrets/test-key-standin.pem", import.meta.url);
export const STANDIN_SELECTOR = "falastandin";

export type StandinOpts = {
  from?: string;
  subject: string;
  to?: string;
  domain?: string;
  selector?: string;
  signTime?: Date;
  keyPem?: string;
  headerList?: string;
};

export async function signStandin(o: StandinOpts): Promise<string> {
  const from = o.from ?? "Fala Approver <fala.demo.approver@gmail.com>";
  const date = (o.signTime ?? new Date()).toUTCString().replace("GMT", "+0000");
  const raw =
    `From: ${from}\r\nTo: ${o.to ?? "approve@fala.example"}\r\nSubject: ${o.subject}\r\nDate: ${date}\r\n` +
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@mail.gmail.com>\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${o.subject}\r\n`;
  const { signatures, errors } = await dkimSign(raw, {
    canonicalization: "relaxed/relaxed",
    signTime: o.signTime ?? new Date(),
    signatureData: [
      {
        signingDomain: o.domain ?? "gmail.com",
        selector: o.selector ?? STANDIN_SELECTOR,
        privateKey: o.keyPem ?? readFileSync(KEY_FILE, "utf8"),
        algorithm: "rsa-sha256",
        canonicalization: "relaxed/relaxed",
        headerList: o.headerList ?? "mime-version:from:date:message-id:subject:to",
      },
    ],
  } as never);
  if (errors?.length) throw new Error(`stand-in signing failed: ${JSON.stringify(errors)}`);
  return signatures + raw;
}
