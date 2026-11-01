"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { short } from "../lib/format";
import { Logo, NetworkBadge } from "./Chrome";

export type NavItem = { id: string; label: string; badge?: number };

function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => setLight(document.documentElement.dataset.theme === "light"), []);
  const flip = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("fala-theme", next ? "light" : "dark"); } catch {}
  };
  return <button className="cap text-left hover:text-ink" onClick={flip}>{light ? "Dark mode" : "Light mode"}</button>;
}

/** Sidebar layout for every signed-in page. Becomes a top bar on small screens. */
export function AppShell({ title, back, items, active, onSelect, children }: { title?: string; back?: boolean; items?: NavItem[]; active?: string; onSelect?: (id: string) => void; children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const addr = user?.wallet?.address;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 border-b border-line p-5 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between">
          <Link href="/app" aria-label="Fala home"><Logo /></Link>
          <span className="md:hidden"><NetworkBadge /></span>
        </div>
        {back && <Link href="/app" className="cap hover:text-ink">← Vaults</Link>}
        {title && <div className="truncate text-[20px] tracking-tightest">{title}</div>}
        {items && (
          <nav className="-mx-1 flex gap-1 overflow-x-auto md:flex-col">
            {items.map((t) => (
              <button key={t.id} onClick={() => onSelect?.(t.id)} className={`flex shrink-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[14.5px] transition ${active === t.id ? "bg-card text-ink" : "text-mute hover:text-ink"}`}>
                {t.label}
                {!!t.badge && <span className="tag rounded-full bg-warn/15 px-2 text-warn">{t.badge}</span>}
              </button>
            ))}
          </nav>
        )}
        <div className="mt-auto hidden flex-col items-start gap-3 md:flex">
          <NetworkBadge />
          {addr && <span className="cap">{short(addr)}</span>}
          <ThemeToggle />
          <button className="cap text-left hover:text-ink" onClick={async () => { await logout(); router.push("/"); }}>Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-8 sm:px-10 sm:py-12"><div className="mx-auto max-w-[960px]">{children}</div></main>
    </div>
  );
}
