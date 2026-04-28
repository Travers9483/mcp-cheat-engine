import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CeBridge } from "./ceBridge.js";

/**
 * Registers Cheat-Engine tools on the MCP server. Each tool is a thin wrapper
 * around a method exposed by the Lua bridge running inside CE.
 */
export function registerTools(server: McpServer, bridge: CeBridge) {
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
    "ce_status",
    "Check whether the Cheat Engine Lua bridge is connected, and which process (if any) is currently attached.",
    {},
    async () =>
      wrap(async () => {
        const connected = bridge.isConnected();
        if (!connected) {
          return {
            connected: false,
            hint: "Open Cheat Engine, press Ctrl+Alt+L, paste ce-lua/bridge.lua, click 'Execute script'.",
          };
        }
        const ping = await bridge.call("ping");
        const cur = await bridge.call("current_process");
        return { connected: true, ping, current: cur };
      }),
  );

  // ---------- process management ----------
  server.tool(
    "ce_list_processes",
    "List all running processes Cheat Engine can see (PID + name).",
    {},
    async () => wrap(() => bridge.call("list_processes")),
  );

  server.tool(
    "ce_attach_process",
    "Attach Cheat Engine to a process by PID (number) or name (e.g. 'Tutorial-x86_64.exe').",
    { process: z.union([z.number().int(), z.string()]).describe("PID or process name") },
    async ({ process }) => wrap(() => bridge.call("attach", { process })),
  );

  // ---------- memory read/write ----------
  const valueType = z.enum([
    "byte", "int8", "uint8", "int16", "int32", "int", "int64",
    "float", "double", "string", "wstring",
  ]);

  server.tool(
    "ce_read_memory",
    "Read a typed value from memory. Address can be a hex string ('7FF6...'), decimal, or a CE symbol like 'Tutorial-x86_64.exe+1A2B'.",
    {
      address: z.union([z.string(), z.number()]),
      type: valueType.optional().default("int32"),
    },
    async (a) => wrap(() => bridge.call("read_memory", a)),
  );

  server.tool(
    "ce_write_memory",
    "Write a typed value to memory.",
    {
      address: z.union([z.string(), z.number()]),
      value: z.union([z.string(), z.number()]),
      type: valueType.optional().default("int32"),
    },
    async (a) => wrap(() => bridge.call("write_memory", a)),
  );

  server.tool(
    "ce_read_bytes",
    "Read a region of raw bytes; returns space-separated uppercase hex (like the CE Memory Viewer's hex pane).",
    {
      address: z.union([z.string(), z.number()]),
      size: z.number().int().min(1).max(4096).default(64),
    },
    async (a) => wrap(() => bridge.call("read_bytes", a)),
  );

  server.tool(
    "ce_write_bytes",
    "Write a hex byte sequence (e.g. '90 90 90' or '909090') to memory.",
    {
      address: z.union([z.string(), z.number()]),
      hex: z.string(),
    },
    async (a) => wrap(() => bridge.call("write_bytes", a)),
  );

  // ---------- disassembly ----------
  server.tool(
    "ce_disassemble",
    "Disassemble N instructions starting at address. Returns address/bytes/opcode/comment per instruction — this is what 'looking at the CE disassembler' becomes for the model.",
    {
      address: z.union([z.string(), z.number()]),
      count: z.number().int().min(1).max(200).default(15),
    },
    async (a) => wrap(() => bridge.call("disassemble", a)),
  );

  // ---------- scanning ----------
  server.tool(
    "ce_scan_first",
    "Start a fresh memory scan. Use this when the user says 'scan for X'. After this, narrow with ce_scan_next, then list with ce_scan_results.",
    {
      type: valueType.optional().default("int32"),
      scanOption: z.enum(["exact", "bigger", "smaller", "between", "unknown"]).default("exact"),
      value: z.union([z.string(), z.number()]).optional(),
      value2: z.union([z.string(), z.number()]).optional().describe("only used for 'between'"),
      hex: z.boolean().optional().default(false).describe("interpret value as hex"),
    },
    async (a) => wrap(() => bridge.call("scan_first", a, 120_000)),
  );

  server.tool(
    "ce_scan_next",
    "Narrow the active scan with a follow-up filter (e.g. value changed to 95, or 'decreased', 'unchanged', etc.).",
    {
      scanOption: z.enum([
        "exact", "bigger", "smaller", "between",
        "increased", "decreased", "changed", "unchanged",
      ]).default("exact"),
      value: z.union([z.string(), z.number()]).optional(),
      value2: z.union([z.string(), z.number()]).optional(),
      hex: z.boolean().optional().default(false),
    },
    async (a) => wrap(() => bridge.call("scan_next", a, 120_000)),
  );

  server.tool(
    "ce_scan_results",
    "Return up to `limit` addresses from the current scan, with their current values.",
    { limit: z.number().int().min(1).max(1000).default(50) },
    async (a) => wrap(() => bridge.call("scan_results", a)),
  );

  server.tool(
    "ce_scan_reset",
    "Discard the active scan so the next ce_scan_first starts fresh.",
    {},
    async () => wrap(() => bridge.call("scan_reset")),
  );

  // ---------- cheat table ----------
  server.tool(
    "ce_list_entries",
    "List all entries currently in the Cheat Engine address list (the bottom pane of CE).",
    {},
    async () => wrap(() => bridge.call("list_entries")),
  );

  server.tool(
    "ce_add_entry",
    "Add a new entry to the address list so the user can see/keep it.",
    {
      address: z.string(),
      description: z.string().optional(),
      type: valueType.optional().default("int32"),
    },
    async (a) => wrap(() => bridge.call("add_entry", a)),
  );

  server.tool(
    "ce_set_entry_value",
    "Set the value of an existing address-list entry by description or zero-based index.",
    {
      description: z.string().optional(),
      index: z.number().int().optional(),
      value: z.union([z.string(), z.number()]),
    },
    async (a) => wrap(() => bridge.call("set_entry_value", a)),
  );

  server.tool(
    "ce_freeze_entry",
    "Freeze (or unfreeze) an address-list entry.",
    {
      description: z.string().optional(),
      index: z.number().int().optional(),
      frozen: z.boolean().default(true),
    },
    async (a) => wrap(() => bridge.call("freeze_entry", a)),
  );

  // ---------- assembly / advanced ----------
  server.tool(
    "ce_auto_assemble",
    "Run a Cheat Engine Auto-Assembler script (the [ENABLE]/[DISABLE] format). Use for code injection, NOPs, hooks.",
    { script: z.string() },
    async (a) => wrap(() => bridge.call("auto_assemble", a, 30_000)),
  );

  server.tool(
    "ce_resolve_symbol",
    "Resolve a CE symbol expression (e.g. 'game.exe+1A2B' or '[base+10]+8') to an absolute address.",
    { symbol: z.string() },
    async (a) => wrap(() => bridge.call("resolve_symbol", a)),
  );

  server.tool(
    "ce_set_speedhack",
    "Enable Cheat Engine's speed-hack at the given multiplier (1.0 = normal, 0.5 = half speed, 2.0 = double).",
    { speed: z.number().positive() },
    async (a) => wrap(() => bridge.call("set_speedhack", a)),
  );

  // ---------- UI introspection & automation ----------
  server.tool(
    "ce_list_windows",
    "List every form/window currently open in Cheat Engine (Main, Memory View, Disassembler, scan-result panels, dialogs). Use to discover what's visible before inspecting deeper.",
    {},
    async () => wrap(() => bridge.call("list_windows")),
  );

  server.tool(
    "ce_inspect_form",
    "Recursively dump a CE form's control tree (names, classes, captions, text, bounds). Use to find the exact control path of a button/textbox you want to read or operate. Path examples: 'MainForm', 'MemoryView'. Or pass a form name from ce_list_windows.",
    {
      name: z.string().optional().describe("Root form name (e.g. 'MainForm', 'MemoryView')."),
      path: z.string().optional().describe("Or a deep dotted path to start from."),
      maxDepth: z.number().int().min(1).max(10).optional().default(5),
      includeText: z.boolean().optional().default(true),
    },
    async (a) => wrap(() => bridge.call("inspect_form", a)),
  );

  server.tool(
    "ce_get_control",
    "Read the current text/caption/state of a CE UI control by dotted path (e.g. 'MainForm.Scanvalue').",
    { path: z.string() },
    async (a) => wrap(() => bridge.call("get_control", a)),
  );

  server.tool(
    "ce_set_control",
    "Set Text, Caption, ItemIndex, or Checked on a CE UI control. Pass only the props you want to change.",
    {
      path: z.string(),
      text: z.string().optional(),
      caption: z.string().optional(),
      itemIndex: z.number().int().optional(),
      checked: z.boolean().optional(),
    },
    async (a) => wrap(() => bridge.call("set_control", a)),
  );

  server.tool(
    "ce_click_control",
    "Click a button or invoke a control's OnClick handler programmatically (no mouse, no focus needed).",
    { path: z.string() },
    async (a) => wrap(() => bridge.call("click_control", a)),
  );

  server.tool(
    "ce_eval_lua",
    "ESCAPE HATCH: execute arbitrary Cheat Engine Lua code inside CE and return the result. Use this when no other ce_* tool covers what you need (any CE Lua API: getMemoryViewForm, openProcess, MainForm.btnFirstScan.doClick(), createMemoryView(), getAddressList().getMemoryRecord(0).Value, etc.). Code may be a single expression OR a multi-statement chunk (use 'do ... end' or 'return X' explicitly).",
    { code: z.string() },
    async (a) => wrap(() => bridge.call("eval_lua", a, 30_000)),
  );
}
