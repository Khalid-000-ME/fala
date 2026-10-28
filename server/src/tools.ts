import { z } from "zod";
import { allowanceFor, payFor, statusFor } from "./agentops.js";

export type AgentCtx = { address: string; enc_key?: string | null; vault_address: string; kind: string };
export type Tool = { name: string; description: string; shape: z.ZodRawShape; run: (a: AgentCtx, input: any) => Promise<unknown> };

const GUARD = "Payments above your allowance are sent to your human for email approval. You cannot approve them yourself. Do not split payments to stay under the allowance.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const tools: Tool[] = [
  { name: "get_allowance", description: `Your automatic spending allowance and what is left today. Call this first. ${GUARD}`, shape: {}, run: (a) => allowanceFor(a) },
  {
    name: "request_payment",
    description: `Pay someone in USDC through your vault. ${GUARD}`,
    shape: {
      payee: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("recipient address"),
      amount_usdc: z.string().describe('amount in USDC, e.g. "0.10"'),
      memo: z.string().max(140).describe("what this payment is for"),
    },
    run: (a, i) => payFor(a, i.payee, i.amount_usdc, i.memo),
  },
  {
    name: "payment_status",
    description: "Status of a pending payment by intentId. Set wait_seconds (max 45) to wait for the human's reply.",
    shape: { intentId: z.string(), wait_seconds: z.number().min(0).max(45).optional() },
    run: async (a, i) => {
      const end = Date.now() + (i.wait_seconds ?? 0) * 1000;
      let s = await statusFor(a, i.intentId);
      while (s.status === "PENDING" && Date.now() < end) { await sleep(3000); s = await statusFor(a, i.intentId); }
      return s;
    },
  },
];
