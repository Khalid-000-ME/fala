"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useApi, type AgentDto, type AgentKind, type KeyDto, type VaultDto } from "../lib/api";
import { useOwnerWallet } from "../lib/owner";
import { parseUsdc } from "../lib/format";
import { AgentKindIcon, ProviderIcon } from "./Icons";
import { Field, Modal } from "./ui";
import { useTx } from "../hooks/useTx";

const PROVIDERS = [["claude", "Claude"], ["chatgpt", "ChatGPT"], ["cursor", "Cursor"], ["custom", "Other"]] as const;
const KINDS: { kind: AgentKind; title: string; blurb: string }[] = [
  { kind: "connected", title: "Connect", blurb: "Use Claude, ChatGPT or Cursor" },
  { kind: "managed", title: "Fala agent", blurb: "Give it tasks here" },
  { kind: "byo", title: "My own", blurb: "Bring your own key" },
];

type Limits = { per: string; daily: string; cap: string };
const LIMITS: { key: keyof Limits; label: string; hint: string }[] = [
  { key: "per", label: "Per payment", hint: "Paid without asking" },
  { key: "daily", label: "Per day", hint: "Paid without asking" },
  { key: "cap", label: "Largest request", hint: "Even you can't approve more" },
];
export const LimitFields = ({ f, set }: { f: Limits; set: (l: Limits) => void }) => (
  <div className="space-y-2">
    {LIMITS.map((l) => (
      <label key={l.key} className="flex items-center justify-between gap-4">
        <span><span className="block text-[14.5px]">{l.label}</span><span className="cap">{l.hint}</span></span>
        <span className="relative w-36 shrink-0">
          <input className="input !py-2.5 !pr-16 text-right" inputMode="decimal" value={f[l.key]} onChange={(e) => set({ ...f, [l.key]: e.target.value })} />
          <span className="cap pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">USDC</span>
        </span>
      </label>
    ))}
  </div>
);
const limitErr = (f: Limits) => (parseUsdc(f.per) > parseUsdc(f.cap) ? "Per payment can't be above the largest request" : null);

