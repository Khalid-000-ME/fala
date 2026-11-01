"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { isAddress, parseUnits, type Address } from "viem";
import { useApi, type AgentDto, type VaultDto } from "../lib/api";
import { useOwnerWallet } from "../lib/owner";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { useVaultLogs } from "../hooks/useVaultData";
import { useTx } from "../hooks/useTx";
import { Empty, Section, Stat } from "../components/ui";
import { AppShell } from "../components/AppShell";
import { Activity, Requests } from "../components/Requests";
import { AddAgent, ConnectAgent, EditLimits } from "../components/AgentModals";
import { explorerAddr } from "../config/chain";
import { parseUsdc, short } from "../lib/format";

const KIND_LABEL = { managed: "Fala agent", connected: "Connected", byo: "Own agent" } as const;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "requests", label: "Requests" },
  { id: "payees", label: "Payees" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

export default function VaultPage({ id }: { id: string }) {
  const api = useApi();
  const owner = useOwnerWallet();
  const { toast } = useTx();
  const [v, setV] = useState<(VaultDto & { agents: AgentDto[] }) | null>(null);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AgentDto | null>(null);
  const [connecting, setConnecting] = useState<AgentDto | null>(null);
  const wallet = useWalletBalance();
  const [tab, setTab] = useState("overview");
  useEffect(() => { const h = location.hash.slice(1); if (TABS.some((t) => t.id === h)) setTab(h); }, []);
  const select = (t: string) => { setTab(t); history.replaceState(null, "", `#${t}`); };

  const load = useCallback(() => api<VaultDto & { agents: AgentDto[] }>(`/api/vaults/${id}`).then(setV).catch((e) => (/not found/.test(e.message) ? setMissing(true) : toast(e.message, "bad"))), [api, id, toast]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const logs = useVaultLogs(v ? { address: v.address, deployBlock: BigInt(v.deployBlock) } : undefined);
  const known = useMemo(() => Object.entries(logs.payees).filter(([, k]) => k).map(([a]) => a), [logs.payees]);

  if (missing) return <AppShell><Empty>Vault not found. <Link className="underline" href="/app">Back to vaults</Link></Empty></AppShell>;
  if (!v) return <AppShell><Empty>Loading…</Empty></AppShell>;

  const isOwner = !!owner.address && owner.address.toLowerCase() === v.ownerAddress.toLowerCase();
  const pending = logs.intents.filter((i) => i.status === "PENDING" && i.expiresAt > Date.now() / 1000).length;
  const items = TABS.map((t) => (t.id === "requests" ? { ...t, badge: pending } : t));

  return (
    <AppShell title={v.name} back items={items} active={tab} onSelect={select}>
      {!isOwner && owner.ready && <div className="cap mb-6 text-bad">This wallet doesn't own this vault. Changes are disabled.</div>}
      <Banners v={v} owner={owner} isOwner={isOwner} onDone={load} />

      {tab === "overview" && (
        <Section title="Overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Vault · USDC" value={v.balance} tone={v.belowMin ? "bad" : undefined} />
            <Stat label="Your wallet · USDC" value={wallet ?? "…"} />
            <Stat label="Waiting for you" value={pending} />
            <Stat label="Agents" value={v.agents.length} />
          </div>
          <Funds v={v} isOwner={isOwner} onDone={load} />
        </Section>
      )}

      {tab === "agents" && (
        <Section title="Agents" aside={<button className="btn" onClick={() => setAdding(true)}>Add agent</button>}>
          {v.agents.length === 0 ? <Empty>No agents yet.</Empty> : (
            <div className="border-t border-line">
              {v.agents.map((a, i) => <AgentRow key={a.id} a={a} i={i} v={v} isOwner={isOwner} onEdit={() => setEditing(a)} onConnect={() => setConnecting(a)} onChanged={load} />)}
            </div>
          )}
        </Section>
      )}

      {tab === "requests" && <Requests intents={logs.intents} ttl={3600} owner={isOwner} inbound={undefined} onCancel={(iid) => owner.write(v.address, "cancel", [iid], "Cancel request")} />}
      {tab === "payees" && <Section title="Payees"><Payees v={v} known={known} isOwner={isOwner} /></Section>}
      {tab === "activity" && <Activity events={logs.events} loading={logs.loading} />}
      {tab === "settings" && <Section title="Settings"><Settings v={v} isOwner={isOwner} onDone={load} /></Section>}

      <AddAgent vault={v} open={adding} onClose={() => setAdding(false)} onDone={(a) => { load(); if (a.kind === "connected") setTimeout(load, 500); }} />
      <EditLimits vault={v} agent={editing} onClose={() => setEditing(null)} onDone={load} />
      <ConnectAgent agent={connecting} onClose={() => setConnecting(null)} onDone={load} />
    </AppShell>
  );
}

function Banners({ v, owner, isOwner, onDone }: { v: VaultDto; owner: ReturnType<typeof useOwnerWallet>; isOwner: boolean; onDone: () => void }) {
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (v.belowMin && !amt) setAmt(v.shortfall); /* eslint-disable-next-line */ }, [v.shortfall]);
  const topUp = async () => { setBusy(true); if (await owner.write(v.address, "deposit", [], "Top up", parseUnits(amt || "0", 18))) { setAmt(""); onDone(); } setBusy(false); };
  return (
    <div className="mb-6 space-y-3 empty:hidden">
      {v.frozen && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-[#0b2a5b] px-8 py-6 text-white">
          <div><div className="text-[24px] tracking-tightest">Vault frozen</div></div>
          <button className="rounded-full bg-white px-5 py-2.5 text-[14px] text-[#030712] disabled:opacity-40" disabled={!isOwner} onClick={async () => (await owner.write(v.address, "unfreeze", [], "Unfreeze")) && onDone()}>Unfreeze</button>
        </div>
      )}
      {v.belowMin && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-bad/15 px-8 py-6">
          <div><div className="text-[24px] tracking-tightest text-bad">Below your minimum</div><div className="cap mt-1">Top up {v.shortfall} USDC</div></div>
          <div className="flex gap-2">
            <input className="input w-32 !bg-canvas" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <button className="btn" disabled={!isOwner || busy || !amt} onClick={topUp}>{busy ? "…" : "Top up"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Funds({ v, isOwner, onDone }: { v: VaultDto; isOwner: boolean; onDone: () => void }) {
  const owner = useOwnerWallet();
  const wallet = useWalletBalance();
  const [dep, setDep] = useState("");
  const [wd, setWd] = useState("");
  const [busy, setBusy] = useState("");
  const deposit = async () => { setBusy("dep"); if (await owner.write(v.address, "deposit", [], "Deposit", parseUnits(dep || "0", 18))) { setDep(""); onDone(); } setBusy(""); };
  // withdraw() takes 6-decimal USDC and never reverts on a failed payout, so bound the amount here.
  const tooMuch = Number(wd || 0) > Number(v.balance);
  const withdraw = async () => {
    setBusy("wd");
    if (await owner.write(v.address, "withdraw", [owner.address as Address, parseUsdc(wd)], "Withdraw")) { setWd(""); onDone(); }
    setBusy("");
  };
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="card">
        <div className="cap">Deposit · wallet has {wallet ?? "…"}</div>
        <div className="mt-4 flex gap-3"><input className="input" inputMode="decimal" placeholder="0.00" value={dep} onChange={(e) => setDep(e.target.value)} /><button className="btn shrink-0" disabled={!isOwner || !dep || !!busy} onClick={deposit}>{busy === "dep" ? "…" : "Deposit"}</button></div>
      </div>
      <div className="card">
        <div className="cap">Withdraw</div>
        <div className="mt-4 flex gap-3">
          <input className="input" inputMode="decimal" placeholder="0.00" value={wd} onChange={(e) => setWd(e.target.value)} />
          <button className="btn-ghost btn shrink-0" disabled={!isOwner || !!busy} onClick={() => setWd(v.balance)}>Max</button>
          <button className="btn shrink-0" disabled={!isOwner || !wd || Number(wd) <= 0 || tooMuch || !!busy} onClick={withdraw}>{busy === "wd" ? "…" : "Withdraw"}</button>
        </div>
        {tooMuch && <div className="cap mt-3 text-bad">The vault holds {v.balance} USDC.</div>}
      </div>
    </div>
  );
}

function Settings({ v, isOwner, onDone }: { v: VaultDto; isOwner: boolean; onDone: () => void }) {
  const api = useApi();
  const owner = useOwnerWallet();
  const { toast } = useTx();
  const [min, setMin] = useState(v.minBalance);
  const [email, setEmail] = useState(v.approverEmail);
  const [busy, setBusy] = useState(false);
  const emailOk = /^[^\s@]+@gmail\.com$/i.test(email.trim());
  const saveMin = async () => { try { await api(`/api/vaults/${v.id}`, { method: "PATCH", body: { minBalance: Number(min) } }); toast("Minimum saved", "ok"); onDone(); } catch (e: any) { toast(e.message, "bad"); } };
  const saveEmail = async () => {
    setBusy(true);
    const addr = email.trim().toLowerCase();
    if (await owner.write(v.address, "setApprover", [addr], "Change approver")) {
      try { await api(`/api/vaults/${v.id}/approver-sync`, { body: { approverEmail: addr } }); toast("Approver updated", "ok"); onDone(); } catch (e: any) { toast(e.message, "bad"); }
    }
    setBusy(false);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <div className="cap">Approver Gmail</div>
        <div className="mt-4 flex gap-3"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="btn-ghost btn shrink-0" disabled={!isOwner || !emailOk || email.trim().toLowerCase() === v.approverEmail || busy} onClick={saveEmail}>{busy ? "…" : "Change"}</button></div>
      </div>
      <div className="card">
        <div className="cap">Minimum balance · USDC</div>
        <div className="mt-4 flex gap-3"><input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /><button className="btn-ghost btn shrink-0" disabled={Number(min) === Number(v.minBalance) || !(Number(min) >= 0)} onClick={saveMin}>Save</button></div>
      </div>
      <div className="card lg:col-span-2">
        <div className="cap">Vault address</div>
        <a className="mt-3 block break-all font-mono text-[13px] underline underline-offset-4" target="_blank" rel="noreferrer" href={explorerAddr(v.address)}>{v.address}</a>
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
          <div className="mt-2 flex gap-3"><input className="input !bg-canvas" value={task} onChange={(e) => setTask(e.target.value)} placeholder="Buy the $0.10 weather dataset from 0x… then the $2 annual plan" /><button className="btn shrink-0" disabled={busy || task.length < 3 || !a.registered} onClick={runTask}>{busy ? "Working…" : "Run"}</button></div>
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
    <div className="card">
      <div className="cap">Paid instantly within an agent's allowance</div>
      <ul className="mt-4 space-y-2">
        {known.length ? known.map((a) => (
          <li key={a} className="flex items-center justify-between gap-3 font-mono text-[13px]"><span>{a}</span><button className="cap hover:text-bad disabled:opacity-40" disabled={!isOwner} onClick={() => owner.write(v.address, "setPayee", [a as Address, false], "Remove payee")}>[ remove ]</button></li>
        )) : <li className="cap">None yet.</li>}
      </ul>
      <div className="mt-4 flex gap-3"><input className="input" placeholder="0x… payee address" value={p} onChange={(e) => setP(e.target.value)} /><button className="btn shrink-0" disabled={!isOwner || !isAddress(p)} onClick={async () => (await owner.write(v.address, "setPayee", [p as Address, true], "Add payee")) && setP("")}>Add</button></div>
    </div>
  );
}
