import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { DEMO, GAS, VAULT, USDC, explorerTx } from "../config/chain";
import { falaVaultAbi } from "../lib/abi";

type Toast = { id: number; msg: string; tone: "ok" | "bad" | "info"; tx?: string };
const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
export { erc20Abi };

type Ctx = {
  toast: (msg: string, tone?: Toast["tone"], tx?: string) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  vaultWrite: (functionName: string, args: unknown[], label: string) => Promise<boolean>;
  approveUsdc: (amount: bigint) => Promise<boolean>;
};
const C = createContext<Ctx>(null!);
export const useTx = () => useContext(C);

export function TxProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const { isConnected } = useAccount();

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (msg: string, tone: Toast["tone"] = "info", tx?: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, msg, tone, tx }]);
      setTimeout(() => dismiss(id), 7000);
    },
    [dismiss],
  );

  const run = useCallback(
    async (address: `0x${string}`, abi: any, functionName: string, args: unknown[], label: string) => {
      if (DEMO) return toast("Demo mode — set VITE_VAULT_ADDRESS to send transactions", "info"), false;
      if (!isConnected) return toast("Connect a wallet first", "bad"), false;
      try {
        const hash = await writeContractAsync({ address, abi, functionName, args, ...GAS } as any);
        toast(`${label} submitted`, "info", hash);
        await client!.waitForTransactionReceipt({ hash });
        toast(`${label} confirmed`, "ok", hash);
        return true;
      } catch (e: any) {
        toast(e?.shortMessage ?? e?.message ?? "Transaction failed", "bad");
        return false;
      }
    },
    [client, isConnected, toast, writeContractAsync],
  );

  const vaultWrite = useCallback((fn: string, args: unknown[], label: string) => run(VAULT ?? "0x", falaVaultAbi, fn, args, label), [run]);
  const approveUsdc = useCallback((amount: bigint) => run(USDC, erc20Abi, "approve", [VAULT, amount], "USDC approval"), [run]);

  return <C.Provider value={{ toast, toasts, dismiss, vaultWrite, approveUsdc }}>{children}</C.Provider>;
}

export { explorerTx };
