import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { DEMO } from "../config/chain";
import { fmtUsdc, parseUsdc, short } from "../lib/format";
import type { AgentRow, KeyRow } from "../lib/types";
import { Empty, Field, Modal, Section } from "./ui";
import { useTx } from "../hooks/useTx";
import type { VaultState } from "../hooks/useVaultData";

const LS = "fala:labels";
const loadJson = <T,>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? "") as T; } catch { return d; }
};
const saveJson = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ }
};
const mask = (email: string) => {
  const [u, d] = email.split("@");
  return u && d ? `${u[0]}${"*".repeat(Math.max(2, u.length - 1))}@${d}` : email;
};

export function Agents({ state, payees, keys, owner }: { state?: VaultState; payees: Record<string, boolean>; keys: KeyRow[]; owner: boolean }) {
  const { vaultWrite } = useTx();
  const can = DEMO || owner;
  const [labels, setLabels] = useState<Record<string, string>>(() => loadJson(LS, {}));
  const [editing, setEditing] = useState<AgentRow | "new" | null>(null);
  const [payee, setPayee] = useState("");
  const labelOf = (a: string, i: number) => labels[a.toLowerCase()] || (DEMO && i === 0 ? "Worker agent" : `Agent ${i + 1}`);
  const setLabel = (a: string, l: string) => {
    const next = { ...labels, [a.toLowerCase()]: l };
    setLabels(next);
    saveJson(LS, next);
  };
  const known = Object.entries(payees).filter(([, v]) => v).map(([a]) => a);

  return (
    <Section
      id="agents"
      title="Agents"
      sub="Each agent key has an automatic allowance. Above it, the agent can only ask — your email reply is what unlocks the money."
      aside={<button className="btn" disabled={!can} onClick={() => setEditing("new")}>Register agent [ + ]</button>}
    >
      {!state?.agents.length ? (
        <Empty>No agents registered yet.</Empty>
      ) : (
        <div className="border-t border-line">
          {state.agents.map((a, i) => {
            const pct = a.autoDaily ? Number((a.autoSpentToday * 100n) / a.autoDaily) : 0;
            return (
              <div key={a.address} className="row grid-cols-[2rem_1fr] lg:grid-cols-[2.5rem_minmax(0,1.1fr)_minmax(0,1.5fr)_auto]">
                <span className="cap">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <input className="w-full bg-transparent text-[26px] tracking-tightest outline-none focus:underline" value={labelOf(a.address, i)} onChange={(e) => setLabel(a.address, e.target.value)} aria-label="Agent label" />
                  <div className="cap mt-1">{short(a.address, 6)} · <span className={a.active ? "text-ok" : "text-bad"}>{a.active ? "Active" : "Inactive"}</span></div>
                </div>
                <div className="col-start-2 mt-3 lg:col-start-auto lg:mt-0">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-card"><div className="h-full rounded-full bg-ink transition-all" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                  <div className="cap mt-2 flex flex-wrap gap-x-5">
                    <span>{fmtUsdc(a.autoSpentToday)} / {fmtUsdc(a.autoDaily)} auto today</span>
                    <span>auto ≤ {fmtUsdc(a.autoPerTx)} per tx</span>
                    <span>hard cap {fmtUsdc(a.hardCap)}</span>
                  </div>
                </div>
                <div className="col-start-2 mt-4 flex flex-wrap gap-2 lg:col-start-auto lg:mt-0 lg:justify-end">
                  <button className="btn-ghost btn btn-sm" disabled={!can} onClick={() => setEditing(a)}>Edit limits</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="cap">Known payees · paid instantly when small</div>
          <ul className="mt-4 space-y-2">
            {known.length ? known.map((p) => (
              <li key={p} className="flex items-center justify-between gap-3 font-mono text-[13px]">
                <span>{short(p, 6)}</span>
                <button className="cap hover:text-bad disabled:opacity-40" disabled={!can} onClick={() => vaultWrite("setPayee", [p, false], "Remove payee")}>[ remove ]</button>
              </li>
            )) : <li className="cap">None yet — every payment needs your approval.</li>}
          </ul>
          <div className="mt-4 flex gap-3">
            <input className="input" placeholder="0x… payee" value={payee} onChange={(e) => setPayee(e.target.value)} />
            <button className="btn shrink-0" disabled={!can || !isAddress(payee)} onClick={async () => (await vaultWrite("setPayee", [payee, true], "Add payee")) && setPayee("")}>Add</button>
          </div>
        </div>
        <ApproverCard keys={keys} state={state} can={can} />
      </div>
      {!can && <div className="cap mt-5">Connect the owner wallet to change limits, payees or keys.</div>}
      <AgentModal target={editing} onClose={() => setEditing(null)} />
    </Section>
  );
}

function ApproverCard({ keys, state, can }: { keys: KeyRow[]; state?: VaultState; can: boolean }) {
  const { vaultWrite } = useTx();
  const [email, setEmail] = useState(() => loadJson<string>("fala:approver", ""));
  const now = Math.floor(Date.now() / 1000);
  const remember = (v: string) => { setEmail(v); saveJson("fala:approver", v); };
  return (
    <div className="card">
      <div className="cap">Approvals come from</div>
      <div className="mt-2 text-[26px] tracking-tightest">{email.includes("@") ? mask(email) : "one Gmail address"}</div>
      <p className="cap mt-1">The chain stores only a hash of the address. Type it here to remember it in this browser.</p>
      <input className="input mt-3" placeholder="approver@gmail.com (browser only)" value={email} onChange={(e) => remember(e.target.value)} />
      <div className="cap mt-6">Trusted DKIM keys</div>
      <ul className="mt-3 space-y-2">
        {keys.map((k) => {
          const flag = state?.keyFlags.find((f) => f.id === k.id);
          const revoked = flag?.revoked ?? k.revoked;
          const waiting = (flag?.activeAt ?? k.activeAt) > now;
          return (
            <li key={k.id} className="flex items-center justify-between gap-3 font-mono text-[13px]">
              <span>{k.domain} · <span className="text-mute">{k.selector}</span></span>
              <span className={revoked ? "text-bad" : waiting ? "text-warn" : "text-ok"}>
                {revoked ? "revoked" : waiting ? "timelocked" : "active"}
                {!revoked && <button className="cap ml-3 hover:text-bad disabled:opacity-40" disabled={!can} onClick={() => vaultWrite("revokeKey", [k.id], "Revoke key")}>[ revoke ]</button>}
              </span>
            </li>
          );
        })}
        {!keys.length && <li className="cap">Reading keys…</li>}
      </ul>
      <p className="cap mt-4">New keys wait out a {state ? Math.round(state.keyTimelock / 3600) : 24}h timelock; revoking is instant. If Google rotates its key, approvals fail closed until the new one is added.</p>
    </div>
  );
}

function AgentModal({ target, onClose }: { target: AgentRow | "new" | null; onClose: () => void }) {
  const { vaultWrite } = useTx();
  const isNew = target === "new";
  const cur = target && target !== "new" ? target : null;
  const [f, setF] = useState({ agent: "", per: "0.20", daily: "1", cap: "5", active: true });
  useEffect(() => {
    if (!target) return;
    const t = (v: bigint) => fmtUsdc(v, 6).replace(/,/g, "");
    setF(cur ? { agent: cur.address, per: t(cur.autoPerTx), daily: t(cur.autoDaily), cap: t(cur.hardCap), active: cur.active } : { agent: "", per: "0.20", daily: "1", cap: "5", active: true });
  }, [target, cur]);
  const up = (k: "agent" | "per" | "daily" | "cap") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const err = !isAddress(f.agent) ? "Agent must be a valid address" : parseUsdc(f.per) > parseUsdc(f.cap) ? "Auto per-tx can't exceed the hard cap" : null;
  const save = async () => {
    if (await vaultWrite("setAgent", [f.agent, parseUsdc(f.per), parseUsdc(f.daily), parseUsdc(f.cap), f.active], isNew ? "Register agent" : "Update limits")) onClose();
  };
  return (
    <Modal open={!!target} onClose={onClose} title={isNew ? "Register agent" : "Edit limits"}>
      <div className="space-y-4">
        <Field label="Agent address"><input className="input" value={f.agent} onChange={up("agent")} disabled={!isNew} placeholder="0x…" /></Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Auto / tx"><input className="input" value={f.per} onChange={up("per")} /></Field>
          <Field label="Auto / day"><input className="input" value={f.daily} onChange={up("daily")} /></Field>
          <Field label="Hard cap"><input className="input" value={f.cap} onChange={up("cap")} /></Field>
        </div>
        <label className="flex items-center gap-3 font-mono text-[13px]"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        <p className="cap">Above “auto / tx” (or to an unknown payee) the agent can only request — you approve by email. Above the hard cap not even an email can approve.</p>
        {err && <div className="cap text-bad">{err}</div>}
        <button className="btn w-full" disabled={!!err} onClick={save}>{isNew ? "Register" : "Save"}</button>
      </div>
    </Modal>
  );
}
