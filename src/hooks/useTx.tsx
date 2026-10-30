"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { explorerTx } from "../config/chain";

export type Toast = { id: number; msg: string; tone: "ok" | "bad" | "info"; tx?: string };

type Ctx = {
  toast: (msg: string, tone?: Toast["tone"], tx?: string) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
};
const C = createContext<Ctx>(null!);
export const useTx = () => useContext(C);

export function TxProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (msg: string, tone: Toast["tone"] = "info", tx?: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, msg, tone, tx }]);
      setTimeout(() => dismiss(id), 8000);
    },
    [dismiss],
  );
  return <C.Provider value={{ toast, toasts, dismiss }}>{children}</C.Provider>;
}

export { explorerTx };
