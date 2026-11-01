"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { stallHint, useAuth } from "../hooks/useAuth";
import { short } from "../lib/format";
import { Logo, NetworkBadge } from "./Chrome";

/** Scroll state: `shown` hides the bar over the landing hero, `wide` stretches it from a minimal bar to its full 1100px width. */
function useNavScroll() {
  const pathname = usePathname();
  const [y, setY] = useState(0);
  useEffect(() => {
    const onScroll = () => setY(window.scrollY);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const landing = pathname === "/";
  return { shown: !landing || y > 120, wide: y > (landing ? 400 : 48) };
}

export function PlatformHeader() {
  const { ready, stalled, authenticated, user, login, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { shown, wide } = useNavScroll();
  // Show the wallet, never the Google address: the header is on screen in demos and screenshots.
  const addr = user?.wallet?.address;

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-3">
      <div
        style={{ maxWidth: wide ? "1100px" : "400px" }}
        className={`flex h-14 w-full items-center justify-between gap-4 rounded-2xl border px-5 backdrop-blur-xl transition-all duration-500 ease-out ${
          shown
            ? "border-white/40 bg-white/60 opacity-100 shadow-[0_8px_32px_rgba(0,0,0,.06)]"
            : "pointer-events-none border-transparent bg-transparent opacity-0"
        }`}
      >
        <Link href={authenticated ? "/app" : "/"} aria-label="Fala home"><Logo /></Link>
        {authenticated && (
          <nav className={`hidden ${wide ? "md:flex" : ""}`}>
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
