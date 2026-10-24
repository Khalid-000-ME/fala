import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { DEMO, explorerTx } from "../config/chain";
import { ago, countdown, fmtUsdc, short } from "../lib/format";
import { reasonLabel, REASON } from "../lib/reasons";
import type { AgentRow, EventKind, FeedEvent, PendingRow } from "../lib/types";
import { Empty, Section } from "./ui";
import { useTx } from "../hooks/useTx";
import { useNow } from "../hooks/useVaultData";

const KIND: Record<EventKind, { label: string; dot: string; text: string }> = {
  executed: { label: "Executed", dot: "bg-ok", text: "text-ok" },
  blocked: { label: "Blocked", dot: "bg-bad", text: "text-bad" },
  queued: { label: "Queued", dot: "bg-warn", text: "text-warn" },
  approved: { label: "Approved", dot: "bg-info", text: "text-info" },
  rejected: { label: "Rejected", dot: "bg-mute", text: "text-mute" },
};

export function Pending({ rows, agents, ttl, owner }: { rows: PendingRow[]; agents: AgentRow[]; ttl: number; owner?: string }) {
  const { address } = useAccount();
  const { vaultWrite } = useTx();
  const now = useNow();
  const canAct = (p: PendingRow) => {
    if (DEMO) return true;
    const me = address?.toLowerCase();
    if (!me) return false;
    const a = agents.find((x) => x.address.toLowerCase() === p.agent.toLowerCase());
    return me === owner?.toLowerCase() || me === a?.policy.auditor.toLowerCase();
  };
  return (
    <Section id="approvals" title="Pending approvals" sub="Spends above the co-sign threshold wait here for a second key. The agent can never approve its own request.">
      {!rows.length ? (
        <Empty>Nothing waiting. Large spends from agents will show up here.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((p) => {
            const left = p.createdAt + ttl - now;
            return (
              <div key={String(p.id)} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="cap">#{String(p.id)} · {short(p.agent)} → {short(p.payee)}</div>
                    <div className="mt-2 text-[40px] leading-none tracking-tightest">{fmtUsdc(p.amount)} <span className="text-[18px] text-mute">USDC</span></div>
                  </div>
                  <span className={`tag rounded-full bg-white px-3 py-1 ${left <= 0 ? "text-bad" : "text-warn"}`}>{countdown(left)}</span>
                </div>
                <p className="mt-4 break-words font-mono text-[13px]">“{p.note || "no note"}”</p>
                <div className="mt-6 flex items-center gap-3">
                  <button className="btn btn-sm" disabled={!canAct(p)} onClick={() => vaultWrite("approve", [p.id], "Approve")}>Approve</button>
                  <button className="btn-ghost btn btn-sm bg-white" disabled={!canAct(p)} onClick={() => vaultWrite("reject", [p.id], "Reject")}>Reject</button>
                  <span className="cap ml-auto">{ago(p.createdAt, now)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function Activity({ events, loading }: { events: FeedEvent[]; loading: boolean }) {
  const now = useNow(5000);
  const [kind, setKind] = useState<EventKind | "all">("all");
  const [agent, setAgent] = useState("all");
  const agents = useMemo(() => [...new Set(events.map((e) => e.agent).filter(Boolean) as string[])], [events]);
  const rows = useMemo(
    () => events.filter((e) => (kind === "all" || e.kind === kind) && (agent === "all" || e.agent === agent)).slice().reverse(),
    [events, kind, agent],
  );
  return (
    <Section
      id="activity"
      title="Activity"
      sub="Merged vault events, newest first. Blocked attempts are written to the chain on purpose — an attack log nobody can quietly delete."
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["all", ...Object.keys(KIND)] as const).map((k) => (
          <button key={k} onClick={() => setKind(k as EventKind | "all")} className={`tag rounded-full px-4 py-1.5 transition ${kind === k ? "bg-ink text-white" : "bg-card text-mute hover:text-ink"}`}>
            {k === "all" ? "All" : KIND[k as EventKind].label}
          </button>
        ))}
        <select className="tag ml-auto rounded-full bg-card px-4 py-1.5 text-mute outline-none" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="all">All agents</option>
          {agents.map((a) => <option key={a} value={a}>{short(a)}</option>)}
        </select>
      </div>
      {loading ? (
        <Empty>Reading vault events…</Empty>
      ) : !rows.length ? (
        <Empty>No events yet.</Empty>
      ) : (
        <div className="border-t border-line">
          {rows.slice(0, 80).map((e) => {
            const k = KIND[e.kind];
            return (
              <a key={e.id} href={explorerTx(e.tx)} target="_blank" rel="noreferrer" className="row group grid-cols-[1fr_auto] gap-y-1 transition hover:bg-card/60 md:grid-cols-[9rem_minmax(0,1fr)_9rem_6rem]">
                <span className={`tag flex items-center gap-2 ${k.text}`}><i className={`h-2 w-2 rounded-full ${k.dot}`} />{k.label}</span>
                <span className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
                  <span className="block truncate text-[17px]">
                    {e.kind === "blocked" && reasonLabel(e.reason ?? 0)}
                    {e.kind === "rejected" && (e.reason ? reasonLabel(e.reason) : "Rejected by auditor")}
                    {e.kind === "approved" && `Approved #${e.pendingId} by ${short(e.by)}`}
                    {(e.kind === "executed" || e.kind === "queued") && `${short(e.agent)} → ${short(e.payee)}`}
                  </span>
                  {e.note && <span className="cap block truncate">“{e.note}”</span>}
                </span>
                <span className="text-right text-[17px] md:text-left">{e.amount !== undefined ? `${fmtUsdc(e.amount)}` : ""}</span>
                <span className="cap text-right group-hover:text-accent">{ago(e.ts, now)}</span>
              </a>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function Scoreboard({ events, protectedAmt }: { events: FeedEvent[]; protectedAmt: bigint }) {
  const blocked = events.filter((e) => e.kind === "blocked");
  const counts = REASON.map((_, i) => blocked.filter((e) => e.reason === i).length);
  const max = Math.max(1, ...counts);
  const items = counts.map((c, i) => ({ c, i })).filter((x) => x.c > 0 && x.i > 0).sort((a, b) => b.c - a.c);
  return (
    <Section id="redteam" title="Red-team scoreboard" sub="What the vault refused, grouped by the rule that stopped it.">
      <div className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
        <div className="card flex flex-col justify-between gap-10">
          <div className="cap">[ attacks stopped ]</div>
          <div>
            <div className="text-[clamp(4rem,9vw,7rem)] leading-none tracking-tightest text-bad">{blocked.length}</div>
            <div className="mt-4 text-[20px]">{fmtUsdc(protectedAmt)} USDC protected · <span className="text-ok">0 USDC lost</span></div>
          </div>
        </div>
        <div className="card">
          {!items.length ? (
            <div className="cap py-8">No blocked attempts recorded yet.</div>
          ) : (
            <ul className="space-y-4">
              {items.map(({ c, i }, n) => (
                <li key={i} className="grid grid-cols-[2rem_1fr_2rem] items-center gap-x-4">
                  <span className="cap">{String(n + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="text-[17px]">{REASON[i]}</div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-bad" style={{ width: `${(c / max) * 100}%` }} /></div>
                  </div>
                  <span className="text-right font-mono text-[14px]">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}
