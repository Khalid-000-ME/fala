import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { ACTIVE, DEMO, NETWORK } from "../config/chain";
import { short } from "../lib/format";
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

const NAV = [
  ["Overview", "#overview"],
  ["Agents", "#agents"],
  ["Approvals", "#approvals"],
  ["Activity", "#activity"],
  ["Red team", "#redteam"],
] as const;

export function NetworkBadge() {
  const tone =
    NETWORK === "mainnet" ? "bg-bad text-white" : NETWORK === "testnet" ? "bg-card text-mute" : "bg-ink text-white";
  return <span className={`tag rounded-full px-3 py-1 uppercase ${tone}`}>{DEMO ? "demo" : NETWORK}</span>;
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { toast } = useTx();
  if (isConnected)
    return (
      <button className="btn-ghost btn btn-sm font-mono" onClick={() => disconnect()} title="Disconnect">
        {short(address)}
      </button>
    );
  return (
    <button
      className="btn btn-sm"
      disabled={isPending}
      onClick={() => (connectors.length ? connect({ connector: connectors[0] }) : toast("No browser wallet detected", "bad"))}
    >
      Connect wallet
    </button>
  );
}

export function WrongNetwork() {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  if (!isConnected || chainId === ACTIVE.id) return null;
  return (
    <div className="bg-bad text-white">
      <div className="wrap flex flex-wrap items-center justify-between gap-3 py-3">
        <span className="font-mono text-[13px]">Wrong network — Fala runs on {ACTIVE.name}.</span>
        <button className="rounded-full bg-white px-4 py-1 font-mono text-[12.5px] text-ink" onClick={() => switchChain({ chainId: ACTIVE.id })}>
          Switch to {ACTIVE.name}
        </button>
      </div>
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur">
      <div className="wrap flex h-[68px] items-center justify-between gap-4">
        <a href="#top"><Logo /></a>
        <nav className="hidden gap-8 md:flex">
          {NAV.map(([l, h]) => (
            <a key={h} href={h} className="text-[14.5px] text-mute transition hover:text-ink">{l}</a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <NetworkBadge />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const col = (title: string, items: [string, string][]) => (
    <div>
      <div className="mb-5 text-[17px]">{title}</div>
      <ul className="space-y-1.5 text-[17px] text-white/90">
        {items.map(([l, h]) => (
          <li key={l}><a href={h} className="transition hover:text-white/60">{l}</a></li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="bg-black pb-14 pt-24 text-white">
      <div className="wrap">
        <div className="grid gap-12 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr]">
          <Logo light />
          {col("Dashboard", [["Overview", "#overview"], ["Agents", "#agents"], ["Approvals", "#approvals"], ["Activity", "#activity"]])}
          {col("Get involved", [["Red team", "#redteam"], ["Simulate", "#simulate"]])}
          {col("Company", [["Privacy", "#"], ["Terms", "#"], ["FAQs", "#"]])}
          {col("Follow us", [["X / Twitter", "#"], ["GitHub", "#"], ["Reddit", "#"]])}
        </div>
        <div className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-white/15 pt-8 font-mono text-[17px]">
          <span>© 2026 Fala</span>
          <span className="text-[13px] text-white/50">Unaudited · small amounts only · built on Arc</span>
        </div>
      </div>
    </footer>
  );
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
