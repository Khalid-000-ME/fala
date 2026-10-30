"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback } from "react";

export const API = (process.env.NEXT_PUBLIC_API_URL as string | undefined) ?? "http://localhost:8787";

export type AgentKind = "managed" | "connected" | "byo";
export type AgentDto = {
  id: string; name: string; kind: AgentKind; provider: string | null; address: `0x${string}`;
  registered?: boolean; autoPerTx?: string; autoDaily?: string; hardCap?: string; autoSpentToday?: string;
  keys?: { id: string; prefix: string; label: string | null; created_at: number; last_used_at: number | null }[];
};
export type VaultDto = {
  id: string; name: string; address: `0x${string}`; ownerAddress: `0x${string}`; approverEmail: string; deployBlock: number; deployTx: string | null;
  minBalance: string; balance: string; frozen: boolean; belowMin: boolean; shortfall: string; agentCount: number; agents: AgentDto[];
};
export type KeyDto = { key: string; note: string; mcp: { url: string; header: string }; rest: { base: string; header: string }; claudeCode: string };

/** Authenticated JSON client: attaches the Privy access token to every call. */
export function useApi() {
  const { getAccessToken } = usePrivy();
  return useCallback(
    async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const token = await getAccessToken();
      const res = await fetch(`${API}${path}`, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
      return data as T;
    },
    [getAccessToken],
  );
}
