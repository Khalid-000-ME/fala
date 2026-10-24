import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { isAddress, zeroAddress } from "viem";
import { DEMO, VAULT } from "../config/chain";
import { falaVaultAbi } from "../lib/abi";
import { fmtUsdc, parseUsdc, short } from "../lib/format";
import type { AgentRow } from "../lib/types";
import { Empty, Field, Modal, Section } from "./ui";
import { useTx } from "../hooks/useTx";
import type { VaultState } from "../hooks/useVaultData";
import { useNow } from "../hooks/useVaultData";

const LS = "fala:labels";
const loadLabels = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(LS) ?? "{}"); } catch { return {}; }
};

function status(a: AgentRow, now: number): { text: string; tone: string } {
  if (!a.policy.active) return { text: "Frozen", tone: "text-bad" };
  if (a.policy.expiry && now > a.policy.expiry) return { text: "Expired", tone: "text-warn" };
  return { text: "Active", tone: "text-ok" };
}

export function Agents({ state, isOwnerOverride }: { state?: VaultState; isOwnerOverride?: boolean }) {
  const { address } = useAccount();
  const { vaultWrite } = useTx();
  const now = useNow(10_000);
  const [labels, setLabels] = useState(loadLabels);
  const [editing, setEditing] = useState<AgentRow | "new" | null>(null);
  const [listFor, setListFor] = useState<AgentRow | null>(null);
  const isOwner = isOwnerOverride ?? (!!address && address.toLowerCase() === state?.owner?.toLowerCase());
  const can = DEMO || isOwner;
  const labelOf = (a: string, i: number) => labels[a.toLowerCase()] || (DEMO && i === 0 ? "Worker agent" : `Agent ${i + 1}`);
  const setLabel = (a: string, l: string) => {
    const next = { ...labels, [a.toLowerCase()]: l };
    setLabels(next);
    try { localStorage.setItem(LS, JSON.stringify(next)); } catch { /* storage blocked */ }
  };

  return (
    <Section
      id="agents"
      title="Agents"
      sub="Each agent is a key with its own policy. The vault, not the app, decides whether a spend goes through."
      aside={<button className="btn" disabled={!can} onClick={() => setEditing("new")}>Register agent [ + ]</button>}
    >
      {!state?.agents.length ? (
        <Empty>No agents registered yet.</Empty>
      ) : (
        <div className="border-t border-line">
          {state.agents.map((a, i) => {
            const st = status(a, now);
            const pct = a.policy.dailyCap ? Number((a.spentToday * 100n) / a.policy.dailyCap) : 0;
            return (
              <div key={a.address} className="row grid-cols-[2rem_1fr] lg:grid-cols-[2.5rem_minmax(0,1.1fr)_minmax(0,1.5fr)_auto]">
                <span className="cap">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <input
                    className="w-full bg-transparent text-[26px] tracking-tightest outline-none focus:underline"
                    value={labelOf(a.address, i)}
                    onChange={(e) => setLabel(a.address, e.target.value)}
                    aria-label="Agent label"
                  />
                  <div className="cap mt-1">{short(a.address, 6)} · <span className={st.tone}>{st.text}</span> · {a.blocked} blocked</div>
                </div>
                <div className="col-start-2 mt-3 lg:col-start-auto lg:mt-0">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-card">
                    <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <div className="cap mt-2 flex flex-wrap gap-x-5">
                    <span>{fmtUsdc(a.spentToday)} / {fmtUsdc(a.policy.dailyCap)} today</span>
                    <span>{a.txToday}/{a.policy.maxTxPerDay} tx</span>
                    <span>≤ {fmtUsdc(a.policy.perTxCap)} per tx</span>
                    <span>co-sign &gt; {fmtUsdc(a.policy.coSignThreshold)}</span>
                    <span>auditor {short(a.policy.auditor)}</span>
                  </div>
                </div>
                <div className="col-start-2 mt-4 flex flex-wrap gap-2 lg:col-start-auto lg:mt-0 lg:justify-end">
                  <button className="btn-ghost btn btn-sm" disabled={!can} onClick={() => setEditing(a)}>Edit policy</button>
                  <button className="btn-ghost btn btn-sm" disabled={!can} onClick={() => setListFor(a)}>Allowlist</button>
                  <button
                    className={`btn btn-sm ${a.policy.active ? "bg-bad hover:bg-bad/80" : ""}`}
                    disabled={!can}
                    onClick={() => vaultWrite("freezeAgent", [a.address, a.policy.active], a.policy.active ? "Freeze" : "Unfreeze")}
                  >
                    {a.policy.active ? "Freeze" : "Unfreeze"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!can && <div className="cap mt-5">Connect the owner wallet to change policies.</div>}
      <PolicyModal target={editing} onClose={() => setEditing(null)} />
      <AllowlistModal agent={listFor} onClose={() => setListFor(null)} />
    </Section>
  );
}

function PolicyModal({ target, onClose }: { target: AgentRow | "new" | null; onClose: () => void }) {
  const { vaultWrite } = useTx();
  const isNew = target === "new";
  const cur = target && target !== "new" ? target : null;
  const [f, setF] = useState({ agent: "", per: "3", daily: "5", co: "1", days: "14", max: "8", auditor: "" });
  useEffect(() => {
    if (!target) return;
    if (cur) {
      const left = cur.policy.expiry ? Math.max(0, Math.round((cur.policy.expiry - Date.now() / 1000) / 86400)) : 0;
      setF({ agent: cur.address, per: fmtUsdc(cur.policy.perTxCap, 6).replace(/,/g, ""), daily: fmtUsdc(cur.policy.dailyCap, 6).replace(/,/g, ""), co: fmtUsdc(cur.policy.coSignThreshold, 6).replace(/,/g, ""), days: String(left), max: String(cur.policy.maxTxPerDay), auditor: cur.policy.auditor });
    } else setF({ agent: "", per: "3", daily: "5", co: "1", days: "14", max: "8", auditor: "" });
  }, [target, cur]);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const err =
    !isAddress(f.agent) ? "Agent must be a valid address"
    : !isAddress(f.auditor) ? "Auditor must be a valid address"
    : f.agent.toLowerCase() === f.auditor.toLowerCase() ? "Auditor must differ from the agent (dual control)"
    : parseUsdc(f.co) > parseUsdc(f.per) ? "Co-sign threshold cannot exceed the per-tx cap"
    : null;

  const save = async () => {
    const expiry = Number(f.days) > 0 ? Math.floor(Date.now() / 1000) + Number(f.days) * 86400 : 0;
    const ok = await vaultWrite(
      "configureAgent",
      [f.agent, { perTxCap: parseUsdc(f.per), dailyCap: parseUsdc(f.daily), coSignThreshold: parseUsdc(f.co), expiry, maxTxPerDay: Number(f.max), active: cur ? cur.policy.active : true, auditor: f.auditor || zeroAddress }],
      isNew ? "Register agent" : "Update policy",
    );
    if (ok) onClose();
  };

  return (
    <Modal open={!!target} onClose={onClose} title={isNew ? "Register agent" : "Edit policy"}>
      <div className="space-y-4">
        <Field label="Agent address"><input className="input" value={f.agent} onChange={up("agent")} disabled={!isNew} placeholder="0x…" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Per-tx cap · USDC"><input className="input" value={f.per} onChange={up("per")} /></Field>
          <Field label="Daily cap · USDC"><input className="input" value={f.daily} onChange={up("daily")} /></Field>
          <Field label="Co-sign above · USDC"><input className="input" value={f.co} onChange={up("co")} /></Field>
          <Field label="Max tx / day"><input className="input" value={f.max} onChange={up("max")} /></Field>
        </div>
        <Field label="Expires in (days, 0 = never)"><input className="input" value={f.days} onChange={up("days")} /></Field>
        <Field label="Auditor address"><input className="input" value={f.auditor} onChange={up("auditor")} placeholder="0x…" /></Field>
        {err && <div className="cap text-bad">{err}</div>}
        <button className="btn w-full" disabled={!!err} onClick={save}>{isNew ? "Register" : "Save policy"}</button>
      </div>
    </Modal>
  );
}

function AllowlistModal({ agent, onClose }: { agent: AgentRow | null; onClose: () => void }) {
  const { vaultWrite } = useTx();
  const client = usePublicClient();
  const [payee, setPayee] = useState("");
  const valid = isAddress(payee);
  const allowed = useReadContract({
    address: VAULT, abi: falaVaultAbi, functionName: "payeeAllowed",
    args: agent && valid ? [agent.address, payee] : undefined,
    query: { enabled: !DEMO && !!agent && valid, refetchInterval: 3000 },
  });
  void client;
  return (
    <Modal open={!!agent} onClose={onClose} title="Payee allowlist">
      <p className="cap mb-5">Only allowlisted payees can ever receive this agent’s funds. Anything else is blocked and logged.</p>
      <Field label="Payee address"><input className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="0x…" /></Field>
      <div className="cap mt-3 h-5">{valid && !DEMO && allowed.data !== undefined && (allowed.data ? <span className="text-ok">Currently allowed</span> : "Not on the allowlist")}</div>
      <div className="mt-5 flex gap-3">
        <button className="btn flex-1" disabled={!valid} onClick={() => vaultWrite("setPayee", [agent!.address, payee, true], "Allow payee")}>Allow</button>
        <button className="btn-ghost btn flex-1" disabled={!valid} onClick={() => vaultWrite("setPayee", [agent!.address, payee, false], "Remove payee")}>Remove</button>
      </div>
    </Modal>
  );
}
