export type IntentStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "FAILED";

export type FeedKind =
  | "autopaid"
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled"
  | "failed"
  | "rejected"
  | "frozen"
  | "unfrozen"
  | "deposit"
  | "withdraw";

export type FeedEvent = {
  id: string;
  kind: FeedKind;
  agent?: `0x${string}`;
  payee?: `0x${string}`;
  amount?: bigint;
  intentId?: bigint;
  memo?: string;
  reason?: number;
  tx: string;
  block: bigint;
  logIndex: number;
  ts: number;
};

export type IntentRow = {
  id: bigint;
  agent: `0x${string}`;
  payee: `0x${string}`;
  amount: bigint;
  memo: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  status: IntentStatus;
  tx: string;
  settledTx?: string;
  dkimT?: number;
  relayer?: `0x${string}`;
};

export type AgentRow = {
  address: `0x${string}`;
  active: boolean;
  autoPerTx: bigint;
  autoDaily: bigint;
  hardCap: bigint;
  autoSpentToday: bigint;
};

export type KeyRow = {
  id: `0x${string}`;
  domain: string;
  selector: string;
  activeAt: number;
  revoked: boolean;
};

export const REJECTION = ["", "Not a registered agent", "Vault is frozen", "Bad input", "Over the hard cap", "Payout failed"] as const;
