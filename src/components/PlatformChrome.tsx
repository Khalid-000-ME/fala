"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { stallHint, useAuth } from "../hooks/useAuth";
import { short } from "../lib/format";
import { Logo, NetworkBadge } from "./Chrome";

/** On the landing hero the bar stays out of the way; everywhere else it is always solid. */
function useOverHero() {
  const pathname = usePathname();
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return pathname === "/" && atTop;
}

export function PlatformHeader() {
  const { ready, stalled, authenticated, user, login, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const overHero = useOverHero();
  // Show the wallet, never the Google address: the header is on screen in demos and screenshots.
  const addr = user?.wallet?.address;

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-4">
      <div
        className={`flex h-14 w-full max-w-[1100px] items-center justify-between gap-4 rounded-full px-5 transition duration-300 ${
          overHero
            ? "border border-transparent bg-transparent opacity-0"
            : "border border-white/40 bg-white/60 opacity-100 shadow-[0_8px_32px_rgba(0,0,0,.06)] backdrop-blur-xl"
        }`}
      >
        <Link href={authenticated ? "/app" : "/"} aria-label="Fala home"><Logo /></Link>
        {authenticated && (
          <nav className="hidden md:flex">
            <Link href="/app" className={`text-[14.5px] transition ${pathname === "/app" ? "text-ink" : "text-mute hover:text-ink"}`}>
              Vaults
            </Link>
          </nav>
        )}
        <div className="flex items-center gap-3">
          <NetworkBadge />
          {ready && authenticated ? (
            <button className="btn-ghost btn btn-sm font-mono" title="Sign out" onClick={async () => { await logout(); router.push("/"); }}>
              {addr ? short(addr) : "Account"}
            </button>
          ) : ready ? (
            <button className="btn btn-sm" onClick={() => login()}>Sign in</button>
          ) : stalled ? (
            <span className="tag rounded-full bg-bad/10 px-3 py-1 text-bad" title={stallHint()}>sign-in unavailable</span>
          ) : (
            <span className="h-8 w-24 animate-pulse rounded-full bg-card" aria-label="Loading sign-in" />
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
        <div className="font-mono text-[13px] text-white/50">Unaudited · testnet · built on Arc</div>
      </div>
    </footer>
  );
}
