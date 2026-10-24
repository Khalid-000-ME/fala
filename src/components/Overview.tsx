import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { DEMO, USDC, VAULT, explorerAddr } from "../config/chain";
import { fmtUsdc, parseUsdc, short } from "../lib/format";
import { Section, Stat } from "./ui";
import { erc20Abi, useTx } from "../hooks/useTx";
import type { VaultState } from "../hooks/useVaultData";

export function Hero({ state, protectedAmt }: { state?: VaultState; protectedAmt: bigint }) {
  return (
    <section id="top" className="wrap pb-6 pt-14 sm:pt-24">
      <div className="grid items-end gap-12 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rise">
          <div className="cap mb-6">[ Spending policy for AI agents · Arc ]</div>
          <h1 className="h-display">Agents can spend. They can’t be talked into it.</h1>
          <p className="lede mt-8">
            Fala is an onchain vault with per-agent limits, a payee allowlist and two-key approval for big spends. Every refused attempt
            becomes a permanent public record.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-6">
            <a href="#agents" className="btn">Configure an agent</a>
            <a href="#activity" className="link-accent">Explore activity [ + ]</a>
          </div>
        </div>

        <div className="halftone tile rise relative aspect-[5/4] w-full overflow-hidden p-7 text-white sm:p-9" style={{ background: "linear-gradient(170deg,#3f78d6 0%,#7fb0ec 55%,#cfe3f6 100%)", animationDelay: ".08s" }}>
          <div className="flex items-center justify-between font-mono text-[13px] uppercase">
            <span>Fala vault</span>
            <span className="inline-flex items-center gap-2"><i className="pulse-dot h-2 w-2 rounded-full bg-white" />{state?.paused ? "paused" : "live"}</span>
          </div>
          <div className="absolute inset-x-7 bottom-7 sm:inset-x-9 sm:bottom-9">
            <div className="font-mono text-[12.5px] opacity-80">USDC in vault</div>
            <div className="text-[clamp(3rem,6vw,4.75rem)] leading-none tracking-tightest">{fmtUsdc(state?.balance)}</div>
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-1 font-mono text-[12.5px]">
              <span>{(state?.totalBlocked ?? 0n).toString()} blocked</span>
              <span>{fmtUsdc(protectedAmt)} USDC protected</span>
              <span>0 USDC lost</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Overview({ state, pendingCount, executedToday }: { state?: VaultState; pendingCount: number; executedToday: bigint }) {
  const { address } = useAccount();
  const { vaultWrite } = useTx();
  const isOwner = !!address && !!state?.owner && address.toLowerCase() === state.owner.toLowerCase();
  return (
    <Section
      id="overview"
      title="Overview"
      sub={<>Live from the vault contract{VAULT && <> at <a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={explorerAddr(VAULT)}>{short(VAULT)}</a></>}. Refreshed every three seconds.</>}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Vault balance · USDC" value={fmtUsdc(state?.balance)} hint="ERC-20 view, 6 decimals" />
        <Stat label="Executed today · USDC" value={fmtUsdc(executedToday)} hint={`${state?.totalExecuted ?? 0n} spends all-time`} tone="ok" />
        <Stat label="Attacks blocked" value={(state?.totalBlocked ?? 0n).toString()} hint="every one is logged onchain" tone="bad" />
        <Stat label="Pending approvals" value={pendingCount} hint="waiting on an auditor" />
        <div className="card flex min-h-[148px] flex-col justify-between lg:col-span-2">
          <div className="cap">Global kill switch</div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[28px] leading-tight tracking-tightest">{state?.paused ? "Spending is paused" : "Spending is live"}</div>
              <div className="cap mt-2">Pausing blocks every agent instantly, including queued approvals.</div>
            </div>
            <button className={state?.paused ? "btn" : "btn bg-bad hover:bg-bad/80"} disabled={!DEMO && !isOwner} onClick={() => vaultWrite("setPaused", [!state?.paused], state?.paused ? "Resume" : "Pause")}>
              {state?.paused ? "Resume spending" : "Pause everything"}
            </button>
          </div>
          {!isOwner && <div className="cap mt-3">Owner wallet required{state?.owner && <> · {short(state.owner)}</>}</div>}
        </div>
      </div>
      <Funds state={state} isOwner={isOwner} />
    </Section>
  );
}

function Funds({ state, isOwner }: { state?: VaultState; isOwner: boolean }) {
  const { address } = useAccount();
  const { vaultWrite, approveUsdc } = useTx();
  const [dep, setDep] = useState("");
  const [wd, setWd] = useState("");
  const [busy, setBusy] = useState(false);
  const bal = useReadContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address && !DEMO, refetchInterval: 5000 } });

  const deposit = async () => {
    setBusy(true);
    const amt = parseUsdc(dep);
    if (amt > 0n && (await approveUsdc(amt)) && (await vaultWrite("deposit", [amt], "Deposit"))) setDep("");
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
          <button className="btn shrink-0" disabled={busy || !dep} onClick={deposit}>Approve + deposit</button>
        </div>
        <div className="cap mt-3">Wallet balance: {bal.data !== undefined ? fmtUsdc(bal.data) : "—"} USDC · anyone can fund the vault</div>
      </div>
      <div className="card">
        <div className="cap">Withdraw to owner</div>
        <div className="mt-4 flex gap-3">
          <input className="input" inputMode="decimal" placeholder="0.00" value={wd} onChange={(e) => setWd(e.target.value)} />
          <button className="btn-ghost btn shrink-0" disabled={busy || !wd || (!DEMO && !isOwner)} onClick={withdraw}>Withdraw</button>
        </div>
        <div className="cap mt-3">Vault holds {fmtUsdc(state?.balance)} USDC · owner only</div>
      </div>
    </div>
  );
}