/** Create the agent record (and wallet), then the owner's wallet activates it onchain with the chosen limits. */
export function AddAgent({ vault, open, onClose, onDone }: { vault: VaultDto; open: boolean; onClose: () => void; onDone: (a: { id: string; kind: AgentKind }) => void }) {
  const api = useApi();
  const owner = useOwnerWallet();
  const { toast } = useTx();
  const [kind, setKind] = useState<AgentKind>("connected");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string>("claude");
  const [address, setAddress] = useState("");
  const [lim, setLim] = useState<Limits>({ per: "0.20", daily: "1", cap: "5" });
  const [busy, setBusy] = useState("");

  const err = !name.trim() ? "Give the agent a name" : kind === "byo" && !isAddress(address) ? "Enter the agent's address" : limitErr(lim);
  const create = async () => {
    setBusy("Creating the agent…");
    try {
      const body = kind === "managed" ? { kind, name } : kind === "connected" ? { kind, name, provider } : { kind, name, address };
      const a = await api<{ id: string; address: `0x${string}` }>(`/api/vaults/${vault.id}/agents`, { body });
      setBusy("Approve in your wallet to activate it…");
      const ok = await owner.write(vault.address, "setAgent", [a.address, parseUsdc(lim.per), parseUsdc(lim.daily), parseUsdc(lim.cap), true], "Activate agent");
      if (!ok) { toast("Agent created but not active yet. Use Activate on it.", "info"); }
      onClose();
      onDone({ id: a.id, kind });
    } catch (e: any) { toast(e.message, "bad"); }
    setBusy("");
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Add an agent">
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2">
          {KINDS.map((k) => (
            <button key={k.kind} onClick={() => setKind(k.kind)} className={`rounded-xl border p-3 text-left transition ${kind === k.kind ? "border-accent bg-accent/10" : "border-line hover:border-mute/50"}`}>
              <AgentKindIcon kind={k.kind} size={20} />
              <div className="mt-2 text-[14.5px]">{k.title}</div>
              <div className="cap mt-0.5">{k.blurb}</div>
            </button>
          ))}
        </div>
        {kind === "connected" && (
          <div className="grid grid-cols-4 gap-2">
            {PROVIDERS.map(([p, l]) => (
              <button key={p} onClick={() => setProvider(p)} className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-[13px] transition ${provider === p ? "border-accent bg-accent/10" : "border-line hover:border-mute/50"}`}><ProviderIcon provider={p} size={15} />{l}</button>
            ))}
          </div>
        )}
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shopper" /></Field>
        {kind === "byo" && <Field label="Agent address"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" /></Field>}
        <div>
          <div className="label">Spending limits</div>
          <LimitFields f={lim} set={setLim} />
          <p className="cap mt-3">Automatic payments only go to saved payees. Anything else needs your approval by email.</p>
        </div>
        {limitErr(lim) && <div className="cap text-bad">{limitErr(lim)}</div>}
        <button className="btn w-full" disabled={!!err || !!busy} onClick={create}>{busy || "Create agent"}</button>
        <p className="cap text-center">Your wallet signs once to activate it.</p>
      </div>
    </Modal>
  );
}

export function EditLimits({ vault, agent, onClose, onDone }: { vault: VaultDto; agent: AgentDto | null; onClose: () => void; onDone: () => void }) {
  const owner = useOwnerWallet();
  const [lim, setLim] = useState<Limits | null>(null);
  const cur: Limits = { per: agent?.autoPerTx && agent.autoPerTx !== "0" ? agent.autoPerTx : "0.20", daily: agent?.autoDaily && agent.autoDaily !== "0" ? agent.autoDaily : "1", cap: agent?.hardCap && agent.hardCap !== "0" ? agent.hardCap : "5" };
  const f = lim ?? cur;
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!agent} onClose={onClose} title={agent?.registered ? "Edit limits" : "Activate agent"}>
      <div className="space-y-4">
        <LimitFields f={f} set={setLim} />
        {limitErr(f) && <div className="cap text-bad">{limitErr(f)}</div>}
        <button className="btn w-full" disabled={busy || !!limitErr(f)} onClick={async () => {
          setBusy(true);
          if (await owner.write(vault.address, "setAgent", [agent!.address, parseUsdc(f.per), parseUsdc(f.daily), parseUsdc(f.cap), true], "Save limits")) { setLim(null); onDone(); onClose(); }
          setBusy(false);
        }}>{busy ? "Waiting for your wallet…" : "Save in my wallet"}</button>
      </div>
    </Modal>
  );
}

const Code = ({ children }: { children: string }) => {
  const { toast } = useTx();
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-2xl border border-line bg-canvas p-4 pr-16 font-mono text-[12px] leading-relaxed text-ink/90">{children}</pre>
      <button className="absolute right-3 top-3 text-[11px] text-mute hover:text-ink" onClick={() => navigator.clipboard?.writeText(children).then(() => toast("Copied", "ok"))}>[ copy ]</button>
    </div>
  );
};

/** Issue an API key and show copy-paste setup for Claude, Cursor and plain HTTP. The key is shown only once. */
export function ConnectAgent({ agent, onClose, onDone }: { agent: AgentDto | null; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const { toast } = useTx();
  const [k, setK] = useState<KeyDto | null>(null);
  const [tab, setTab] = useState<"claude" | "cursor" | "http">("claude");
  const [busy, setBusy] = useState(false);
  const close = () => { setK(null); onClose(); };
  const make = async () => {
    setBusy(true);
    try { setK(await api<KeyDto>(`/api/agents/${agent!.id}/keys`, { body: { label: agent!.provider ?? "agent" } })); onDone(); } catch (e: any) { toast(e.message, "bad"); }
    setBusy(false);
  };
  const desktop = k && JSON.stringify({ mcpServers: { fala: { command: "npx", args: ["-y", "mcp-remote", k.mcp.url, "--header", k.mcp.header] } } }, null, 2);
  const cursor = k && JSON.stringify({ mcpServers: { fala: { url: k.mcp.url, headers: { Authorization: k.mcp.header.replace("Authorization: ", "") } } } }, null, 2);
  const curl = k && `curl -X POST ${k.rest.base}/payments \\\n  -H "${k.rest.header}" -H "content-type: application/json" \\\n  -d '{"payee":"0x…","amount_usdc":"0.10","memo":"dataset"}'`;
  return (
    <Modal open={!!agent} onClose={close} title={`Connect ${agent?.name ?? ""}`}>
      {!k ? (
        <div className="space-y-4">
          <p className="cap">Lets Claude, Cursor or any HTTP client spend as this agent, within its limits. Revoke it any time.</p>
          <button className="btn w-full" disabled={busy} onClick={make}>{busy ? "Creating…" : "Create API key"}</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-warn/15 px-4 py-3 text-[13px] text-warn">Copy it now. It is shown only once.</div>
          <Code>{k.key}</Code>
          <div className="flex gap-2">
            {(["claude", "cursor", "http"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`tag rounded-xl px-4 py-1.5 ${tab === t ? "bg-ink text-canvas" : "bg-card text-mute"}`}>{t === "claude" ? "Claude" : t === "cursor" ? "Cursor" : "HTTP"}</button>
            ))}
          </div>
          {tab === "claude" && <><div className="cap">Claude Code</div><Code>{k.claudeCode}</Code><div className="cap">Claude Desktop (claude_desktop_config.json)</div><Code>{desktop!}</Code></>}
          {tab === "cursor" && <><div className="cap">Cursor (~/.cursor/mcp.json)</div><Code>{cursor!}</Code></>}
          {tab === "http" && <><div className="cap">REST: GET /allowance, POST /payments, GET /payments/:id</div><Code>{curl!}</Code></>}
          <p className="cap">Tools your agent gets: get_allowance, request_payment, payment_status.</p>
        </div>
      )}
    </Modal>
  );
}
