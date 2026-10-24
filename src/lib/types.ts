export type Policy = {
  perTxCap: bigint;
  dailyCap: bigint;
  coSignThreshold: bigint;
  expiry: number;
  maxTxPerDay: number;
  active: boolean;
  auditor: `0x${string}`;
};

export type AgentRow = {
  address: `0x${string}`;
  policy: Policy;
  spentToday: bigint;
  txToday: number;
  blocked: number;
};

export type EventKind = "executed" | "blocked" | "queued" | "approved" | "rejected";

export type FeedEvent = {
  id: string;
  kind: EventKind;
  agent?: `0x${string}`;
  payee?: `0x${string}`;
  amount?: bigint;
  reason?: number;
  note?: string;
  pendingId?: bigint;
  by?: `0x${string}`;
  tx: string;
  block: bigint;
  logIndex: number;
  ts: number;
};

export type PendingRow = {
  id: bigint;
  agent: `0x${string}`;
  payee: `0x${string}`;
  amount: bigint;
  note: string;
  createdAt: number;
  tx: string;
};
