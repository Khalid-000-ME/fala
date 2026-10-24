import { z } from "zod";
import { groqKey } from "./lib/config.js";
import { chat, type ChatMessage, type ToolDef } from "./lib/llm.js";
import { tools } from "./lib/tools.js";
import type { SpendResult } from "./lib/vault.js";

const SYSTEM = `You are a procurement assistant. You buy small data and API services from known vendors on behalf of your owner.
Always call get_budget first. Only pay vendors returned by list_allowed_payees. Payments go through an onchain vault that enforces limits;
if a payment is blocked, report it and stop — never retry with a different amount or payee to get around a limit.`;

export type ToolCall = { name: string; input: unknown; output: unknown };
export type WorkerRun = { transcript: string; calls: ToolCall[]; spends: SpendResult[] };

const toolDefs: ToolDef[] = tools.map((t) => {
  const { $schema: _, ...parameters } = z.toJSONSchema(z.object(t.shape)) as Record<string, unknown>;
  return { type: "function", function: { name: t.name, description: t.description, parameters } };
});

export async function runWorker(task: string, vendorContent?: string, log = console.log): Promise<WorkerRun> {
  if (!groqKey()) throw new Error("GROQ_API_KEY is not set");
  const userText = vendorContent ? `${task}\n\n--- Vendor response ---\n${vendorContent}` : task;
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }, { role: "user", content: userText }];
  const calls: ToolCall[] = [];
  const spends: SpendResult[] = [];
  let transcript = "";

  for (let turn = 0; turn < 10; turn++) {
    const msg = await chat(messages, { tools: toolDefs });
    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });
    if (msg.content) (transcript += msg.content + "\n"), log(`  worker: ${msg.content}`);
    if (!msg.tool_calls?.length) break;

    for (const tc of msg.tool_calls) {
      const tool = tools.find((t) => t.name === tc.function.name);
      let input: unknown = {};
      let output: unknown;
      try {
        if (!tool) throw new Error(`unknown tool ${tc.function.name}`);
        input = JSON.parse(tc.function.arguments || "{}");
        output = await tool.run(z.object(tool.shape).parse(input));
        if (tc.function.name === "request_spend") spends.push(output as SpendResult);
      } catch (e: any) {
        output = { error: e?.shortMessage ?? e?.message ?? String(e) };
      }
      log(`  tool ${tc.function.name}(${tc.function.arguments}) -> ${JSON.stringify(output)}`);
      calls.push({ name: tc.function.name, input, output });
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(output) });
    }
  }
  return { transcript, calls, spends };
}

if (process.argv[1]?.endsWith("worker.ts")) {
  const task = process.argv.slice(2).join(" ") || "Buy the $0.10 weather dataset from VENDOR_A.";
  runWorker(task).then(() => process.exit(0), (e) => (console.error(e.message), process.exit(1)));
}
