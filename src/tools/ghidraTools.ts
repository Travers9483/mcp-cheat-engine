import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BaseBridge } from "../bridges/baseBridge.js";

/**
 * Registers Ghidra static-analysis tools on the MCP server.
 * Each tool maps to a handler in bridges/ghidra/bridge.py.
 */
export function registerGhidraTools(server: McpServer, bridge: BaseBridge) {
  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  };

  // ---------- diagnostics ----------
  server.tool(
    "ghidra_status",
    "Check whether the Ghidra bridge is connected, and which program (if any) is currently loaded.",
    {},
    async () =>
      wrap(async () => {
        const connected = bridge.isConnected();
        if (!connected) {
          return {
            connected: false,
            hint: "In Ghidra, open Script Manager, run bridges/ghidra/bridge.py.",
          };
        }
        const info = await bridge.call("status");
        return { connected: true, ...info as object };
      }),
  );

  // ---------- functions ----------
  server.tool(
    "ghidra_list_functions",
    "List all functions in the current program. Returns name, address, size, and signature for each. Use `filter` to search by name substring.",
    {
      filter: z.string().optional().describe("Substring to filter function names"),
      offset: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    async (a) => wrap(() => bridge.call("list_functions", a)),
  );

  server.tool(
    "ghidra_decompile",
    "Decompile a function by name or address. Returns the C-like pseudocode. This is the primary tool for understanding what code does.",
    {
      function: z.union([z.string(), z.number()]).describe("Function name or address (hex string or number)"),
    },
    async (a) => wrap(() => bridge.call("decompile", a, 30_000)),
  );

  server.tool(
    "ghidra_disassemble",
    "Disassemble N instructions starting at an address. Returns address, bytes, mnemonic, and operands per instruction.",
    {
      address: z.union([z.string(), z.number()]).describe("Start address (hex string or number)"),
      count: z.number().int().min(1).max(200).optional().default(20),
    },
    async (a) => wrap(() => bridge.call("disassemble", a)),
  );

  // ---------- cross-references ----------
  server.tool(
    "ghidra_get_xrefs_to",
    "Get all cross-references TO an address (who calls/references this location).",
    {
      address: z.union([z.string(), z.number()]).describe("Target address"),
    },
    async (a) => wrap(() => bridge.call("get_xrefs_to", a)),
  );

  server.tool(
    "ghidra_get_xrefs_from",
    "Get all cross-references FROM an address (what does this location call/reference).",
    {
      address: z.union([z.string(), z.number()]).describe("Source address"),
    },
    async (a) => wrap(() => bridge.call("get_xrefs_from", a)),
  );

  // ---------- annotations ----------
  server.tool(
    "ghidra_rename",
    "Rename a function or label at the given address.",
    {
      address: z.union([z.string(), z.number()]).describe("Address of the symbol to rename"),
      newName: z.string().describe("New name for the symbol"),
    },
    async (a) => wrap(() => bridge.call("rename", a)),
  );

  server.tool(
    "ghidra_add_comment",
    "Add or replace a comment at the given address.",
    {
      address: z.union([z.string(), z.number()]),
      comment: z.string(),
      type: z.enum(["eol", "pre", "post", "plate"]).optional().default("eol").describe("Comment type"),
    },
    async (a) => wrap(() => bridge.call("add_comment", a)),
  );

  // ---------- data extraction ----------
  server.tool(
    "ghidra_list_strings",
    "List defined strings in the current program. Useful for finding debug messages, format strings, error text.",
    {
      filter: z.string().optional().describe("Substring to filter strings"),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    async (a) => wrap(() => bridge.call("list_strings", a)),
  );

  server.tool(
    "ghidra_list_imports",
    "List imported functions/symbols from external libraries.",
    {
      filter: z.string().optional().describe("Substring to filter import names"),
    },
    async (a) => wrap(() => bridge.call("list_imports", a)),
  );

  server.tool(
    "ghidra_list_exports",
    "List exported functions/symbols.",
    {
      filter: z.string().optional().describe("Substring to filter export names"),
    },
    async (a) => wrap(() => bridge.call("list_exports", a)),
  );

  server.tool(
    "ghidra_list_segments",
    "List all memory segments/sections (.text, .data, .rdata, etc.) with their address ranges and permissions.",
    {},
    async () => wrap(() => bridge.call("list_segments")),
  );

  // ---------- escape hatch ----------
  server.tool(
    "ghidra_eval",
    "ESCAPE HATCH: execute arbitrary Python code inside Ghidra's scripting environment and return the result. Use when no other ghidra_* tool covers your need. The code runs with full access to Ghidra's Java API via the `currentProgram`, `monitor`, `state` variables and all `ghidra.*` packages.",
    { code: z.string() },
    async (a) => wrap(() => bridge.call("eval", a, 30_000)),
  );
}
