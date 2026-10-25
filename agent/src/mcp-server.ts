import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "./lib/tools.js";

const server = new McpServer({ name: "fala-mcp", version: "0.2.0" });
for (const t of tools) {
  server.tool(t.name, t.description, t.shape, async (input: any) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await t.run(input), null, 2) }] };
    } catch (e: any) {
      return { isError: true, content: [{ type: "text" as const, text: e?.shortMessage ?? e?.message ?? String(e) }] };
    }
  });
}
await server.connect(new StdioServerTransport());
