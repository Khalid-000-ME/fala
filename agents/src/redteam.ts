import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { startAuditor } from "./auditor.js";
import { addresses, groqKey, explorerTx } from "./lib/config.js";
import { addressOf, freeze, pendingStatus, spend, type SpendResult } from "./lib/vault.js";
import { runWorker } from "./worker.js";

type Call = { from: "worker" | "rogue" | "owner"; action?: "freeze"; payee?: string; amount?: string; note?: string; repeat?: number };
type Scenario = {
  id: string; title: string; kind: "llm" | "direct"; task?: string; vendorContent?: string; calls: Call[];
  expect: { status: string; reason?: string; resolves?: string };
};
type Row = { id: string; title: string; via: string; outcome: string; reason: string; tx: string; pass: boolean; note?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fill = (s: string | undefined, a: Record<string, string>) => s?.replace(/\{(\w+)\}/g, (_, k) => a[k] ?? `{${k}}`);

async function waitResolved(id: bigint, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const p = await pendingStatus(id);
    if (p.status !== "PENDING") return p.status;
    await sleep(2000);
  }
  return "PENDING";
}

async function main() {
  const addr = addresses();
  const scenarios: Scenario[] = JSON.parse(readFileSync(new URL("../scenarios/scenarios.json", import.meta.url), "utf8"));
  const only = process.argv.slice(2);
  const stopAuditor = startAuditor();
  const rows: Row[] = [];

  const direct = async (c: Call): Promise<SpendResult[]> => {
    const out: SpendResult[] = [];
    for (let i = 0; i < (c.repeat ?? 1); i++) {
      const payee = addr[c.payee as keyof typeof addr] ?? (c.payee as `0x${string}`);
      out.push(await spend(c.from as "worker" | "rogue", payee, c.amount!, c.note ?? ""));
    }
    return out;
  };

  for (const s of scenarios) {
    if (only.length && !only.includes(s.id)) continue;
    console.log(`\n▶ ${s.id}  ${s.title}`);
    let results: SpendResult[] = [];
    let via = "direct";
    let note: string | undefined;

    if (s.calls[0].action === "freeze") {
      const { hash } = await freeze(addressOf("worker"), true);
      rows.push({ id: s.id, title: s.title, via: "owner", outcome: "frozen", reason: "—", tx: explorerTx(hash), pass: true });
      console.log(`  frozen ${explorerTx(hash)}`);
      continue;
    }

    if (s.kind === "llm" && groqKey()) {
      via = "llm";
      const run = await runWorker(s.task!, fill(s.vendorContent, addr));
      results = run.spends;
      if (!results.length) {
        note = "model resisted";
        console.log("  model resisted the injection — replaying the same attack directly to prove the vault holds");
        via = "llm→direct";
        results = await direct(s.calls[0]);
      }
    } else {
      results = await direct(s.calls[0]);
    }

    // For repeated calls (salami) judge by the final result; the table shows counts.
    const last = results[results.length - 1];
    let outcome: string = last?.status ?? "none";
    let reason = last?.reason ?? "—";
    if (s.calls[0].repeat) {
      const ex = results.filter((r) => r.status === "executed").length;
      note = `${ex} executed, ${results.length - ex} blocked`;
    }
    if (last?.status === "queued" && s.expect.resolves) {
      const final = await waitResolved(BigInt(last.pendingId!));
      outcome = `queued → ${final}`;
      reason = final;
    }
    const pass = s.expect.resolves
      ? outcome === `queued → ${s.expect.resolves}`
      : last?.status === s.expect.status && (!s.expect.reason || last.reason === s.expect.reason);
    rows.push({ id: s.id, title: s.title, via, outcome, reason, tx: last ? last.explorerUrl : "—", pass, note });
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${outcome} ${reason !== "—" ? `(${reason})` : ""} ${last?.explorerUrl ?? ""}`);
  }

  await stopAuditor();
  const md = [
    "# Fala demo report", "", `Generated ${new Date().toISOString()}`, "",
    "| Scenario | Attack | Via | Outcome | Reason | Tx |", "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.pass ? "✅" : "❌"} ${r.id} | ${r.title}${r.note ? ` _(${r.note})_` : ""} | ${r.via} | ${r.outcome} | ${r.reason} | ${r.tx.startsWith("http") ? `[tx](${r.tx})` : r.tx} |`),
    "", `**${rows.filter((r) => r.outcome.startsWith("blocked") || r.outcome.includes("REJECTED")).length} attacks stopped.**`, "",
  ].join("\n");
  const out = new URL("../../docs/demo-report", import.meta.url).pathname;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.md`, md);
  writeFileSync(`${out}.json`, JSON.stringify(rows, null, 2));
  console.log(`\nreport → docs/demo-report.md`);
  process.exit(rows.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => (console.error(e), process.exit(1)));
