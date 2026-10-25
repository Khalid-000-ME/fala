import { z } from "zod";
import { groqKey } from "./lib/config.js";
import { chat, type ChatMessage, type ToolDef } from "./lib/llm.js";
import { tools } from "./lib/tools.js";

const SYSTEM = `You are a procurement assistant. You buy small data and API services from known vendors for your owner.
Call get_allowance first. Pay only vendors returned by list_known_payees. Small payments to them are paid instantly.
Anything bigger is sent to your human for approval by email — you cannot approve it yourself, and you must never split a payment to get under your allowance.
After requesting a payment that needs approval, use payment_status with wait_seconds to follow it, then report the result.`;

const toolDefs: ToolDef[] = tools.map((t) => {
  const { $schema: _, ...parameters } = z.toJSONSchema(z.object(t.shape)) as Record<string, unknown>;
  return { type: "function", function: { name: t.name, description: t.description, parameters } };
});

export async function runAgent(task: string, log = console.log) {
  if (!groqKey()) throw new Error("GROQ_API_KEY is not set");
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }, { role: "user", content: task }];
  for (let turn = 0; turn < 16; turn++) {
    const msg = await chat(messages, { tools: toolDefs });
    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });
    if (msg.content) log(`\nagent: ${msg.content}`);
    if (!msg.tool_calls?.length) return;
    for (const tc of msg.tool_calls) {
      const tool = tools.find((t) => t.name === tc.function.name);
      let out: unknown;
      try {
        if (!tool) throw new Error(`unknown tool ${tc.function.name}`);
        out = await tool.run(z.object(tool.shape).parse(JSON.parse(tc.function.arguments || "{}")));
      } catch (e: any) {
        out = { error: e?.shortMessage ?? e?.message ?? String(e) };
      }
      log(`  → ${tc.function.name}(${tc.function.arguments}) = ${JSON.stringify(out)}`);
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
    }
  }
}

if (process.argv[1]?.endsWith("agent.ts")) {
  const task = process.argv.slice(2).join(" ") || "Buy the $0.10 eu-weather dataset from VENDOR_A, then subscribe to the $2.00 annual API plan from VENDOR_A.";
  runAgent(task).then(() => process.exit(0), (e) => (console.error(e.message), process.exit(1)));
}
