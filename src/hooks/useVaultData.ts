import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { falaVaultAbi } from "../lib/abi";
import { DEMO, VAULT, VAULT_DEPLOY_BLOCK } from "../config/chain";
import type { AgentRow, FeedEvent, PendingRow } from "../lib/types";
import { demoAgents, demoEvents } from "../lib/demo";

const WINDOW = 9_999n; // eth_getLogs on Arc is capped at ~10k blocks
const POLL = 3_000;
const vaultEvents = falaVaultAbi.filter((x) => x.type === "event");

export type VaultState = {
  balance: bigint;
  paused: boolean;
  pendingTtl: number;
  totalBlocked: bigint;
  totalExecuted: bigint;
  owner?: `0x${string}`;
  agents: AgentRow[];
};

const demoState: VaultState = {
  balance: 14_500_000n,
  paused: false,
  pendingTtl: 3600,
  totalBlocked: 5n,
  totalExecuted: 2n,
  agents: demoAgents,
};

async function loadState(c: PublicClient): Promise<VaultState> {
  const base = { address: VAULT!, abi: falaVaultAbi } as const;
  const [balance, paused, ttl, tb, te, owner, list] = await Promise.all([
    c.readContract({ ...base, functionName: "vaultBalance" }),
    c.readContract({ ...base, functionName: "paused" }),
    c.readContract({ ...base, functionName: "pendingTtl" }),
    c.readContract({ ...base, functionName: "totalBlocked" }),
    c.readContract({ ...base, functionName: "totalExecuted" }),
    c.readContract({ ...base, functionName: "owner" }),
    c.readContract({ ...base, functionName: "getAgents" }),
  ]);
  const today = Math.floor(Date.now() / 1000 / 86400);
  const agents = await Promise.all(
    list.map(async (address): Promise<AgentRow> => {
      const [p, d, blocked] = await Promise.all([
        c.readContract({ ...base, functionName: "getPolicy", args: [address] }),
        c.readContract({ ...base, functionName: "dayState", args: [address] }),
        c.readContract({ ...base, functionName: "blockedCount", args: [address] }),
      ]);
      const fresh = d[0] === today;
      return {
        address,
        policy: {
          perTxCap: p.perTxCap,
          dailyCap: p.dailyCap,
          coSignThreshold: p.coSignThreshold,
          expiry: Number(p.expiry),
          maxTxPerDay: p.maxTxPerDay,
          active: p.active,
          auditor: p.auditor,
        },
        spentToday: fresh ? d[1] : 0n,
        txToday: fresh ? d[2] : 0,
        blocked: Number(blocked),
      };
    }),
  );
  return { balance, paused, pendingTtl: Number(ttl), totalBlocked: tb, totalExecuted: te, owner, agents };
}

export function useVaultState() {
  const client = usePublicClient();
  const q = useQuery({
    queryKey: ["vault-state", VAULT],
    queryFn: () => loadState(client as PublicClient),
    refetchInterval: POLL,
    enabled: !DEMO && !!client,
  });
  return { state: DEMO ? demoState : q.data, loading: !DEMO && q.isLoading, error: q.error as Error | null, refetch: q.refetch };
}

type RawLog = { eventName: string; args: Record<string, any>; blockNumber: bigint; logIndex: number; transactionHash: string };

function toFeed(l: RawLog, ts: number): FeedEvent | null {
  const base = { id: `${l.transactionHash}-${l.logIndex}`, tx: l.transactionHash, block: l.blockNumber, logIndex: l.logIndex, ts };
  const x = l.args;
  switch (l.eventName) {
    case "SpendExecuted":
      return { ...base, kind: "executed", agent: x.agent, payee: x.payee, amount: x.amount, note: x.note, pendingId: x.pendingId };
    case "SpendBlocked":
      return { ...base, kind: "blocked", agent: x.agent, payee: x.payee, amount: x.amount, reason: Number(x.reason), note: x.note };
    case "SpendQueued":
      return { ...base, kind: "queued", agent: x.agent, payee: x.payee, amount: x.amount, note: x.note, pendingId: x.pendingId };
    case "SpendApproved":
      return { ...base, kind: "approved", pendingId: x.pendingId, by: x.approver };
    case "SpendRejected":
      return { ...base, kind: "rejected", pendingId: x.pendingId, by: x.by, reason: Number(x.reason) };
    default:
      return null;
  }
}

/** Reads ONLY vault events (never USDC Transfer logs), paged in 9,999-block windows, then polls the tip. */
export function useVaultEvents() {
  const client = usePublicClient();
  const [events, setEvents] = useState<FeedEvent[]>(DEMO ? demoEvents : []);
  const [loading, setLoading] = useState(!DEMO);
  const cursor = useRef<bigint | null>(null);
  const tsCache = useRef(new Map<bigint, number>());

  useEffect(() => {
    if (DEMO || !client) return;
    let stop = false;

    const stamp = async (n: bigint) => {
      const hit = tsCache.current.get(n);
      if (hit) return hit;
      const b = await client.getBlock({ blockNumber: n });
      tsCache.current.set(n, Number(b.timestamp));
      return Number(b.timestamp);
    };

    const sync = async () => {
      try {
        const tip = await client.getBlockNumber();
        let from = cursor.current === null ? VAULT_DEPLOY_BLOCK : cursor.current + 1n;
        const fresh: FeedEvent[] = [];
        while (from <= tip && !stop) {
          const to = from + WINDOW - 1n < tip ? from + WINDOW - 1n : tip;
          const logs = (await client.getLogs({ address: VAULT!, events: vaultEvents as any, fromBlock: from, toBlock: to })) as unknown as RawLog[];
          const blocks = [...new Set(logs.map((l) => l.blockNumber))];
          await Promise.all(blocks.map(stamp));
          for (const l of logs) {
            const f = toFeed(l, tsCache.current.get(l.blockNumber)!);
            if (f) fresh.push(f);
          }
          from = to + 1n;
        }
        if (stop) return;
        cursor.current = tip;
        if (fresh.length) {
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...fresh.filter((e) => !seen.has(e.id))].sort((a, b) =>
              a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1,
            );
          });
        }
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };

    sync();
    const t = setInterval(sync, POLL);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [client]);

  return { events, loading };
}

/** Queued spends that have no approval/rejection event yet. */
export function derivePending(events: FeedEvent[]): PendingRow[] {
  const resolved = new Set(events.filter((e) => e.kind === "approved" || e.kind === "rejected").map((e) => e.pendingId));
  return events
    .filter((e) => e.kind === "queued" && !resolved.has(e.pendingId))
    .map((e) => ({ id: e.pendingId!, agent: e.agent!, payee: e.payee!, amount: e.amount!, note: e.note ?? "", createdAt: e.ts, tx: e.tx }))
    .reverse();
}

export function protectedAmount(events: FeedEvent[]) {
  return events.filter((e) => e.kind === "blocked").reduce((s, e) => s + (e.amount ?? 0n), 0n);
}

export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}
