import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { DEMO, VAULT } from "../config/chain";
import { falaVaultAbi } from "../lib/abi";
import { errorName } from "../lib/errors";
import { refusalText } from "../lib/refusals";
import { Empty, Section } from "./ui";

type Case = { id: string; title: string; what: string; expected: string; headerBlock: `0x${string}`; sig: `0x${string}` };
type CaseFile = { vault: string; chainId: number; generatedAt: string; cases: Case[] };
type Result = { state: "run" | "done"; got?: string };

const META: Pick<Case, "id" | "title" | "what" | "expected">[] = [
  { id: "valid", title: "A real approval", what: "A correctly signed reply from the approver for a pending request.", expected: "OK" },
  { id: "tampered", title: "Edited after Google signed it", what: "One byte of the signed headers is changed.", expected: "BadSignature" },
  { id: "swapped-code", title: "Code from a different request", what: "Signed by Google, but the subject carries another request’s code.", expected: "CodeMismatch" },
  { id: "other-sender", title: "Another Gmail account", what: "A genuine Gmail signature — from someone who isn’t the approver.", expected: "FromNotApprover" },
  { id: "replay", title: "Replaying an approval", what: "The exact email that already paid out, submitted again.", expected: "IntentNotPending" },
  { id: "injected-subject", title: "From: hidden inside the subject", what: "The subject tries to smuggle in a second From line.", expected: "SubjectMalformed" },
  { id: "two-from", title: "Two From headers", what: "A second From header is added to confuse the parser.", expected: "DuplicateHeader" },
  { id: "weak-algorithm", title: "Downgraded algorithm", what: "The signature claims rsa-sha1 instead of rsa-sha256.", expected: "WrongAlgorithm" },
  { id: "subject-unsigned", title: "Subject not covered", what: "The signature doesn’t cover the Subject header, so it could be swapped.", expected: "HeaderNotSigned" },
  { id: "unknown-key", title: "A key the vault doesn’t trust", what: "Signed with a selector that isn’t in the key registry.", expected: "UnknownKey" },
  { id: "stale", title: "Signed before the request existed", what: "An email dated before the payment was even asked for.", expected: "StaleTimestamp" },
];

export function Forge() {
  const client = usePublicClient();
  const [file, setFile] = useState<CaseFile | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});

  useEffect(() => {
    fetch("/forge/cases.json").then((r) => (r.ok ? r.json() : null)).then(setFile).catch(() => setFile(null));
  }, []);

  const live = !DEMO && !!client && !!file && file.vault.toLowerCase() === VAULT?.toLowerCase();
  const cases: (Pick<Case, "id" | "title" | "what" | "expected"> & Partial<Case>)[] = file?.cases?.length ? file.cases : META;

  const run = async (c: Partial<Case> & { id: string }) => {
    if (!live || !c.headerBlock) return;
    setResults((r) => ({ ...r, [c.id]: { state: "run" } }));
    try {
      await client!.readContract({ address: VAULT!, abi: falaVaultAbi, functionName: "checkEmail", args: [c.headerBlock, c.sig!] });
      setResults((r) => ({ ...r, [c.id]: { state: "done", got: "OK" } }));
    } catch (e) {
      setResults((r) => ({ ...r, [c.id]: { state: "done", got: errorName(e) } }));
    }
  };
  const runAll = async () => { for (const c of cases) await run(c as Case); };
  const done = cases.filter((c) => results[c.id]?.state === "done");
  const asExpected = done.filter((c) => results[c.id].got === c.expected).length;

  return (
    <Section
      id="forge"
      title="Try to forge an approval"
      sub="Each card is an email an attacker might try. The vault runs its real checks as a free eth_call and names exactly why it refused. The agent can write any email it likes — it can’t make Google sign one from you."
      aside={<button className="btn" disabled={!live} onClick={runAll}>Run all {cases.length}</button>}
    >
      {!live && <div className="cap mb-5">{DEMO ? "Demo mode — connect the dashboard to a vault to run these live." : file ? "These cases were generated for a different vault address." : "No cases file for this vault yet (public/forge/cases.json)."}</div>}
      {done.length > 0 && <div className="mb-5 font-mono text-[13px]">{asExpected} of {done.length} behaved exactly as expected.</div>}
      {!cases.length ? <Empty>No cases.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cases.map((c, i) => {
            const r = results[c.id];
            const ok = r?.state === "done" && r.got === c.expected;
            return (
              <div key={c.id} className={`card flex flex-col ${r?.state === "done" ? (ok ? "ring-1 ring-ok/40" : "ring-1 ring-bad/50") : ""}`}>
                <div className="cap">{String(i + 1).padStart(2, "0")} · expect {c.expected}</div>
                <div className="mt-2 text-[22px] leading-tight tracking-tightest">{c.title}</div>
                <p className="cap mt-2 flex-1">{c.what}</p>
                {r?.state === "done" && (
                  <div className={`mt-4 rounded-2xl px-4 py-3 text-[13px] ${r.got === "OK" ? "bg-[#e8f6ee] text-ok" : ok ? "bg-white" : "bg-[#fde8e6] text-bad"}`}>
                    <b className="font-mono font-medium">{r.got === "OK" ? "Accepted ✓" : `Refused: ${r.got}`}</b>
                    {r.got !== "OK" && <div className="mt-1 opacity-80">{refusalText(r.got!)}</div>}
                  </div>
                )}
                <button className="btn-ghost btn btn-sm mt-4 w-fit bg-white" disabled={!live || r?.state === "run"} onClick={() => run(c as Case)}>{r?.state === "run" ? "Checking…" : "Run it"}</button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
