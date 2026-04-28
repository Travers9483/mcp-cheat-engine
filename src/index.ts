#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CeBridge } from "./ceBridge.js";
import { registerTools } from "./tools.js";

async function main() {
  const port = Number(process.env.CE_BRIDGE_PORT ?? 5874);
  const host = process.env.CE_BRIDGE_HOST ?? "127.0.0.1";

  const bridge = new CeBridge(host, port);
  await bridge.start();

  const server = new McpServer({
    name: "mcp-cheat-engine",
    version: "0.1.0",
  }, {
    instructions: [
      "You can drive Cheat Engine through these tools.",
      "Workflow tips:",
      "1. Always start with `ce_status`. If not connected, instruct the user to load ce-lua/bridge.lua in CE (Ctrl+Alt+L → paste → Execute).",
      "2. To scan: ce_attach_process → ce_scan_first → (player changes value) → ce_scan_next → ce_scan_results.",
      "3. To inspect code: ce_disassemble. To inspect data: ce_read_bytes / ce_read_memory.",
      "4. Persist findings via ce_add_entry so the user sees them in CE's address list.",
      "5. Be cautious with ce_write_memory and ce_auto_assemble; explain what you'll change before doing it.",
    ].join("\n"),
  });

  registerTools(server, bridge);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] mcp-cheat-engine ready (stdio).");
}

main().catch((err) => {
  console.error("[mcp] fatal:", err);
  process.exit(1);
});
