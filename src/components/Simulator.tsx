import { useState } from "react";
import { usePublicClient } from "wagmi";
import { isAddress } from "viem";
import { DEMO, VAULT } from "../config/chain";
import { falaVaultAbi } from "../lib/abi";
import { parseUsdc } from "../lib/format";
import { reasonLabel } from "../lib/reasons";
import { VENDOR_A, VENDOR_B } from "../lib/demo";
import type { AgentRow } from "../lib/types";
import { Field, Section } from "./ui";

export function Simulator({ agents }: { agents: AgentRow[] }) {
  const client = usePublicClient();
  const [agent, setAgent] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("0.50");
  const [note, setNote] = useState("");
  const [out, setOut] = useState<{ text: string; tone: string } | null>(null);
  const selected = agent || agents[0]?.address || "";

  const run = async () => {
    if (!isAddress(selected) || !isAddress(payee)) return setOut({ text: "Enter valid addresses", tone: "text-bad" });
    const amt = parseUsdc(amount);
    let reason = 0;
    if (DEMO) {
      const p = agents[0].policy;
      reason = ![VENDOR_A, VENDOR_B].map((x) => x.toLowerCase()).includes(payee.toLowerCase()) ? 7 : amt > p.perTxCap ? 8 : amt === 0n ? 5 : 0;
    } else {
      reason = Number(await client!.readContract({ address: VAULT!, abi: falaVaultAbi, functionName: "check", args: [selected, payee, amt, note] }));
    }
    if (reason) return setOut({ text: `Would be blocked — ${reasonLabel(reason)}`, tone: "text-bad" });
    const p = agents.find((a) => a.address === selected)?.policy ?? agents[0].policy;
    setOut(amt > p.coSignThreshold ? { text: "Would be queued for auditor approval", tone: "text-warn" } : { text: "Would execute immediately", tone: "text-ok" });
  };

  return (
    <Section id="simulate" title="Simulate a spend" sub="Dry-run the vault’s own check() against any payee and amount. Nothing is sent onchain.">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <div className="card space-y-4">
          <Field label="Agent">
            <select className="input" value={selected} onChange={(e) => setAgent(e.target.value)}>
              {agents.map((a) => <option key={a.address} value={a.address}>{a.address}</option>)}
            </select>
          </Field>
          <Field label="Payee"><input className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="0x…" /></Field>
          <div className="grid grid-cols-[8rem_1fr] gap-4">
            <Field label="Amount · USDC"><input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="what is this payment for?" /></Field>
          </div>
          <button className="btn" onClick={run} disabled={!agents.length}>Run check</button>
        </div>
        <div className="card flex flex-col justify-between">
          <div className="cap">[ verdict ]</div>
          <div className={`text-[30px] leading-tight tracking-tightest ${out?.tone ?? "text-mute"}`}>{out?.text ?? "Run a check to see what the vault would do."}</div>
        </div>
      </div>
    </Section>
  );
}
