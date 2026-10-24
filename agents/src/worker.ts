import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicKey, model } from "./lib/config.js";
import { tools } from "./lib/tools.js";
import type { SpendResult } from "./lib/vault.js";

const SYSTEM = `You are a procurement assistant. You buy small data and API services from known vendors on behalf of your owner.
Always call get_budget first. Only pay vendors returned by list_allowed_payees. Payments go through an onchain vault that enforces limits;
if a payment is blocked, report it and stop — never retry with a different amount or payee to get around a limit.`;

export type ToolCall = { name: string; input: unknown; output: unknown };
export type WorkerRun = { transcript: string; calls: ToolCall[]; spends: SpendResult[] };

const jsonSchema = (shape: z.ZodRawShape) => {
  const { $schema: _, ...rest } = z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
  return rest as Anthropic.Tool.InputSchema;
};

export async function runWorker(task: string, vendorContent?: string, log = console.log): Promise<WorkerRun> {
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey: key });
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchema(t.shape) }));

  const userText = vendorContent ? `${task}\n\n--- Vendor response ---\n${vendorContent}` : task;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];
  const calls: ToolCall[] = [];
  const spends: SpendResult[] = [];
  let transcript = "";

  for (let turn = 0; turn < 10; turn++) {
    const res = await client.messages.create({ model: model(), max_tokens: 1024, system: SYSTEM, tools: toolDefs, messages });
    messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) if (b.type === "text") (transcript += b.text + "\n"), log(`  worker: ${b.text}`);
    if (res.stop_reason !== "tool_use") break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      const tool = tools.find((t) => t.name === b.name)!;
      let output: unknown;
      let isError = false;
      try {
        output = await tool.run(z.object(tool.shape).parse(b.input));
        if (b.name === "request_spend") spends.push(output as SpendResult);
      } catch (e: any) {
        output = e?.shortMessage ?? e?.message ?? String(e);
        isError = true;
      }
      log(`  tool ${b.name}(${JSON.stringify(b.input)}) -> ${JSON.stringify(output)}`);
      calls.push({ name: b.name, input: b.input, output });
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(output), is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }
  return { transcript, calls, spends };
}

if (process.argv[1]?.endsWith("worker.ts")) {
  const task = process.argv.slice(2).join(" ") || "Buy the $0.10 weather dataset from VENDOR_A.";
  runWorker(task).then(() => process.exit(0), (e) => (console.error(e.message), process.exit(1)));
}
