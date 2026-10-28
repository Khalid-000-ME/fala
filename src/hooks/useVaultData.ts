import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseEventLogs, type PublicClient } from "viem";
import { falaVaultAbi } from "../lib/abi";
import { DEMO, VAULT, VAULT_DEPLOY_BLOCK } from "../config/chain";
import type { AgentRow, FeedEvent, IntentRow, KeyRow } from "../lib/types";
import { demoAgents, demoEvents, demoIntents, demoKeys } from "../lib/demo";

const WINDOW = 9_999n; // eth_getLogs on Arc is capped at ~10k blocks
const POLL = 3_000;

export type VaultState = {
  balance: bigint;
  frozen: boolean;
  owner?: `0x${string}`;
  intentTtl: number;
  relayerTip: bigint;
  keyTimelock: number;
  agents: AgentRow[];
  keyFlags: { id: `0x${string}`; activeAt: number; revoked: boolean }[];
};

const demoState: VaultState = {
  balance: 6_400_000n,
  frozen: false,
  intentTtl: 3600,
  relayerTip: 20_000n,
  keyTimelock: 86400,
  agents: demoAgents,
  keyFlags: demoKeys.map((k) => ({ id: k.id, activeAt: k.activeAt, revoked: k.revoked })),
};

async function loadState(c: PublicClient): Promise<VaultState> {
  const base = { address: VAULT!, abi: falaVaultAbi } as const;
  const [balance, frozen, owner, ttl, tip, timelock, list, keyIds] = await Promise.all([
    c.readContract({ ...base, functionName: "vaultBalance" }),
    c.readContract({ ...base, functionName: "frozen" }),
    c.readContract({ ...base, functionName: "owner" }),
    c.readContract({ ...base, functionName: "intentTtl" }),
    c.readContract({ ...base, functionName: "relayerTip" }),
    c.readContract({ ...base, functionName: "keyTimelock" }),
    c.readContract({ ...base, functionName: "getAgents" }),
    c.readContract({ ...base, functionName: "getKeyIds" }),
  ]);
  const today = Math.floor(Date.now() / 1000 / 86400);
  const agents = await Promise.all(
    list.map(async (address): Promise<AgentRow> => {
      const cfg = await c.readContract({ ...base, functionName: "agents", args: [address] });
      return {
        address,
        active: cfg[0],
        autoPerTx: cfg[1],
        autoDaily: cfg[2],
        hardCap: cfg[3],
        autoSpentToday: cfg[4] === today ? cfg[5] : 0n,
      };
    }),
  );
  const keyFlags = await Promise.all(
    keyIds.map(async (id) => {
      const k = await c.readContract({ ...base, functionName: "keys", args: [id] });
      return { id, activeAt: Number(k[2]), revoked: k[3] };
    }),
  );
  return { balance, frozen, owner, intentTtl: Number(ttl), relayerTip: tip, keyTimelock: Number(timelock), agents, keyFlags };
}

export function useVaultState() {
  const client = usePublicClient();
  const q = useQuery({
    queryKey: ["vault-state", VAULT],
    queryFn: () => loadState(client as PublicClient),
    refetchInterval: POLL,
    enabled: !DEMO && !!client,
  });
  return { state: DEMO ? demoState : q.data, loading: !DEMO && q.isLoading, error: q.error as Error | null };
}

type RawLog = { eventName: string; args: Record<string, any>; blockNumber: bigint; logIndex: number; transactionHash: string };

function toFeed(l: RawLog, ts: number): FeedEvent | null {
  const base = { id: `${l.transactionHash}-${l.logIndex}`, tx: l.transactionHash, block: l.blockNumber, logIndex: l.logIndex, ts };
  const x = l.args;
  switch (l.eventName) {
    case "AutoPaid":
      return { ...base, kind: "autopaid", agent: x.agent, payee: x.payee, amount: x.amount6, memo: x.memo };
    case "IntentCreated":
      return { ...base, kind: "pending", agent: x.agent, payee: x.payee, amount: x.amount6, memo: x.memo, intentId: x.id };
    case "IntentRejected":
      return { ...base, kind: "rejected", agent: x.agent, payee: x.payee, amount: x.amount6, reason: Number(x.reason) };
    case "Paid":
      return { ...base, kind: "approved", payee: x.payee, amount: x.amount6, intentId: x.id };
    case "EmailDenied":
      return { ...base, kind: "denied", intentId: x.id };
    case "PayoutFailed":
      return { ...base, kind: "failed", payee: x.payee, amount: x.amount6, intentId: x.id };
    case "IntentClosed":
      return { ...base, kind: Number(x.status) === 5 ? "cancelled" : "expired", intentId: x.id };
    case "EmailFrozen":
      return { ...base, kind: "frozen" };
    case "Unfrozen":
      return { ...base, kind: "unfrozen" };
    case "Deposited":
      return { ...base, kind: "deposit", amount: x.amount6 };
    case "Withdrawn":
      return { ...base, kind: "withdraw", amount: x.amount6 };
    default:
      return null;
  }
}

export type ChainLogs = {
  events: FeedEvent[];
  intents: IntentRow[];
  keys: KeyRow[];
  payees: Record<string, boolean>;
  approvals: Record<string, { dkimT: number; relayer: `0x${string}`; tx: string }>;
  loading: boolean;
};

