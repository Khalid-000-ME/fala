"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAddress, parseUnits, type Address } from "viem";
import { useApi, type AgentDto, type VaultDto } from "../lib/api";
import { useOwnerWallet } from "../lib/owner";
import { useVaultLogs } from "../hooks/useVaultData";
import { useTx } from "../hooks/useTx";
import { Empty, Section, Stat } from "../components/ui";
import { Activity, Requests } from "../components/Requests";
import { AddAgent, ConnectAgent, EditLimits } from "../components/AgentModals";
import { explorerAddr } from "../config/chain";
import { parseUsdc, short } from "../lib/format";

const KIND_LABEL = { managed: "Fala agent", connected: "Connected", byo: "Own agent" } as const;

export default function VaultPage({ id }: { id: string }) {
  const api = useApi();
  const router = useRouter();
  const owner = useOwnerWallet();
  const { toast } = useTx();
  const [v, setV] = useState<(VaultDto & { agents: AgentDto[] }) | null>(null);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AgentDto | null>(null);
  const [connecting, setConnecting] = useState<AgentDto | null>(null);

  const load = useCallback(() => api<VaultDto & { agents: AgentDto[] }>(`/api/vaults/${id}`).then(setV).catch((e) => (/not found/.test(e.message) ? setMissing(true) : toast(e.message, "bad"))), [api, id, toast]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const logs = useVaultLogs(v ? { address: v.address, deployBlock: BigInt(v.deployBlock) } : undefined);
  const known = useMemo(() => Object.entries(logs.payees).filter(([, k]) => k).map(([a]) => a), [logs.payees]);

  if (missing) return <main className="wrap py-24"><Empty>We couldn't find that vault. <Link className="underline" href="/app">Back to my vaults</Link></Empty></main>;
  if (!v) return <main className="wrap py-24"><Empty>Loading vault…</Empty></main>;

  const isOwner = !!owner.address && owner.address.toLowerCase() === v.ownerAddress.toLowerCase();
  const pending = logs.intents.filter((i) => i.status === "PENDING" && i.expiresAt > Date.now() / 1000).length;
  const approved = logs.intents.filter((i) => i.status === "APPROVED").length;

  return (
    <main>
      <section className="wrap pb-2 pt-10">
        <Link href="/app" className="cap hover:text-ink">← My vaults</Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="h-section">{v.name}</h1>
            <div className="cap mt-3">
              <a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={explorerAddr(v.address)}>{short(v.address, 6)}</a> · approvals to {v.approverEmail}
            </div>
          </div>
          <button className="btn-ghost btn btn-sm" onClick={() => router.push("/explore")}>Live demo</button>
        </div>
        {!isOwner && owner.ready && <div className="cap mt-4 text-bad">Your wallet isn't this vault's owner, so owner actions are disabled.</div>}
      </section>

      <Banners v={v} owner={owner} isOwner={isOwner} onDone={load} />

      <Section id="overview" title="Overview" sub="Balance, minimum and approvals at a glance.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Vault balance · USDC" value={v.balance} hint={`minimum ${v.minBalance}`} tone={v.belowMin ? "bad" : undefined} />
          <Stat label="Agents" value={v.agents.length} hint="registered on this vault" />
          <Stat label="Waiting for you" value={pending} hint="reply Approve or Deny" />
          <Stat label="Approved by email" value={approved} hint="verified against Gmail's key" tone="ok" />
        </div>
        <Settings v={v} isOwner={isOwner} onDone={load} />
      </Section>

      <Section
        id="agents"
        title="Agents"
        sub="Anything that can ask this vault for money. Add our agent, connect Claude or another provider, or register one you run yourself."
        aside={<button className="btn" onClick={() => setAdding(true)}>Add agent [ + ]</button>}
      >
        {v.agents.length === 0 ? (
          <div className="card flex flex-col items-start gap-4 py-10"><div className="text-[24px] tracking-tightest">No agents yet</div><p className="cap">Add one to start spending from this vault.</p><button className="btn" onClick={() => setAdding(true)}>Add my first agent</button></div>
        ) : (
          <div className="border-t border-line">
            {v.agents.map((a, i) => <AgentRow key={a.id} a={a} i={i} v={v} isOwner={isOwner} onEdit={() => setEditing(a)} onConnect={() => setConnecting(a)} onChanged={load} />)}
          </div>
        )}
        <Payees v={v} known={known} isOwner={isOwner} />
      </Section>

      <Requests intents={logs.intents} ttl={v.agents.length ? 3600 : 3600} owner={isOwner} inbound={undefined} onCancel={(iid) => owner.write(v.address, "cancel", [iid], "Cancel request")} />
      <Activity events={logs.events} loading={logs.loading} />

      <AddAgent vault={v} open={adding} onClose={() => setAdding(false)} onDone={(a) => { load(); if (a.kind === "connected") setTimeout(load, 500); }} />
      <EditLimits vault={v} agent={editing} onClose={() => setEditing(null)} onDone={load} />
      <ConnectAgent agent={connecting} onClose={() => setConnecting(null)} onDone={load} />
    </main>
  );
}

function Banners({ v, owner, isOwner, onDone }: { v: VaultDto; owner: ReturnType<typeof useOwnerWallet>; isOwner: boolean; onDone: () => void }) {
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (v.belowMin && !amt) setAmt(v.shortfall); /* eslint-disable-next-line */ }, [v.shortfall]);
  const topUp = async () => { setBusy(true); if (await owner.write(v.address, "deposit", [], "Top up", parseUnits(amt || "0", 18))) { setAmt(""); onDone(); } setBusy(false); };
  return (
    <div className="wrap space-y-3 pt-6">
      {v.frozen && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-[#0b2a5b] px-8 py-6 text-white">
          <div><div className="text-[26px] tracking-tightest">🧊 Vault frozen</div><div className="cap !text-white/70 mt-1">The approver froze it by email. No agent can spend until you unfreeze.</div></div>
          <button className="rounded-full bg-white px-5 py-2.5 text-[14px] text-ink disabled:opacity-40" disabled={!isOwner} onClick={async () => (await owner.write(v.address, "unfreeze", [], "Unfreeze")) && onDone()}>Unfreeze</button>
        </div>
      )}
      {v.belowMin && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-[#fde8e6] px-8 py-6">
          <div><div className="text-[24px] tracking-tightest text-bad">Below your minimum</div><div className="cap mt-1">{v.balance} USDC in the vault, minimum {v.minBalance}. Top up {v.shortfall} USDC to keep agents running.</div></div>
          <div className="flex gap-2">
            <input className="input w-32 !bg-white" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <button className="btn" disabled={!isOwner || busy || !amt} onClick={topUp}>{busy ? "…" : "Top up"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Settings({ v, isOwner, onDone }: { v: VaultDto; isOwner: boolean; onDone: () => void }) {
  const api = useApi();
  const owner = useOwnerWallet();
  const { toast } = useTx();
  const [min, setMin] = useState(v.minBalance);
  const [email, setEmail] = useState(v.approverEmail);
  const [dep, setDep] = useState("");
  const [wd, setWd] = useState("");
  const [busy, setBusy] = useState("");
  const emailOk = /^[^\s@]+@gmail\.com$/i.test(email.trim());

  const saveMin = async () => { try { await api(`/api/vaults/${v.id}`, { method: "PATCH", body: { minBalance: Number(min) } }); toast("Minimum saved", "ok"); onDone(); } catch (e: any) { toast(e.message, "bad"); } };
  const saveEmail = async () => {
    setBusy("email");
    const addr = email.trim().toLowerCase();
    if (await owner.write(v.address, "setApprover", [addr], "Change approver")) {
      try { await api(`/api/vaults/${v.id}/approver-sync`, { body: { approverEmail: addr } }); toast("Approver updated", "ok"); onDone(); } catch (e: any) { toast(e.message, "bad"); }
    }
    setBusy("");
  };
  const deposit = async () => { setBusy("dep"); if (await owner.write(v.address, "deposit", [], "Deposit", parseUnits(dep || "0", 18))) { setDep(""); onDone(); } setBusy(""); };
  // withdraw() takes 6-decimal USDC and never reverts on a failed payout, so bound the amount here.
  const tooMuch = Number(wd || 0) > Number(v.balance);
  const withdraw = async () => {
    setBusy("wd");
    if (await owner.write(v.address, "withdraw", [owner.address as Address, parseUsdc(wd)], "Withdraw")) { setWd(""); onDone(); }
    setBusy("");
  };

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="card">
        <div className="cap">Fund the vault</div>
        <div className="mt-4 flex gap-3"><input className="input" inputMode="decimal" placeholder="0.00" value={dep} onChange={(e) => setDep(e.target.value)} /><button className="btn shrink-0" disabled={!isOwner || !dep || !!busy} onClick={deposit}>{busy === "dep" ? "…" : "Deposit"}</button></div>
        <div className="cap mt-3">From your wallet {owner.address ? short(owner.address) : ""}. On testnet, get USDC from the Arc faucet.</div>
      </div>
      <div className="card">
        <div className="cap">Withdraw · USDC</div>
        <div className="mt-4 flex gap-3">
          <input className="input" inputMode="decimal" placeholder="0.00" value={wd} onChange={(e) => setWd(e.target.value)} />
          <button className="btn-ghost btn shrink-0" disabled={!isOwner || !!busy} onClick={() => setWd(v.balance)}>Max</button>
          <button className="btn shrink-0" disabled={!isOwner || !wd || Number(wd) <= 0 || tooMuch || !!busy} onClick={withdraw}>{busy === "wd" ? "…" : "Withdraw"}</button>
        </div>
        <div className={`cap mt-3 ${tooMuch ? "text-bad" : ""}`}>
          {tooMuch ? `The vault only holds ${v.balance} USDC.` : <>Back to your wallet {owner.address ? short(owner.address) : ""}. Pending requests are not reserved.</>}
        </div>
      </div>
      <div className="card">
        <div className="cap">Minimum balance · USDC</div>
        <div className="mt-4 flex gap-3"><input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /><button className="btn-ghost btn shrink-0" disabled={Number(min) === Number(v.minBalance) || !(Number(min) >= 0)} onClick={saveMin}>Save</button></div>
        <div className="cap mt-3">Below this we email you, once a day, until it's topped up.</div>
      </div>
      <div className="card">
        <div className="cap">Approval emails go to</div>
        <div className="mt-4 flex gap-3"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="btn-ghost btn shrink-0" disabled={!isOwner || !emailOk || email.trim().toLowerCase() === v.approverEmail || !!busy} onClick={saveEmail}>{busy === "email" ? "…" : "Change"}</button></div>
        <div className="cap mt-3">Gmail only. Changing it is signed by your wallet.</div>
      </div>
    </div>
  );
}

function AgentRow({ a, i, v, isOwner, onEdit, onConnect, onChanged }: { a: AgentDto; i: number; v: VaultDto; isOwner: boolean; onEdit: () => void; onConnect: () => void; onChanged: () => void }) {
  const api = useApi();
  const owner = useOwnerWallet();
  const { toast } = useTx();
  const [task, setTask] = useState("");
  const [run, setRun] = useState<{ answer: string; steps: { tool: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const pct = a.autoDaily && Number(a.autoDaily) > 0 ? Math.min(100, (Number(a.autoSpentToday) / Number(a.autoDaily)) * 100) : 0;

  const remove = async () => {
    if (!confirm(`Remove ${a.name}? Its API keys stop working and it is deactivated onchain.`)) return;
    if (a.registered) await owner.write(v.address, "setAgent", [a.address, 0n, 0n, 0n, false], "Deactivate agent");
    try { await api(`/api/agents/${a.id}`, { method: "DELETE" }); onChanged(); } catch (e: any) { toast(e.message, "bad"); }
  };
  const runTask = async () => { setBusy(true); setRun(null); try { setRun(await api(`/api/agents/${a.id}/run`, { body: { task } })); } catch (e: any) { toast(e.message, "bad"); } setBusy(false); };

  return (
    <div className="border-b border-line py-6">
      <div className="grid items-start gap-x-6 gap-y-3 lg:grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,1.4fr)_auto]">
        <span className="cap">{String(i + 1).padStart(2, "0")}</span>
        <div>
          <div className="text-[26px] tracking-tightest">{a.name}</div>
          <div className="cap mt-1">
            {KIND_LABEL[a.kind]}{a.provider ? ` · ${a.provider}` : ""} · {short(a.address, 6)} · <span className={a.registered ? "text-ok" : "text-warn"}>{a.registered ? "active" : "not activated"}</span>
          </div>
        </div>
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-card"><div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} /></div>
          <div className="cap mt-2 flex flex-wrap gap-x-5"><span>{a.autoSpentToday ?? 0} / {a.autoDaily ?? 0} auto today</span><span>auto ≤ {a.autoPerTx ?? 0}</span><span>hard cap {a.hardCap ?? 0}</span></div>
          {a.kind !== "byo" && <div className="cap mt-1">{a.keys?.length ?? 0} API key{(a.keys?.length ?? 0) === 1 ? "" : "s"}</div>}
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {!a.registered ? <button className="btn btn-sm" disabled={!isOwner} onClick={onEdit}>Activate</button> : <button className="btn-ghost btn btn-sm" disabled={!isOwner} onClick={onEdit}>Edit limits</button>}
          {a.kind !== "byo" && <button className="btn-ghost btn btn-sm" onClick={onConnect}>{a.kind === "connected" ? "Connect" : "API key"}</button>}
          <button className="cap px-2 hover:text-bad disabled:opacity-40" disabled={!isOwner} onClick={remove}>[ remove ]</button>
        </div>
      </div>
      {a.kind === "managed" && (
        <div className="mt-4 rounded-2xl bg-card p-4 lg:ml-[3.5rem]">
          <div className="cap">Give the Fala agent a task</div>
          <div className="mt-2 flex gap-3"><input className="input !bg-white" value={task} onChange={(e) => setTask(e.target.value)} placeholder="Buy the $0.10 weather dataset from 0x… then the $2 annual plan" /><button className="btn shrink-0" disabled={busy || task.length < 3 || !a.registered} onClick={runTask}>{busy ? "Working…" : "Run"}</button></div>
          {run && <div className="mt-3 font-mono text-[12.5px]"><div className="text-mute">{run.steps.map((s) => s.tool).join(" → ")}</div><div className="mt-1 whitespace-pre-wrap">{run.answer}</div></div>}
        </div>
      )}
    </div>
  );
}

function Payees({ v, known, isOwner }: { v: VaultDto; known: string[]; isOwner: boolean }) {
  const owner = useOwnerWallet();
  const [p, setP] = useState("");
  return (
    <div className="card mt-6">
      <div className="cap">Known payees · paid instantly when within an agent's allowance</div>
      <ul className="mt-4 space-y-2">
        {known.length ? known.map((a) => (
          <li key={a} className="flex items-center justify-between gap-3 font-mono text-[13px]"><span>{a}</span><button className="cap hover:text-bad disabled:opacity-40" disabled={!isOwner} onClick={() => owner.write(v.address, "setPayee", [a as Address, false], "Remove payee")}>[ remove ]</button></li>
        )) : <li className="cap">None yet — every payment needs your approval.</li>}
      </ul>
      <div className="mt-4 flex gap-3"><input className="input" placeholder="0x… payee address" value={p} onChange={(e) => setP(e.target.value)} /><button className="btn shrink-0" disabled={!isOwner || !isAddress(p)} onClick={async () => (await owner.write(v.address, "setPayee", [p as Address, true], "Add payee")) && setP("")}>Add</button></div>
    </div>
  );
}
