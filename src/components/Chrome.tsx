"use client";

import { ACTIVE, DEMO } from "../config/chain";
import { useTx } from "../hooks/useTx";

export const Logo = ({ light }: { light?: boolean }) => (
  <span className={`inline-flex items-center gap-2 text-[19px] font-medium tracking-tight ${light ? "text-white" : "text-ink"}`}>
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <circle cx="3" cy="4" r="1.6" /><circle cx="10" cy="4" r="1.6" /><circle cx="17" cy="4" r="1.6" />
      <circle cx="6.5" cy="10" r="1.6" /><circle cx="13.5" cy="10" r="1.6" /><circle cx="10" cy="16" r="1.6" />
    </svg>
    FALA
  </span>
);


/** Marks sample data, shown only when no vault is configured. The chain is not worth a badge. */
export function DemoBadge() {
  if (!DEMO) return null;
  return <span className="tag rounded-full bg-ink px-3 py-1 uppercase text-canvas">demo</span>;
}

export function Toasts() {
  const { toasts, dismiss } = useTx();
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="rise flex items-start justify-between gap-4 rounded-2xl border border-line bg-card px-5 py-4 text-ink shadow-xl">
          <div>
            <div className={`text-[13px] ${t.tone === "bad" ? "text-bad" : t.tone === "ok" ? "text-ok" : ""}`}>{t.msg}</div>
            {t.tx && (
              <a className="text-[12px] text-accent underline-offset-2 hover:underline" target="_blank" rel="noreferrer" href={`${ACTIVE.blockExplorers?.default.url ?? ""}/tx/${t.tx}`}>
                View on explorer [ + ]
              </a>
            )}
          </div>
          <button className="text-mute hover:text-ink" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
