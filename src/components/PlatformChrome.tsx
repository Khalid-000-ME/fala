"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo, NetworkBadge } from "./Chrome";

const NAV = [
  ["My vaults", "/app", true],
  ["Live demo", "/explore", false],
] as const;

export function PlatformHeader() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const email = user?.google?.email ?? user?.email?.address;
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
              {email ?? "Account"} · sign out
            </button>
          ) : (
            <button className="btn btn-sm" disabled={!ready} onClick={() => login()}>Sign in with Google</button>
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
