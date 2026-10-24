import { groqKey, model } from "./config.js";

const URL = "https://api.groq.com/openai/v1/chat/completions";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: unknown } };

/** Groq's OpenAI-compatible chat completions endpoint. */
export async function chat(messages: ChatMessage[], opts: { tools?: ToolDef[]; json?: boolean; maxTokens?: number } = {}) {
  const key = groqKey();
  if (!key) throw new Error("GROQ_API_KEY is not set");
  const res = await fetch(URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model(),
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: 0,
      ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
  return data.choices[0].message;
}
