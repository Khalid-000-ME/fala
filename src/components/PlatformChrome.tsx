import { usePrivy } from "@privy-io/react-auth";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { NetworkBadge } from "./Chrome";
import { Logo } from "./Chrome";

export function PlatformHeader() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const nav = useNavigate();
  const email = user?.google?.email ?? user?.email?.address;
  const link = ({ isActive }: { isActive: boolean }) => `text-[14.5px] transition ${isActive ? "text-ink" : "text-mute hover:text-ink"}`;
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur">
      <div className="wrap flex h-[68px] items-center justify-between gap-4">
        <Link to={authenticated ? "/app" : "/"}><Logo /></Link>
        <nav className="hidden gap-8 md:flex">
          {authenticated && <NavLink to="/app" className={link}>My vaults</NavLink>}
          <NavLink to="/explore" className={link}>Live demo</NavLink>
        </nav>
        <div className="flex items-center gap-3">
          <NetworkBadge />
          {ready && authenticated ? (
            <button className="btn-ghost btn btn-sm font-mono" title="Sign out" onClick={async () => { await logout(); nav("/"); }}>
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
