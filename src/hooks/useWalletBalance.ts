"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useOwnerWallet } from "../lib/owner";

/** The owner wallet's native USDC (18 decimals on Arc), read through the same-origin RPC proxy and refreshed every 20s. */
export function useWalletBalance(): string | undefined {
  const { address } = useOwnerWallet();
  const [bal, setBal] = useState<string>();
  useEffect(() => {
    if (!address) return;
    const read = () =>
      fetch("/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }) })
        .then((r) => r.json())
        .then((r) => r.result && setBal(Number(formatUnits(BigInt(r.result), 18)).toFixed(2)))
        .catch(() => {});
    read();
    const t = setInterval(read, 20000);
    return () => clearInterval(t);
  }, [address]);
  return bal;
}
