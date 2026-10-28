import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { agentFromKey } from "./auth.js";
import { tools } from "./tools.js";

/** Remote MCP endpoint: `Authorization: Bearer fala_sk_…` identifies the agent. Stateless, one server per request. */
export async function handleMcp(req: Request): Promise<Response> {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const agent = key ? await agentFromKey(key) : undefined;
  if (!agent) return new Response(JSON.stringify({ error: "missing or invalid API key" }), { status: 401, headers: { "content-type": "application/json" } });
  const ctx = { address: agent.address, enc_key: agent.enc_key, vault_address: agent.vault_address, kind: agent.kind };

  const server = new McpServer({ name: "fala", version: "0.3.0" });
  for (const t of tools) {
    server.tool(t.name, t.description, t.shape, async (input: any) => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(await t.run(ctx, input), null, 2) }] };
      } catch (e: any) {
        return { isError: true, content: [{ type: "text" as const, text: e?.shortMessage ?? e?.message ?? String(e) }] };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
