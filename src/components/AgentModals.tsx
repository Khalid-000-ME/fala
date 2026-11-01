"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useApi, type AgentDto, type AgentKind, type KeyDto, type VaultDto } from "../lib/api";
import { useOwnerWallet } from "../lib/owner";
import { parseUsdc } from "../lib/format";
import { Field, Modal } from "./ui";
import { useTx } from "../hooks/useTx";

const PROVIDERS = [["claude", "Claude (Code / Desktop)"], ["chatgpt", "ChatGPT / OpenAI"], ["cursor", "Cursor"], ["custom", "Other (MCP or HTTP)"]] as const;
const KINDS: { kind: AgentKind; title: string; blurb: string }[] = [
  { kind: "managed", title: "Fala agent", blurb: "Our built-in procurement agent. Give it a task and it spends within your limits." },
  { kind: "connected", title: "Connect Claude or another provider", blurb: "We create a wallet and an API key. Plug it into Claude, Cursor or anything with MCP or HTTP." },
  { kind: "byo", title: "My own agent", blurb: "You already run an agent with its own key. Register its address and set its limits." },
];

type Limits = { per: string; daily: string; cap: string };
export const LimitFields = ({ f, set }: { f: Limits; set: (l: Limits) => void }) => (
  <div className="grid grid-cols-3 gap-4">
    <Field label="Auto / tx"><input className="input" value={f.per} onChange={(e) => set({ ...f, per: e.target.value })} /></Field>
    <Field label="Auto / day"><input className="input" value={f.daily} onChange={(e) => set({ ...f, daily: e.target.value })} /></Field>
    <Field label="Hard cap"><input className="input" value={f.cap} onChange={(e) => set({ ...f, cap: e.target.value })} /></Field>
  </div>
);
const limitErr = (f: Limits) => (parseUsdc(f.per) > parseUsdc(f.cap) ? "Auto per-tx can't exceed the hard cap" : null);

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
      <div className="space-y-4">
        <div className="grid gap-2">
          {KINDS.map((k) => (
            <button key={k.kind} onClick={() => setKind(k.kind)} className={`rounded-2xl border px-4 py-3 text-left transition ${kind === k.kind ? "border-ink bg-card" : "border-line hover:bg-card/60"}`}>
              <div className="text-[17px]">{k.title}</div>
              <div className="cap mt-0.5">{k.blurb}</div>
            </button>
          ))}
        </div>
        <Field label="Agent name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Research assistant" /></Field>
        {kind === "connected" && (
          <Field label="Provider">
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
        )}
        {kind === "byo" && <Field label="Agent address"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" /></Field>}
        <LimitFields f={lim} set={setLim} />
        <p className="cap">Auto = paid instantly to known payees. Above it, you approve by email. The hard cap is a ceiling even an email can't lift.</p>
        {err && <div className="cap text-bad">{err}</div>}
        <button className="btn w-full" disabled={!!err || !!busy} onClick={create}>{busy || "Create and activate"}</button>
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
      <pre className="overflow-x-auto rounded-2xl bg-ink p-4 pr-16 font-mono text-[12px] leading-relaxed text-white/90">{children}</pre>
      <button className="absolute right-3 top-3 font-mono text-[11px] text-white/60 hover:text-white" onClick={() => navigator.clipboard?.writeText(children).then(() => toast("Copied", "ok"))}>[ copy ]</button>
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
          <div className="rounded-2xl bg-[#fff4de] px-4 py-3 text-[13px] text-warn">Copy it now. It is shown only once.</div>
          <Code>{k.key}</Code>
          <div className="flex gap-2">
            {(["claude", "cursor", "http"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`tag rounded-full px-4 py-1.5 ${tab === t ? "bg-ink text-white" : "bg-card text-mute"}`}>{t === "claude" ? "Claude" : t === "cursor" ? "Cursor" : "HTTP"}</button>
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
