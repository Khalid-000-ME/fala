import { useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits } from "viem";
import { DEMO, VAULT, explorerAddr } from "../config/chain";
import { fmtUsdc, parseUsdc, short } from "../lib/format";
import { Section, Stat } from "./ui";
import { useTx } from "../hooks/useTx";
import type { VaultState } from "../hooks/useVaultData";
import type { IntentRow } from "../lib/types";

export function Hero({ state, pending }: { state?: VaultState; pending: number }) {
  return (
    <section id="top" className="wrap pb-6 pt-14 sm:pt-24">
      <div className="grid items-end gap-12 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rise">
          <div className="cap mb-6">[ Email approvals for AI agents · Arc ]</div>
          <h1 className="h-display">Your agent asks. You reply from Gmail.</h1>
          <p className="lede mt-8">
            Small payments go through on their own. For anything bigger the agent emails you — tap <b className="font-medium text-ink">Approve</b>, hit
            send, and the Arc contract checks Google’s own signature on your reply before a single USDC moves.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-6">
            <a href="#approve" className="btn">Approve with an email</a>
            <a href="#forge" className="link-accent">Try to forge one [ + ]</a>
          </div>
          <p className="cap mt-10 max-w-md">“A prompt-injected agent can write any email it wants. It can’t make Google sign one from you.”</p>
        </div>

        <div className="tile rise relative aspect-[5/4] w-full overflow-hidden text-white" style={{ animationDelay: ".08s" }}>
          <img src="/media/fala/web/fala-hero-policy-tether.jpg" alt="An agent tethered to a black vault, hostile signals breaking against a boundary" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "58% 50%" }} fetchPriority="high" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(6,10,40,.82) 0%, rgba(6,10,40,.35) 42%, rgba(6,10,40,0) 70%)" }} />
          <div className="relative flex items-center justify-between p-7 font-mono text-[13px] uppercase sm:p-9">
            <span>Fala vault</span>
            <span className="inline-flex items-center gap-2"><i className="pulse-dot h-2 w-2 rounded-full bg-white" />{state?.frozen ? "frozen" : "live"}</span>
          </div>
          <div className="absolute inset-x-7 bottom-7 sm:inset-x-9 sm:bottom-9">
            <div className="font-mono text-[12.5px] opacity-80">USDC in vault</div>
            <div className="text-[clamp(3rem,6vw,4.75rem)] leading-none tracking-tightest">{fmtUsdc(state?.balance)}</div>
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-1 font-mono text-[12.5px]">
              <span>{pending} waiting for you</span>
              <span>approved by Google’s signature</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  ["Agent asks", "It calls request() with a payee, an amount and a memo. Small amounts to known payees are paid instantly."],
  ["You get an email", "Anything bigger becomes a pending request. You receive three buttons: Approve, Deny, Freeze."],
  ["You reply from Gmail", "A button opens a reply with the exact subject filled in. You only press Send — no wallet, no seed phrase."],
  ["Arc checks Google", "The contract verifies Gmail’s DKIM RSA signature on your reply, matches the code to this exact request, then pays."],
] as const;

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-8 py-16 sm:py-24">
      <div className="wrap grid gap-12 lg:grid-cols-[.8fr_1.2fr]">
        <div>
          <h2 className="h-section">How it works</h2>
          <p className="lede mt-5">zk-email without the zk: direct RSA verification on Arc, about a cent per approval. Your inbox is the second key.</p>
        </div>
        <ol className="border-t border-line">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="row grid-cols-[2.5rem_minmax(0,1fr)] md:grid-cols-[2.5rem_14rem_minmax(0,1fr)]">
              <span className="cap">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[22px] tracking-tightest">{t}</span>
              <span className="cap col-start-2 mt-1 md:col-start-auto md:mt-0 md:text-[13px]">{d}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Overview({ state, intents, owner }: { state?: VaultState; intents: IntentRow[]; owner: boolean }) {
  const { vaultWrite } = useTx();
  const day = Math.floor(Date.now() / 1000 / 86400);
  const autoToday = (state?.agents ?? []).reduce((s, a) => s + a.autoSpentToday, 0n);
  const approved = intents.filter((i) => i.status === "APPROVED").length;
  const pending = intents.filter((i) => i.status === "PENDING" && i.expiresAt > Date.now() / 1000).length;
  void day;
  return (
    <Section
      id="overview"
      title="The vault"
      sub={<>Live from the contract{VAULT && <> at <a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={explorerAddr(VAULT)}>{short(VAULT)}</a></>}. Refreshed every three seconds.</>}
    >
      {state?.frozen && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-card bg-[#0b2a5b] px-8 py-6 text-white">
          <div>
            <div className="text-[28px] tracking-tightest">🧊 Vault frozen</div>
            <div className="cap !text-white/70 mt-1">A FREEZE email from the approver stopped every agent. Only the owner wallet can unfreeze.</div>
          </div>
          <button className="rounded-full bg-white px-5 py-2.5 text-[14px] text-ink disabled:opacity-40" disabled={!DEMO && !owner} onClick={() => vaultWrite("unfreeze", [], "Unfreeze")}>
            Unfreeze (owner)
          </button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Vault balance · USDC" value={fmtUsdc(state?.balance)} hint="ERC-20 view, 6 decimals" />
        <Stat label="Auto-paid today · USDC" value={fmtUsdc(autoToday)} hint="within agent allowances" tone="ok" />
        <Stat label="Waiting for you" value={pending} hint="reply Approve or Deny" />
        <Stat label="Approved by email" value={approved} hint="verified against Gmail’s key" />
      </div>
      <Funds state={state} owner={owner} />
    </Section>
  );
}

function Funds({ state, owner }: { state?: VaultState; owner: boolean }) {
  const { address } = useAccount();
  const { vaultWrite } = useTx();
  const [dep, setDep] = useState("");
  const [wd, setWd] = useState("");
  const [busy, setBusy] = useState(false);

  const deposit = async () => {
    setBusy(true);
    // native USDC has 18 decimals; the vault converts to 6 and needs a multiple of 1e12
    const value = parseUnits(dep || "0", 18);
    if (value > 0n && (await vaultWrite("deposit", [], "Deposit", value))) setDep("");
    setBusy(false);
  };
  const withdraw = async () => {
    if (!address) return;
    setBusy(true);
    if (await vaultWrite("withdraw", [address, parseUsdc(wd)], "Withdraw")) setWd("");
    setBusy(false);
  };

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="card">
        <div className="cap">Deposit USDC</div>
        <div className="mt-4 flex gap-3">
          <input className="input" inputMode="decimal" placeholder="0.00" value={dep} onChange={(e) => setDep(e.target.value)} />
          <button className="btn shrink-0" disabled={busy || !dep} onClick={deposit}>Deposit</button>
        </div>
        <div className="cap mt-3">One payable call — native USDC in, 6-decimal accounting out. Anyone can fund the vault.</div>
      </div>
      <div className="card">
        <div className="cap">Withdraw to owner</div>
        <div className="mt-4 flex gap-3">
          <input className="input" inputMode="decimal" placeholder="0.00" value={wd} onChange={(e) => setWd(e.target.value)} />
          <button className="btn-ghost btn shrink-0" disabled={busy || !wd || (!DEMO && !owner)} onClick={withdraw}>Withdraw</button>
        </div>
        <div className="cap mt-3">Vault holds {fmtUsdc(state?.balance)} USDC · owner wallet only</div>
      </div>
    </div>
  );
}
