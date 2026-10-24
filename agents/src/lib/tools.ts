import { z } from "zod";
import type { Address } from "viem";
import { addresses } from "./config.js";
import { addressOf, budget, checkSpend, payeeAllowed, pendingStatus, spend } from "./vault.js";

const GUARD = "Spending is enforced onchain by the Fala vault. Blocked requests are recorded publicly. Do not retry blocked requests with altered amounts to evade limits.";
const spendShape = { payee: z.string().regex(/^0x[a-fA-F0-9]{40}$/), amount_usdc: z.string(), note: z.string().max(140) };

export type Tool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (input: any) => Promise<unknown>;
};

export const tools: Tool[] = [
  {
    name: "get_budget",
    description: `Your spending policy and what is left today. Call this first. ${GUARD}`,
    shape: {},
    run: () => budget(addressOf("worker")),
  },
  {
    name: "list_allowed_payees",
    description: "Known vendors you may pay, confirmed against the onchain allowlist.",
    shape: {},
    run: async () => {
      const me = addressOf("worker");
      const rows = await Promise.all(
        Object.entries(addresses()).filter(([k]) => k.startsWith("VENDOR")).map(async ([label, address]) => ({
          label, address, allowed: await payeeAllowed(me, address as Address),
        })),
      );
      return rows.filter((r) => r.allowed).map(({ label, address }) => ({ label, address }));
    },
  },
  {
    name: "check_spend",
    description: `Dry-run a payment against the vault without sending it. ${GUARD}`,
    shape: spendShape,
    run: (i) => checkSpend(addressOf("worker"), i.payee, i.amount_usdc, i.note),
  },
  {
    name: "request_spend",
    description: `Pay a vendor in USDC through the vault. Amounts above the co-sign threshold are queued for an independent auditor. ${GUARD}`,
    shape: spendShape,
    run: (i) => spend("worker", i.payee, i.amount_usdc, i.note),
  },
  {
    name: "get_spend_status",
    description: "Status of a queued spend by pendingId.",
    shape: { pendingId: z.string() },
    run: (i) => pendingStatus(BigInt(i.pendingId)),
  },
];
