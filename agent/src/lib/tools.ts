import { z } from "zod";
import type { Address } from "viem";
import { notifyToken, notifyUrl, vendors } from "./config.js";
import { addressOf, allowance, intent, requestPayment, subjectFor } from "./fala.js";

const GUARD =
  "Payments above your allowance are sent to your human for email approval. You cannot approve them yourself. Do not split payments to stay under the allowance.";

export type Tool = { name: string; description: string; shape: z.ZodRawShape; run: (input: any) => Promise<unknown> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tell the email Worker a payment needs a human. Best effort — the Worker's cron also picks it up. */
async function notify(id: string): Promise<string> {
  const url = notifyUrl();
  if (!url) return "NOTIFY_URL is not set, so no approval email was sent";
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${notifyToken() ?? ""}` },
      body: JSON.stringify({ id }),
    });
    return res.ok ? "approval email sent" : `approval email not sent (worker said ${res.status})`;
  } catch (e) {
    return `approval email not sent (${(e as Error).message})`;
  }
}

export const tools: Tool[] = [
  {
    name: "get_allowance",
    description: `Your automatic spending allowance and what is left today. Call this first. ${GUARD}`,
    shape: {},
    run: () => allowance(),
  },
  {
    name: "list_known_payees",
    description: "Vendors you may pay. Small payments to these are paid instantly; others need approval.",
    shape: {},
    run: async () => Object.entries(vendors()).map(([label, address]) => ({ label, address })),
  },
  {
    name: "request_payment",
    description: `Pay a vendor in USDC through the vault. ${GUARD}`,
    shape: {
      payee: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("vendor address"),
      amount_usdc: z.string().describe('amount in USDC, e.g. "0.10"'),
      memo: z.string().max(140).describe("what this payment is for"),
    },
    run: async (i) => {
      const r = await requestPayment(i.payee as Address, i.amount_usdc, i.memo);
      if (r.status === "pending") {
        const sent = await notify(r.intentId!);
        const subject = await subjectFor(BigInt(r.intentId!), 1);
        return { ...r, message: `Waiting for human approval by email (${sent}). Use payment_status to follow it.`, approveSubject: subject };
      }
      return { ...r, message: r.status === "auto_paid" ? "Paid instantly within your allowance." : `Rejected: ${r.reason}` };
    },
  },
  {
    name: "payment_status",
    description: "Status of a pending payment by intentId. Set wait_seconds (max 60) to wait for the human's reply.",
    shape: { intentId: z.string(), wait_seconds: z.number().min(0).max(60).optional() },
    run: async (i) => {
      const end = Date.now() + (i.wait_seconds ?? 0) * 1000;
      let it = await intent(BigInt(i.intentId));
      while (it.status === "PENDING" && Date.now() < end) {
        await sleep(3000);
        it = await intent(BigInt(i.intentId));
      }
      return { intentId: it.id, status: it.status, amount: it.amount, payee: it.payee, expiresAt: new Date(it.expiresAt * 1000).toISOString() };
    },
  },
];

export const agentAddress = () => addressOf("agent");
