"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi, type VaultDto } from "../lib/api";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { useOwnerWallet } from "../lib/owner";
import { short } from "../lib/format";
import { Empty, Field, Modal, Section, Stat } from "../components/ui";
import { AppShell } from "../components/AppShell";
import { Usdc } from "../components/Icons";
import { LogoLoader } from "../components/LogoLoader";
import { useTx } from "../hooks/useTx";

export default function Dashboard() {
  const api = useApi();
  const router = useRouter();
  const { toast } = useTx();
  const [vaults, setVaults] = useState<VaultDto[] | null>(null);
  const [open, setOpen] = useState(false);

  const { address } = useOwnerWallet();
  const wallet = useWalletBalance();

  const load = () => api<VaultDto[]>("/api/vaults").then(setVaults).catch((e) => toast(e.message, "bad"));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); /* eslint-disable-next-line */ }, []);

  return (
    <AppShell>
      <Section
        id="vaults"
        title="Vaults"
        aside={<button className="btn" onClick={() => setOpen(true)}>New vault</button>}
      >
        <div className="mb-4"><Stat label={`Wallet ${short(address)}`} value={<Usdc value={wallet ?? "…"} size={22} />} /></div>
        {vaults === null ? <LogoLoader /> : vaults.length === 0 ? (
          <div className="card flex flex-col items-start gap-4 py-12">
            <div className="text-[28px] tracking-tightest">Create your first vault</div>
            <button className="btn" onClick={() => setOpen(true)}>New vault</button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {vaults.map((v) => {
              const pct = Number(v.minBalance) > 0 ? Math.min(100, (Number(v.balance) / Number(v.minBalance)) * 100) : 100;
              return (
                <Link key={v.id} href={`/vaults/${v.id}`} className="card block transition hover:bg-line/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[26px] tracking-tightest">{v.name}</div>
                    {v.frozen ? <span className="tag rounded-full bg-[#0b2a5b] px-3 py-1 text-white">frozen</span> : v.belowMin ? <span className="tag rounded-full bg-bad/15 px-3 py-1 text-bad">needs funds</span> : <span className="tag rounded-full bg-canvas px-3 py-1 text-ok">healthy</span>}
                  </div>
                  <div className="mt-5 text-[40px] leading-none tracking-tightest"><Usdc value={v.balance} size={22} /></div>
                  {Number(v.minBalance) > 0 && (
                    <>
                      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-canvas"><div className={`h-full rounded-full ${v.belowMin ? "bg-bad" : "bg-ok"}`} style={{ width: `${pct}%` }} /></div>
                      <div className="cap mt-2">{v.belowMin ? `Top up ${v.shortfall} USDC` : `Minimum ${v.minBalance} USDC`}</div>
                    </>
                  )}
                  <div className="cap mt-4">{v.agentCount} agent{v.agentCount === 1 ? "" : "s"}</div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
      <NewVault open={open} onClose={() => setOpen(false)} onDone={(id) => router.push(`/vaults/${id}`)} />
    </AppShell>
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
        <Field label="Minimum balance (USDC)"><input className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <p className="cap">Use a dedicated Gmail. Its headers are public onchain.</p>
        {err && <div className="cap text-bad">{err}</div>}
        <button className="btn w-full" disabled={!!err || busy} onClick={create}>{busy ? "Deploying your vault on Arc… (about 10 seconds)" : "Create vault"}</button>
      </div>
    </Modal>
  );
}
