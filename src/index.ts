#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BaseBridge } from "./bridges/baseBridge.js";
import { registerCeTools } from "./tools/ceTools.js";
import { registerGhidraTools } from "./tools/ghidraTools.js";
import { registerX64Tools } from "./tools/x64Tools.js";
import { registerStatusTools } from "./tools/statusTools.js";

async function main() {
  // --- Bridge ports (configurable via env vars) ---
  const cePort     = Number(process.env.CE_BRIDGE_PORT     ?? 5874);
  const x64Port    = Number(process.env.X64_BRIDGE_PORT    ?? 5875);
  const ghidraPort = Number(process.env.GHIDRA_BRIDGE_PORT ?? 5876);
  const host       = process.env.RE_BRIDGE_HOST            ?? "127.0.0.1";

  // --- Create bridges ---
  const ceBridge     = new BaseBridge("ce-bridge",     host, cePort);
  const x64Bridge    = new BaseBridge("x64-bridge",    host, x64Port);
  const ghidraBridge = new BaseBridge("ghidra-bridge", host, ghidraPort);

  // --- Start all bridges (they listen independently) ---
  await ceBridge.start();
  await x64Bridge.start();
  await ghidraBridge.start();

  // --- Create MCP server ---
  const server = new McpServer({
    name: "re-mcp",
    version: "0.2.0",
  }, {
    instructions: [
      "You can drive multiple reverse engineering tools through these tools.",
      "",
      "AVAILABLE BACKENDS:",
      "  ce_*     — Cheat Engine (live memory scanning, reading, writing, speed hack)",
      "  x64_*    — x64dbg (debugging: breakpoints, stepping, registers, disassembly)",
      "  ghidra_* — Ghidra (static analysis: decompilation, functions, xrefs, strings)",
      "  re_*     — Unified tools (status across all backends)",
      "",
      "WORKFLOW TIPS:",
      "1. Start with `re_status` to see which backends are connected.",
      "2. For live analysis: ce_attach_process → ce_scan_first → ce_scan_next → ce_scan_results.",
      "3. For debugging: x64_open → x64_run → x64_set_breakpoint → x64_get_registers.",
      "4. For static analysis: ghidra_list_functions → ghidra_decompile → ghidra_get_xrefs_to.",
      "5. Combine tools: find an address in CE, disassemble in x64dbg, decompile in Ghidra.",
      "6. Be cautious with writes — explain what you'll change before doing it.",
    ].join("\n"),
  });

  // --- Register all tool sets ---
  registerStatusTools(server, [
    { name: "cheat-engine", bridge: ceBridge },
    { name: "x64dbg",       bridge: x64Bridge },
    { name: "ghidra",       bridge: ghidraBridge },
  ]);
  registerCeTools(server, ceBridge);
  registerX64Tools(server, x64Bridge);
  registerGhidraTools(server, ghidraBridge);

  // --- Connect via stdio ---
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[re-mcp] ready (stdio). Bridges: CE=%d, x64dbg=%d, Ghidra=%d", cePort, x64Port, ghidraPort);
}

main().catch((err) => {
  console.error("[re-mcp] fatal:", err);
  process.exit(1);
});
