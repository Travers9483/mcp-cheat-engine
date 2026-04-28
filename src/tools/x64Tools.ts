import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BaseBridge } from "../bridges/baseBridge.js";

/**
 * Registers x64dbg debugging tools on the MCP server.
 * Each tool maps to a handler in bridges/x64dbg/bridge.py.
 */
export function registerX64Tools(server: McpServer, bridge: BaseBridge) {
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
    "x64_status",
    "Check whether the x64dbg bridge is connected and what is being debugged.",
    {},
    async () =>
      wrap(async () => {
        const connected = bridge.isConnected();
        if (!connected) {
          return {
            connected: false,
            hint: "In x64dbg, load the bridge plugin or run bridges/x64dbg/bridge.py via the Script tab.",
          };
        }
        const info = await bridge.call("status");
        return { connected: true, ...info as object };
      }),
  );

  // ---------- process control ----------
  server.tool(
    "x64_open",
    "Open an executable in x64dbg for debugging.",
    { path: z.string().describe("Path to the executable to debug") },
    async (a) => wrap(() => bridge.call("open", a)),
  );

  server.tool(
    "x64_attach",
    "Attach x64dbg to a running process by PID.",
    { pid: z.number().int().describe("Process ID to attach to") },
    async (a) => wrap(() => bridge.call("attach", a)),
  );

  server.tool(
    "x64_detach",
    "Detach from the currently debugged process.",
    {},
    async () => wrap(() => bridge.call("detach")),
  );

  // ---------- execution control ----------
  server.tool(
    "x64_run",
    "Resume execution (F9). Optionally run until a specific address.",
    { address: z.union([z.string(), z.number()]).optional().describe("Run until this address (optional)") },
    async (a) => wrap(() => bridge.call("run", a)),
  );

  server.tool(
    "x64_pause",
    "Pause (break into) the debuggee.",
    {},
    async () => wrap(() => bridge.call("pause")),
  );

  server.tool(
    "x64_step_into",
    "Execute one instruction, stepping into calls (F7).",
    { count: z.number().int().min(1).max(100).optional().default(1) },
    async (a) => wrap(() => bridge.call("step_into", a)),
  );

  server.tool(
    "x64_step_over",
    "Execute one instruction, stepping over calls (F8).",
    { count: z.number().int().min(1).max(100).optional().default(1) },
    async (a) => wrap(() => bridge.call("step_over", a)),
  );

  server.tool(
    "x64_step_out",
    "Execute until the current function returns (Ctrl+F9).",
    {},
    async () => wrap(() => bridge.call("step_out")),
  );

  // ---------- registers ----------
  server.tool(
    "x64_get_registers",
    "Read all general-purpose registers and flags.",
    {},
    async () => wrap(() => bridge.call("get_registers")),
  );

  server.tool(
    "x64_set_register",
    "Set a register value (e.g. RAX, RCX, RIP, EFlags).",
    {
      register: z.string().describe("Register name (e.g. 'RAX', 'RCX', 'RIP')"),
      value: z.union([z.string(), z.number()]).describe("New value (hex string or number)"),
    },
    async (a) => wrap(() => bridge.call("set_register", a)),
  );

  // ---------- memory ----------
  server.tool(
    "x64_read_memory",
    "Read raw bytes from memory in the debuggee. Returns hex dump.",
    {
      address: z.union([z.string(), z.number()]).describe("Address to read from"),
      size: z.number().int().min(1).max(4096).optional().default(64),
    },
    async (a) => wrap(() => bridge.call("read_memory", a)),
  );

  server.tool(
    "x64_write_memory",
    "Write raw hex bytes to memory in the debuggee.",
    {
      address: z.union([z.string(), z.number()]).describe("Address to write to"),
      hex: z.string().describe("Hex bytes to write (e.g. '90 90 90')"),
    },
    async (a) => wrap(() => bridge.call("write_memory", a)),
  );

  // ---------- disassembly ----------
  server.tool(
    "x64_disassemble",
    "Disassemble N instructions at the given address.",
    {
      address: z.union([z.string(), z.number()]).optional().describe("Address (defaults to current RIP/EIP)"),
      count: z.number().int().min(1).max(200).optional().default(20),
    },
    async (a) => wrap(() => bridge.call("disassemble", a)),
  );

  // ---------- breakpoints ----------
  server.tool(
    "x64_set_breakpoint",
    "Set a software breakpoint at the given address.",
    {
      address: z.union([z.string(), z.number()]).describe("Address for breakpoint"),
      singleshot: z.boolean().optional().default(false).describe("Remove after first hit"),
    },
    async (a) => wrap(() => bridge.call("set_breakpoint", a)),
  );

  server.tool(
    "x64_remove_breakpoint",
    "Remove a breakpoint at the given address.",
    { address: z.union([z.string(), z.number()]) },
    async (a) => wrap(() => bridge.call("remove_breakpoint", a)),
  );

  server.tool(
    "x64_list_breakpoints",
    "List all active breakpoints.",
    {},
    async () => wrap(() => bridge.call("list_breakpoints")),
  );

  // ---------- modules & stack ----------
  server.tool(
    "x64_modules",
    "List all loaded modules (DLLs) in the debuggee with their base addresses and sizes.",
    {},
    async () => wrap(() => bridge.call("modules")),
  );

  server.tool(
    "x64_stack_trace",
    "Get the current call stack / backtrace.",
    {},
    async () => wrap(() => bridge.call("stack_trace")),
  );

  // ---------- annotations ----------
  server.tool(
    "x64_add_comment",
    "Add a comment at an address in the x64dbg disassembly view.",
    {
      address: z.union([z.string(), z.number()]),
      comment: z.string(),
    },
    async (a) => wrap(() => bridge.call("add_comment", a)),
  );

  server.tool(
    "x64_add_label",
    "Add a label (named bookmark) at an address.",
    {
      address: z.union([z.string(), z.number()]),
      label: z.string(),
    },
    async (a) => wrap(() => bridge.call("add_label", a)),
  );

  // ---------- escape hatch ----------
  server.tool(
    "x64_command",
    "Execute an arbitrary x64dbg command string and return the result. Use for any x64dbg functionality not covered by other x64_* tools. See x64dbg command reference for available commands.",
    { command: z.string().describe("x64dbg command to execute") },
    async (a) => wrap(() => bridge.call("command", a, 30_000)),
  );
}
