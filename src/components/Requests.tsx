"use client";

import { useMemo, useState } from "react";
import { explorerTx, VAULT } from "../config/chain";
import { ago, countdown, fmtUsdc } from "../lib/format";
import { REJECTION, type FeedEvent, type FeedKind, type IntentRow } from "../lib/types";
import { Hash, Usdc } from "./Icons";
import { Empty, Section } from "./ui";
import { useTx } from "../hooks/useTx";
import { useOwnerWallet } from "../lib/owner";
import { useNow } from "../hooks/useVaultData";

const ENV_INBOUND = process.env.NEXT_PUBLIC_INBOUND_ADDRESS as string | undefined;

const CHIP: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-warn/15 text-warn" },
  APPROVED: { label: "Approved", cls: "bg-info/15 text-info" },
  DENIED: { label: "Denied", cls: "bg-card text-mute" },
  EXPIRED: { label: "Expired", cls: "bg-card text-mute" },
  CANCELLED: { label: "Cancelled", cls: "bg-card text-mute" },
  FAILED: { label: "Failed", cls: "bg-bad/15 text-bad" },
};

const subjectOf = (verb: "APPROVE" | "DENY", i: IntentRow) => `FALA ${verb} ${i.id} ${i.code}`;
const mailto = (to: string, subject: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}`;

export function Requests({ intents, ttl, owner, onCancel, inbound }: { intents: IntentRow[]; ttl: number; owner: boolean; onCancel?: (id: bigint) => void; inbound?: string }) {
  const now = useNow();
  const { toast } = useTx();
  const { write } = useOwnerWallet();
  const live = (i: IntentRow) => i.status === "PENDING" && i.expiresAt > now;
  const waiting = intents.filter(live);
  void ttl;
  const INBOUND = inbound ?? ENV_INBOUND;
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast("Subject copied", "ok"));

  return (
    <Section id="requests" title="Requests">
      <div className="grid gap-4 md:grid-cols-2">
        {waiting.length === 0 && <div className="md:col-span-2"><Empty>Nothing is waiting for you.</Empty></div>}
        {waiting.map((i) => (
          <div key={String(i.id)} className="card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="cap">Request #{String(i.id)}</div>
                <div className="cap mt-1"><Hash value={i.agent} /> → <Hash value={i.payee} /></div>
                <div className="mt-2 text-[40px] leading-none tracking-tightest"><Usdc value={fmtUsdc(i.amount)} size={24} /></div>
              </div>
              <span className="tag rounded-full bg-canvas px-3 py-1 text-warn">{countdown(i.expiresAt - now)}</span>
            </div>
            <p className="mt-4 break-words text-[14px]">“{i.memo || "no memo"}”</p>
            <div className="mt-4 rounded-2xl bg-canvas px-4 py-3">
              <div className="cap">Reply with this exact subject</div>
              <button className="mt-1 break-all text-left font-mono text-[13.5px] hover:text-accent" onClick={() => copy(subjectOf("APPROVE", i))} title="Copy">{subjectOf("APPROVE", i)}</button>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {INBOUND ? (
                <>
                  <a className="btn btn-sm" href={mailto(INBOUND!, subjectOf("APPROVE", i))}>✅ Approve</a>
                  <a className="btn-ghost btn btn-sm" href={mailto(INBOUND!, subjectOf("DENY", i))}>❌ Deny</a>
                </>
              ) : (
                <span className="cap">Check your inbox for the Approve / Deny buttons.</span>
              )}
              <button className="cap ml-auto hover:text-ink disabled:opacity-40" disabled={!owner} onClick={() => (onCancel ? onCancel(i.id) : write(VAULT!, "cancel", [i.id], "Cancel request"))}>Cancel</button>
            </div>
          </div>
        ))}
      </div>

      {intents.length > 0 && (
        <div className="mt-10 border-t border-line">
          {intents.map((i) => {
            const status = i.status === "PENDING" && i.expiresAt <= now ? "EXPIRED" : i.status;
            const chip = CHIP[status];
            return (
              <div key={String(i.id)} className="row grid-cols-[1fr_auto] gap-y-1 md:grid-cols-[4rem_10.5rem_minmax(0,1fr)_7rem_6rem]">
                <span className="cap">#{String(i.id)}</span>
                <span className={`tag w-fit rounded-full px-3 py-1 ${chip.cls}`}>{chip.label}</span>
                <span className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
                  <span className="block truncate text-[17px]"><Hash value={i.agent} /> → <Hash value={i.payee} /></span>
                  <span className="cap block truncate">
                    “{i.memo}”
                    
                  </span>
                </span>
                <Usdc value={fmtUsdc(i.amount)} size={14} className="justify-end text-[17px] md:justify-start" />
                <a className="cap text-right hover:text-accent" href={explorerTx(i.settledTx ?? i.tx)} target="_blank" rel="noreferrer">{ago(i.createdAt, now)} ↗</a>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

const KIND: Record<FeedKind, { label: string; dot: string; text: string }> = {
  autopaid: { label: "Auto-paid", dot: "bg-ok", text: "text-ok" },
  pending: { label: "Requested", dot: "bg-warn", text: "text-warn" },
  approved: { label: "Paid by email", dot: "bg-info", text: "text-info" },
  denied: { label: "Denied", dot: "bg-mute", text: "text-mute" },
  expired: { label: "Expired", dot: "bg-mute", text: "text-mute" },
  cancelled: { label: "Cancelled", dot: "bg-mute", text: "text-mute" },
  failed: { label: "Payout failed", dot: "bg-bad", text: "text-bad" },
  rejected: { label: "Refused", dot: "bg-bad", text: "text-bad" },
  frozen: { label: "Frozen", dot: "bg-info", text: "text-info" },
  unfrozen: { label: "Unfrozen", dot: "bg-ok", text: "text-ok" },
  deposit: { label: "Deposit", dot: "bg-ink", text: "text-ink" },
  withdraw: { label: "Withdraw", dot: "bg-ink", text: "text-ink" },
};

export function Activity({ events, loading }: { events: FeedEvent[]; loading: boolean }) {
  const now = useNow(5000);
  const [kind, setKind] = useState<FeedKind | "all">("all");
  const rows = useMemo(() => events.filter((e) => kind === "all" || e.kind === kind).slice().reverse(), [events, kind]);
  const kinds = useMemo(() => ["all", ...new Set(events.map((e) => e.kind))] as (FeedKind | "all")[], [events]);
  return (
    <Section id="activity" title="Activity">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {kinds.map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`tag rounded-xl px-4 py-1.5 transition ${kind === k ? "bg-ink text-canvas" : "bg-card text-mute hover:text-ink"}`}>
            {k === "all" ? "All" : KIND[k].label}
          </button>
        ))}
      </div>
      {loading ? <Empty>Reading vault events…</Empty> : !rows.length ? <Empty>No events yet.</Empty> : (
        <div className="border-t border-line">
          {rows.slice(0, 80).map((e) => {
            const k = KIND[e.kind];
            return (
              <div key={e.id} className="row group grid-cols-[1fr_auto] gap-y-1 transition hover:bg-card/60 md:grid-cols-[9.5rem_minmax(0,1fr)_8rem_6rem]">
                <span className={`tag flex items-center gap-2 ${k.text}`}><i className={`h-2 w-2 rounded-full ${k.dot}`} />{k.label}</span>
                <span className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
                  <span className="block truncate text-[17px]">
                    {e.kind === "rejected" ? REJECTION[e.reason ?? 0] : e.agent ? <><Hash value={e.agent} /> → <Hash value={e.payee} /></> : e.intentId ? `Request #${e.intentId}` : e.kind === "frozen" ? "Approver emailed FREEZE" : ""}
                  </span>
                  {e.memo && <span className="cap block truncate">“{e.memo}”</span>}
                </span>
                <span className="text-right text-[17px] md:text-left">{e.amount !== undefined && <Usdc value={fmtUsdc(e.amount)} size={14} />}</span>
                <a className="cap text-right hover:text-accent" href={explorerTx(e.tx)} target="_blank" rel="noreferrer">{ago(e.ts, now)} ↗</a>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
