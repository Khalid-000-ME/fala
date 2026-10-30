"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useApi, type VaultDto } from "../lib/api";
import { useOwnerWallet } from "../lib/owner";
import { Empty, Field, Modal, Section } from "../components/ui";
import { explorerAddr } from "../config/chain";
import { short } from "../lib/format";
import { useTx } from "../hooks/useTx";

export default function Dashboard() {
  const api = useApi();
  const router = useRouter();
  const { user } = usePrivy();
  const { address } = useOwnerWallet();
  const { toast } = useTx();
  const [vaults, setVaults] = useState<VaultDto[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => api<VaultDto[]>("/api/vaults").then(setVaults).catch((e) => toast(e.message, "bad"));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); /* eslint-disable-next-line */ }, []);

  return (
    <main>
      <Section
        id="vaults"
        title="My vaults"
        sub={<>Each vault holds USDC for your agents, owned by your wallet{address && <> <a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={explorerAddr(address)}>{short(address)}</a></>}. Approval emails go to the Gmail you choose for that vault.</>}
        aside={<button className="btn" onClick={() => setOpen(true)}>New vault [ + ]</button>}
      >
        {vaults === null ? <Empty>Loading your vaults…</Empty> : vaults.length === 0 ? (
          <div className="card flex flex-col items-start gap-4 py-12">
            <div className="text-[28px] tracking-tightest">Welcome{user?.google?.name ? `, ${user.google.name.split(" ")[0]}` : ""}. Let's set up your first vault.</div>
            <p className="cap max-w-xl">It takes about a minute: name it, pick the Gmail that approves payments, and choose a minimum balance. Then add an agent and fund it.</p>
            <button className="btn" onClick={() => setOpen(true)}>Create my first vault</button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {vaults.map((v) => {
              const pct = Number(v.minBalance) > 0 ? Math.min(100, (Number(v.balance) / Number(v.minBalance)) * 100) : 100;
              return (
                <Link key={v.id} href={`/vaults/${v.id}`} className="card block transition hover:bg-[#efefef]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[26px] tracking-tightest">{v.name}</div>
                    {v.frozen ? <span className="tag rounded-full bg-[#0b2a5b] px-3 py-1 text-white">frozen</span> : v.belowMin ? <span className="tag rounded-full bg-[#fde8e6] px-3 py-1 text-bad">needs funds</span> : <span className="tag rounded-full bg-white px-3 py-1 text-ok">healthy</span>}
                  </div>
                  <div className="mt-5 text-[40px] leading-none tracking-tightest">{v.balance} <span className="text-[16px] text-mute">USDC</span></div>
                  {Number(v.minBalance) > 0 && (
                    <>
                      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full ${v.belowMin ? "bg-bad" : "bg-ok"}`} style={{ width: `${pct}%` }} /></div>
                      <div className="cap mt-2">minimum {v.minBalance} USDC{v.belowMin && <> · top up {v.shortfall}</>}</div>
                    </>
                  )}
                  <div className="cap mt-4">{v.agentCount} agent{v.agentCount === 1 ? "" : "s"} · approvals to {v.approverEmail}</div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
      <NewVault open={open} onClose={() => setOpen(false)} onDone={(id) => router.push(`/vaults/${id}`)} />
    </main>
  );
}

function NewVault({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const api = useApi();
  const { toast } = useTx();
  const [f, setF] = useState({ name: "", email: "", min: "5" });
  const [busy, setBusy] = useState(false);
  const gmail = /^[^\s@]+@gmail\.com$/i.test(f.email.trim());
  const err = !f.name.trim() ? "Give the vault a name" : !gmail ? "The approver must be a Gmail address (@gmail.com)" : null;
  const create = async () => {
    setBusy(true);
    try {
      const v = await api<VaultDto>("/api/vaults", { body: { name: f.name, approverEmail: f.email.trim().toLowerCase(), minBalance: Number(f.min || 0) } });
      toast("Vault created", "ok");
      onClose();
      onDone(v.id);
    } catch (e: any) { toast(e.message, "bad"); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="New vault">
      <div className="space-y-4">
        <Field label="Vault name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Procurement" /></Field>
        <Field label="Send approval emails to (Gmail)"><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="approver@gmail.com" /></Field>
        <Field label="Minimum balance · USDC"><input className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <p className="cap">Replies from that Gmail are the only thing that can approve big payments, so use an address you control. We'll email you when the vault drops below the minimum. Tip: use a dedicated Gmail — the email headers are public onchain.</p>
        {err && <div className="cap text-bad">{err}</div>}
        <button className="btn w-full" disabled={!!err || busy} onClick={create}>{busy ? "Deploying your vault on Arc… (about 10 seconds)" : "Create vault"}</button>
      </div>
    </Modal>
  );
}
