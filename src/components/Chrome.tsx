"use client";

import { ACTIVE, DEMO, NETWORK } from "../config/chain";
import { useTx } from "../hooks/useTx";

export const Logo = ({ light }: { light?: boolean }) => (
  <span className={`inline-flex items-center gap-2 font-mono text-[19px] font-medium tracking-tight ${light ? "text-white" : "text-ink"}`}>
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <circle cx="3" cy="4" r="1.6" /><circle cx="10" cy="4" r="1.6" /><circle cx="17" cy="4" r="1.6" />
      <circle cx="6.5" cy="10" r="1.6" /><circle cx="13.5" cy="10" r="1.6" /><circle cx="10" cy="16" r="1.6" />
    </svg>
    FALA
  </span>
);


export function NetworkBadge() {
  const tone =
    NETWORK === "mainnet" ? "bg-bad text-white" : NETWORK === "testnet" ? "bg-card text-mute" : "bg-ink text-white";
  return <span className={`tag rounded-full px-3 py-1 uppercase ${tone}`}>{DEMO ? "demo" : NETWORK}</span>;
}

export function Toasts() {
  const { toasts, dismiss } = useTx();
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="rise flex items-start justify-between gap-4 rounded-2xl bg-ink px-5 py-4 text-white shadow-xl">
          <div>
            <div className={`font-mono text-[13px] ${t.tone === "bad" ? "text-[#ff8a7f]" : t.tone === "ok" ? "text-[#6fe3a1]" : ""}`}>{t.msg}</div>
            {t.tx && (
              <a className="font-mono text-[12px] text-accent underline-offset-2 hover:underline" target="_blank" rel="noreferrer" href={`${ACTIVE.blockExplorers?.default.url ?? ""}/tx/${t.tx}`}>
                View on explorer [ + ]
              </a>
            )}
          </div>
          <button className="font-mono text-white/50 hover:text-white" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
