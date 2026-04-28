import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BaseBridge } from "../bridges/baseBridge.js";

/**
 * Registers the unified re_status tool that reports on all connected backends.
 */
export function registerStatusTools(
  server: McpServer,
  bridges: { name: string; bridge: BaseBridge }[],
) {
  server.tool(
    "re_status",
    "Show connection status for all reverse engineering tool backends (Cheat Engine, x64dbg, Ghidra). Use this first to see which tools are available.",
    {},
    async () => {
      const statuses: Record<string, unknown> = {};
      for (const { name, bridge } of bridges) {
        const connected = bridge.isConnected();
        if (connected) {
          try {
            const info = await bridge.call("ping", {}, 3_000).catch(() => null) ??
                         await bridge.call("status", {}, 3_000).catch(() => ({ ok: true }));
            statuses[name] = { connected: true, info };
          } catch {
            statuses[name] = { connected: true, info: "ping failed" };
          }
        } else {
          statuses[name] = { connected: false };
        }
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ backends: statuses }, null, 2),
        }],
      };
    },
  );
}
