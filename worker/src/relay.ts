import { bytesToHex, fetchDkimKey, parseEmail, verifyBlock, type DkimKeyMaterial } from "./dkim";
import { refusalText } from "./refusals";

export type Outcome = { verb: "APPROVE" | "DENY" | "FREEZE" | "EXPIRED"; paid?: boolean; txHash: string; explorerUrl: string; gasUsed: bigint };
export type IntentInfo = { id: string; payee: string; amount: string; memo: string; status: string };

export type RelayDeps = {
  approverEmail: string;
  getKey?: (domain: string, selector: string) => Promise<DkimKeyMaterial>;
  check: (headerBlock: `0x${string}`, sig: `0x${string}`) => Promise<{ verb: number; id: bigint }>;
  submit: (headerBlock: `0x${string}`, sig: `0x${string}`) => Promise<Outcome>;
  intent: (id: bigint) => Promise<IntentInfo>;
  /** Named contract error from a failed eth_call. */
  errorName: (e: unknown) => string;
  label?: (payee: string) => string;
};

export type RelayResult =
  | { kind: "ignored"; why: string }
  | { kind: "rejected"; stage: "dkim" | "contract"; error?: string; text: string }
  | { kind: "done"; outcome: Outcome; text: string };

export const MAX_RAW_BYTES = 256 * 1024;

/**
 * Raw inbound email -> onchain approval. Cheap checks run first so junk never costs gas:
 * size, sender, local DKIM verification, then the contract's own dry run (`checkEmail`).
 */
export async function relayRaw(raw: Uint8Array, d: RelayDeps): Promise<RelayResult> {
  if (raw.length > MAX_RAW_BYTES) return { kind: "ignored", why: "message too large" };

  let p;
  try {
    p = parseEmail(raw, { domain: "gmail.com" });
  } catch (e) {
    return { kind: "ignored", why: `no usable DKIM signature (${(e as Error).message})` };
  }
  if (p.from !== d.approverEmail.toLowerCase()) return { kind: "ignored", why: `sender ${p.from} is not the approver` };

  try {
    const key = await (d.getKey ?? fetchDkimKey)(p.d, p.s);
    if (!(await verifyBlock(p.headerBlock, p.sig, key.spki))) {
      return { kind: "rejected", stage: "dkim", text: "I couldn't verify Google's signature on this email, so nothing was sent onchain." };
    }
  } catch (e) {
    return { kind: "rejected", stage: "dkim", text: `I couldn't check the DKIM key (${(e as Error).message}); nothing was sent onchain.` };
  }

  const hb = bytesToHex(p.headerBlock);
  const sg = bytesToHex(p.sig);
  let checked: { verb: number; id: bigint };
  try {
    checked = await d.check(hb, sg);
  } catch (e) {
    const name = d.errorName(e);
    return { kind: "rejected", stage: "contract", error: name, text: `The vault refused this email (${name}): ${refusalText(name)}` };
  }

  const outcome = await d.submit(hb, sg);
  const info = checked.verb === 3 ? undefined : await d.intent(checked.id);
  const who = info ? (d.label?.(info.payee) ?? info.payee) : "";
  let text: string;
  if (outcome.verb === "FREEZE") text = `Vault frozen 🧊 — agents can't spend until the owner unfreezes it.\n${outcome.explorerUrl}`;
  else if (outcome.verb === "DENY") text = `Denied ❌ — request #${checked.id} will not be paid.\n${outcome.explorerUrl}`;
  else if (outcome.verb === "EXPIRED") text = `Request #${checked.id} had already expired, so it was closed instead of paid.\n${outcome.explorerUrl}`;
  else if (outcome.paid) text = `Paid ✅ ${info?.amount} USDC to ${who} — verified onchain against Google's DKIM key.\n${outcome.explorerUrl}`;
  else text = `Approved, but the payout failed (payee may be blocked). Funds stay in the vault.\n${outcome.explorerUrl}`;
  return { kind: "done", outcome, text };
}
