export const REASON = [
  "—",
  "Vault paused",
  "Unknown agent",
  "Agent frozen",
  "Policy expired",
  "Zero amount",
  "Note too long",
  "Payee not allowlisted",
  "Over per-tx cap",
  "Too many tx today",
  "Over daily cap",
  "Vault underfunded",
  "Transfer failed",
  "Approval expired",
] as const;
export const reasonLabel = (r: number) => REASON[r] ?? `Reason ${r}`;
