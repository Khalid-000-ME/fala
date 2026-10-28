import { isAddress, parseUnits, type Address, type Hex } from "viem";
import { unseal } from "./crypto.js";
import { agentCfg, intentInfo, requestPayment, vaultState } from "./chain.js";

type AgentRow = { address: string; enc_key?: string | null; vault_address: string; kind: string };

const usdc = (v: bigint) => (Number(v) / 1e6).toString();

export async function allowanceFor(a: AgentRow) {
  const [cfg, st] = await Promise.all([agentCfg(a.vault_address as Address, a.address as Address), vaultState(a.vault_address as Address)]);
  return {
    registered: cfg.active, autoPerTx: usdc(cfg.autoPerTx), autoDaily: usdc(cfg.autoDaily), hardCap: usdc(cfg.hardCap),
    autoSpentToday: usdc(cfg.autoSpentToday), vaultBalance: usdc(st.balance), frozen: st.frozen,
    note: "Payments above your allowance (or to an unknown payee) are emailed to your human for approval. You cannot approve them yourself. Do not split payments to stay under the allowance.",
  };
}

export async function payFor(a: AgentRow, payee: string, amountUsdc: string, memo: string) {
  if (!a.enc_key) throw new Error("this agent signs with its own key; call the vault contract directly");
  if (!isAddress(payee)) throw new Error("payee must be an address");
  if (!/^\d+(\.\d{1,6})?$/.test(amountUsdc)) throw new Error('amount_usdc must look like "0.10"');
  if (memo.length > 140) throw new Error("memo is limited to 140 characters");
  const r = await requestPayment(a.vault_address as Address, unseal(a.enc_key) as Hex, payee, parseUnits(amountUsdc, 6), memo);
  return {
    ...r,
    message: r.status === "pending" ? "Waiting for human approval by email. Poll payment_status with this intentId." : r.status === "auto_paid" ? "Paid instantly within your allowance." : `Rejected: ${r.reason}`,
  };
}

export const statusFor = async (a: AgentRow, intentId: string) => {
  const i = await intentInfo(a.vault_address as Address, BigInt(intentId));
  if (i.agent.toLowerCase() !== a.address.toLowerCase()) throw new Error("that request belongs to another agent");
  return { intentId: i.id, status: i.status, amount: i.amount, payee: i.payee, expiresAt: new Date(i.expiresAt * 1000).toISOString() };
};
