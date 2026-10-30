"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { stallHint, useAuth } from "../hooks/useAuth";
import { short } from "../lib/format";
import { Logo, NetworkBadge } from "./Chrome";

const NAV = [
  ["My vaults", "/app", true],
  ["Live demo", "/explore", false],
] as const;

export function PlatformHeader() {
  const { ready, stalled, authenticated, user, login, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Show the wallet, never the Google address: the header is on screen in demos and screenshots.
  const addr = user?.wallet?.address;
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur">
      <div className="wrap flex h-[68px] items-center justify-between gap-4">
        <Link href={authenticated ? "/app" : "/"}><Logo /></Link>
        <nav className="hidden gap-8 md:flex">
          {NAV.filter(([, , needsAuth]) => authenticated || !needsAuth).map(([label, href]) => (
            <Link key={href} href={href} className={`text-[14.5px] transition ${pathname === href ? "text-ink" : "text-mute hover:text-ink"}`}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <NetworkBadge />
          {ready && authenticated ? (
            <button className="btn-ghost btn btn-sm font-mono" title="Sign out" onClick={async () => { await logout(); router.push("/"); }}>
              {addr ? short(addr) : "Account"} · sign out
            </button>
          ) : ready ? (
            <button className="btn btn-sm" onClick={() => login()}>Sign in with Google</button>
          ) : stalled ? (
            <span className="tag rounded-full bg-bad/10 px-3 py-1 text-bad" title={stallHint()}>sign-in unavailable</span>
          ) : (
            <span className="h-9 w-[150px] animate-pulse rounded-full bg-card" aria-label="Loading sign-in" />
          )}
        </div>
      </div>
    </header>
  );
}

export function PlatformFooter() {
  return (
    <footer className="bg-black pb-12 pt-20 text-white">
      <div className="wrap flex flex-wrap items-center justify-between gap-6">
        <Logo light />
        <div className="font-mono text-[13px] text-white/50">Unaudited · small amounts only · built on Arc</div>
      </div>
    </footer>
  );
}
