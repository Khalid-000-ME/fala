import { useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { DEMO, VAULT } from "../config/chain";
import { falaVaultAbi } from "../lib/abi";
import { bytesToHex, parseEmail, type ParsedEmail } from "../lib/dkim";
import { errorName } from "../lib/errors";
import { fmtUsdc, short } from "../lib/format";
import { refusalText } from "../lib/refusals";
import { Section } from "./ui";
import { useTx } from "../hooks/useTx";

type Verdict = { ok: true; verb: number; id: bigint; detail?: string } | { ok: false; name: string };
const VERB = ["", "APPROVE", "DENY", "FREEZE"];

export function Approve() {
  const client = usePublicClient();
  const { vaultWrite, toast } = useTx();
  const [raw, setRaw] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo<{ p?: ParsedEmail; err?: string }>(() => {
    if (!raw.trim()) return {};
    try { return { p: parseEmail(raw) }; } catch (e) { return { err: (e as Error).message }; }
  }, [raw]);

  const onFile = async (f?: File) => {
    if (!f) return;
    setRaw(new TextDecoder("latin1").decode(await f.arrayBuffer()));
    setVerdict(null);
  };

  const args = parsed.p ? ([bytesToHex(parsed.p.headerBlock), bytesToHex(parsed.p.sig)] as const) : undefined;

  const check = async () => {
    if (!args) return;
    if (DEMO || !client) return toast("Demo mode — set VITE_VAULT_ADDRESS to check against a vault", "info");
    setBusy(true);
    try {
      const [verb, id] = (await client.readContract({ address: VAULT!, abi: falaVaultAbi, functionName: "checkEmail", args: [...args] })) as [number, bigint];
      let detail: string | undefined;
      if (verb !== 3) {
        const i = await client.readContract({ address: VAULT!, abi: falaVaultAbi, functionName: "intents", args: [id] });
        detail = `${fmtUsdc(i[2])} USDC to ${short(i[1])} — “${i[7]}”`;
      }
      setVerdict({ ok: true, verb, id, detail });
    } catch (e) {
      setVerdict({ ok: false, name: errorName(e) });
    }
    setBusy(false);
  };

  return (
    <Section id="approve" title="Approve with an email file" sub="Backup path, and a way to try it yourself: paste or drop the .eml of your reply. Your browser rebuilds exactly what Google signed and the vault checks it — nothing about you is trusted but Google’s signature.">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="cap">Raw email (.eml)</span>
            <label className="link-accent cursor-pointer">Choose file [ + ]<input type="file" accept=".eml,message/rfc822,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
          </div>
          <textarea
            className="input mt-3 h-56 resize-y whitespace-pre text-[12px]"
            placeholder={"Paste the full original message here, headers included.\nGmail → ⋮ → Show original → Download original."}
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setVerdict(null); }}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            spellCheck={false}
          />
        </div>
        <div className="card flex flex-col gap-3">
          <div className="cap">What Fala read</div>
          {parsed.err && <div className="font-mono text-[13px] text-bad">{parsed.err}</div>}
          {!parsed.p && !parsed.err && <div className="cap">Nothing yet.</div>}
          {parsed.p && (
            <dl className="space-y-2 font-mono text-[13px]">
              {[["From", parsed.p.from], ["Subject", parsed.p.subject], ["Signed by", `d=${parsed.p.d}  s=${parsed.p.s}`], ["Signed at", parsed.p.t ? new Date(parsed.p.t * 1000).toISOString() : "no t= tag"], ["Block", `${parsed.p.headerBlock.length} bytes · sig ${parsed.p.sig.length} bytes`]].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[5.5rem_1fr] gap-2"><dt className="text-mute">{k}</dt><dd className="break-all">{v}</dd></div>
              ))}
            </dl>
          )}
          <div className="mt-auto flex flex-wrap gap-3 pt-3">
            <button className="btn btn-sm" disabled={!args || busy} onClick={check}>Check onchain (free)</button>
            <button className="btn-ghost btn btn-sm bg-white" disabled={!args || DEMO || !(verdict && verdict.ok)} onClick={() => args && vaultWrite("approveByEmail", [...args], "Submit approval")}>Submit onchain</button>
          </div>
          {verdict && (
            <div className={`rounded-2xl px-4 py-3 text-[14px] ${verdict.ok ? "bg-[#e8f6ee] text-ok" : "bg-[#fde8e6] text-bad"}`}>
              {verdict.ok ? (
                <>✓ The vault would accept this: <b className="font-medium">{VERB[verdict.verb]}</b>{verdict.verb !== 3 && <> request #{String(verdict.id)}</>}{verdict.detail && <div className="cap mt-1 !text-ok">{verdict.detail}</div>}</>
              ) : (
                <><b className="font-mono font-medium">{verdict.name}</b><div className="mt-1 text-[13px] opacity-90">{refusalText(verdict.name)}</div></>
              )}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
