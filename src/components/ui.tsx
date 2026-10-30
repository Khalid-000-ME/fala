"use client";

import { useEffect, type ReactNode } from "react";

export function Section({ id, title, sub, children, aside }: { id?: string; title: ReactNode; sub?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 py-16 sm:py-24">
      <div className="wrap">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6 sm:mb-14">
          <div>
            <h2 className="h-section">{title}</h2>
            {sub && <p className="lede mt-5">{sub}</p>}
          </div>
          {aside}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "bad" | "ok" }) {
  return (
    <div className="card flex min-h-[148px] flex-col justify-between">
      <div className="cap">{label}</div>
      <div>
        <div className={`text-[42px] leading-none tracking-tightest ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{value}</div>
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
      <div className="rise max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-tile bg-white p-8 sm:rounded-tile" onClick={(e) => e.stopPropagation()}>
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
