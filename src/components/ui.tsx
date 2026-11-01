"use client";

import { useEffect, type ReactNode } from "react";

export function Section({ id, title, children, aside }: { id?: string; title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id}>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[32px] leading-none tracking-tightest">{title}</h1>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: string; tone?: "bad" | "ok" }) {
  return (
    <div className="card flex min-h-[120px] flex-col justify-between">
      <div className="cap">{label}</div>
      <div>
        <div className={`font-mono text-[32px] leading-none tracking-tight ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{value}</div>
        {hint && <div className="cap mt-2">{hint}</div>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div className="rise max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-tile border border-line bg-card p-8 sm:rounded-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <h3 className="text-3xl tracking-tightest">{title}</h3>
          <button onClick={onClose} className="cap hover:text-ink" aria-label="Close">[ × ]</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="card cap py-10 text-center">{children}</div>
);
