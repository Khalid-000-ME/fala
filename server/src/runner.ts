import { z } from "zod";
import { env } from "./env.js";
import { tools, type AgentCtx } from "./tools.js";

type Msg = { role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string };
const SYSTEM = `You are a procurement assistant. You buy small data and API services for your owner.
Call get_allowance first. Small payments to known payees are paid instantly; anything bigger is emailed to your human for approval, and you cannot approve it yourself or split payments to avoid it.
After requesting a payment that needs approval, use payment_status with wait_seconds to follow it, then report the result.`;

const defs = tools.map((t) => {
  const { $schema: _, ...parameters } = z.toJSONSchema(z.object(t.shape)) as Record<string, unknown>;
  return { type: "function", function: { name: t.name, description: t.description, parameters } };
});

async function chat(messages: Msg[]) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.groqKey()}` },
      body: JSON.stringify({ model: env.model(), messages, tools: defs, tool_choice: "auto", temperature: 0, max_tokens: 1024 }),
    });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 15000)); continue; }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).choices[0].message as Msg;
  }
}

/** The platform's own agent: a Groq tool-use loop over the same tools every provider gets. */
export async function runManaged(agent: AgentCtx, task: string) {
  if (!env.groqKey()) throw new Error("the managed agent needs GROQ_API_KEY on the server");
  const messages: Msg[] = [{ role: "system", content: SYSTEM }, { role: "user", content: task }];
  const steps: { tool: string; input: unknown; output: unknown }[] = [];
  let answer = "";
  for (let turn = 0; turn < 12; turn++) {
    const m = await chat(messages);
    messages.push({ role: "assistant", content: m.content, tool_calls: m.tool_calls });
    if (m.content) answer = m.content;
    if (!m.tool_calls?.length) break;
    for (const tc of m.tool_calls) {
      const tool = tools.find((t) => t.name === tc.function.name);
      let out: unknown;
      let input: unknown = {};
      try {
        if (!tool) throw new Error(`unknown tool ${tc.function.name}`);
        input = JSON.parse(tc.function.arguments || "{}");
        out = await tool.run(agent, z.object(tool.shape).parse(input));
      } catch (e: any) { out = { error: e?.shortMessage ?? e?.message ?? String(e) }; }
      steps.push({ tool: tc.function.name, input, output: out });
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
    }
  }
  return { answer, steps };
}