/** Reads ONLY vault events (never USDC Transfer logs), by address in 9,999-block windows, decoded locally, then polls. */
export function useVaultLogs(target?: { address: `0x${string}`; deployBlock: bigint }): ChainLogs {
  const vaultAddr = target?.address ?? VAULT;
  const fromBlock = target?.deployBlock ?? VAULT_DEPLOY_BLOCK;
  const client = usePublicClient();
  const [logs, setLogs] = useState<{ raw: RawLog[]; ts: Map<bigint, number> }>({ raw: [], ts: new Map() });
  const demo = DEMO && !target;
  const [loading, setLoading] = useState(!demo);
  const cursor = useRef<bigint | null>(null);
  const tsCache = useRef(new Map<bigint, number>());

  useEffect(() => {
    if (demo || !client || !vaultAddr) return;
    cursor.current = null;
    setLogs({ raw: [], ts: new Map() });
    let stop = false;
    const stamp = async (n: bigint) => {
      if (tsCache.current.has(n)) return;
      const b = await client.getBlock({ blockNumber: n });
      tsCache.current.set(n, Number(b.timestamp));
    };
    const sync = async () => {
      try {
        const tip = await client.getBlockNumber();
        let from = cursor.current === null ? fromBlock : cursor.current + 1n;
        const fresh: RawLog[] = [];
        while (from <= tip && !stop) {
          const to = from + WINDOW - 1n < tip ? from + WINDOW - 1n : tip;
          // Arc's RPC rejects multi-event topic filters, so filter by address only and decode locally.
          const raw = await client.getLogs({ address: vaultAddr!, fromBlock: from, toBlock: to });
          const decoded = parseEventLogs({ abi: falaVaultAbi, logs: raw }) as unknown as RawLog[];
          await Promise.all([...new Set(decoded.map((l) => l.blockNumber))].map(stamp));
          fresh.push(...decoded);
          from = to + 1n;
        }
        if (stop) return;
        cursor.current = tip;
        if (fresh.length) setLogs((p) => ({ raw: [...p.raw, ...fresh], ts: tsCache.current }));
        setLoading(false);
      } catch (e) {
        console.error("fala: failed to load vault events", e);
        setLoading(false);
      }
    };
    sync();
    const t = setInterval(sync, POLL);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [client, vaultAddr, fromBlock, demo]);

  return demo ? { events: demoEvents, intents: demoIntents, keys: demoKeys, payees: { [demoEvents[1].payee!]: true, [demoEvents[4].payee!]: false }, approvals: {}, loading: false } : derive(logs.raw, logs.ts, loading);
}

function derive(raw: RawLog[], ts: Map<bigint, number>, loading: boolean): ChainLogs {
  const sorted = [...raw].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  const events: FeedEvent[] = [];
  const intents = new Map<string, IntentRow>();
  const keys = new Map<string, KeyRow>();
  const payees: Record<string, boolean> = {};
  const approvals: ChainLogs["approvals"] = {};

  for (const l of sorted) {
    const when = ts.get(l.blockNumber) ?? 0;
    const f = toFeed(l, when);
    if (f) events.push(f);
    const x = l.args;
    switch (l.eventName) {
      case "IntentCreated":
        intents.set(String(x.id), {
          id: x.id, agent: x.agent, payee: x.payee, amount: x.amount6, memo: x.memo, code: String(x.code).slice(2),
          createdAt: when, expiresAt: Number(x.expiresAt), status: "PENDING", tx: l.transactionHash,
        });
        break;
      case "EmailApproved":
        approvals[String(x.id)] = { dkimT: Number(x.dkimT), relayer: x.relayer, tx: l.transactionHash };
        break;
      case "Paid": {
        const i = intents.get(String(x.id));
        if (i) Object.assign(i, { status: "APPROVED", settledTx: l.transactionHash, dkimT: approvals[String(x.id)]?.dkimT, relayer: approvals[String(x.id)]?.relayer });
        break;
      }
      case "PayoutFailed": {
        const i = intents.get(String(x.id));
        if (i) Object.assign(i, { status: "FAILED", settledTx: l.transactionHash });
        break;
      }
      case "EmailDenied": {
        const i = intents.get(String(x.id));
        if (i) Object.assign(i, { status: "DENIED", settledTx: l.transactionHash, dkimT: Number(x.dkimT) });
        break;
      }
      case "IntentClosed": {
        const i = intents.get(String(x.id));
        if (i) Object.assign(i, { status: Number(x.status) === 5 ? "CANCELLED" : "EXPIRED", settledTx: l.transactionHash });
        break;
      }
      case "KeyProposed":
        keys.set(x.keyId, { id: x.keyId, domain: x.domain, selector: x.selector, activeAt: Number(x.activeAt), revoked: false });
        break;
      case "KeyRevokedByOwner": {
        const k = keys.get(x.keyId);
        if (k) k.revoked = true;
        break;
      }
      case "PayeeSet":
        payees[String(x.payee).toLowerCase()] = x.known;
        break;
    }
  }
  return {
    events,
    intents: [...intents.values()].sort((a, b) => Number(b.id - a.id)),
    keys: [...keys.values()],
    payees,
    approvals,
    loading,
  };
}

export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}
