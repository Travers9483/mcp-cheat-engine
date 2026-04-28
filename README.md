# mcp-cheat-engine

> Let your AI assistant drive **Cheat Engine** — scan memory, read/write values, disassemble code, manage the cheat table, and more — all through natural language.

<br>

```
┌─────────────────────┐        MCP / stdio        ┌─────────────────────┐       HTTP poll       ┌──────────────────┐
│   AI Assistant      │ ◄─────────────────────────►│  Node.js MCP Server │◄─────────────────────►│   Cheat Engine   │
│  (Copilot / Claude) │                            │   localhost:5874    │                       │   (Lua bridge)   │
└─────────────────────┘                            └─────────────────────┘                       └──────────────────┘
```

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes Cheat Engine's full feature set as AI-callable tools. Works with any MCP-compatible client — **GitHub Copilot Chat** in VS Code, **Claude Desktop**, or any other MCP host.

---

## Features

20 tools available to the AI, covering the complete Cheat Engine workflow:

| Category | Tools | What they do |
|---|---|---|
| **Diagnostics** | `ce_status` | Check bridge connection & attached process |
| **Process** | `ce_list_processes`, `ce_attach_process` | Find and open a target process |
| **Memory** | `ce_read_memory`, `ce_write_memory` | Read/write typed values (int32, float, string, etc.) |
| **Raw Bytes** | `ce_read_bytes`, `ce_write_bytes` | Hex dump & patch (like the Memory Viewer) |
| **Scanning** | `ce_scan_first`, `ce_scan_next`, `ce_scan_results`, `ce_scan_reset` | Full memory scan workflow |
| **Disassembly** | `ce_disassemble` | Read instructions (like the Disassembler window) |
| **Cheat Table** | `ce_list_entries`, `ce_add_entry`, `ce_set_entry_value`, `ce_freeze_entry` | Manage the address list |
| **Scripting** | `ce_auto_assemble` | Run Auto Assembler scripts (hooks, NOPs, code caves) |
| **Symbols** | `ce_resolve_symbol` | Resolve `game.exe+1A2B` → absolute address |
| **Speed Hack** | `ce_set_speedhack` | Change game speed (0.5× / 2× / etc.) |
| **UI** | `ce_list_windows`, `ce_inspect_form`, `ce_get_control`, `ce_set_control`, `ce_click_control` | Inspect & automate CE's own UI |
| **Escape Hatch** | `ce_eval_lua` | Execute arbitrary Lua inside Cheat Engine |

---

## Prerequisites

| Requirement | Version | Link |
|---|---|---|
| **Node.js** | 20 or newer (LTS recommended) | [nodejs.org/en/download](https://nodejs.org/en/download) |
| **Cheat Engine** | 7.5 or newer | [cheatengine.org](https://www.cheatengine.org/) |
| **VS Code** | Latest | [code.visualstudio.com](https://code.visualstudio.com/) |
| **GitHub Copilot Chat** | Extension installed & signed in | [Marketplace](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) |

> **Other MCP hosts** (e.g. Claude Desktop) also work — you just need to point them at `dist/index.js` via stdio. The setup below focuses on VS Code + Copilot since that's the most common configuration.

---

## Quick Start

### 1. Clone & build

```powershell
git clone https://github.com/Travers9483/mcp-cheat-engine.git
cd mcp-cheat-engine
npm install
npm run build
```

This compiles the TypeScript source into `dist/index.js`.

### 2. Open in VS Code

Open the `mcp-cheat-engine` folder in VS Code. The included `.vscode/mcp.json` automatically registers the MCP server for this workspace.

Reload the window to pick it up:

> `Ctrl+Shift+P` → **Developer: Reload Window**

### 3. Verify the server is registered

1. Open **Copilot Chat** (right sidebar).
2. Switch the mode dropdown to **Agent**.
3. Click the **tools/wrench icon** — you should see **`cheat-engine`** listed with all `ce_*` tools.

### 4. Start Cheat Engine & load the bridge

1. Open Cheat Engine.
2. Press **`Ctrl+Alt+L`** (or **Table → Show Cheat Table Lua Script**).
3. Open `ce-lua/bridge.lua` from this project, select all (`Ctrl+A`), copy (`Ctrl+C`).
4. Paste into the CE Lua script window, then click **Execute script**.
5. The console (bottom pane) should print:

```
[MCP] Hello OK from http://127.0.0.1:5874/
[MCP] Bridge ready. Methods: add_entry, attach, auto_assemble, ...
```

> **Important:** The MCP server must be running *before* you execute the Lua script. Ask Copilot anything CE-related first (e.g. *"check ce_status"*) to trigger VS Code to launch the server.

### 5. Start chatting

In Copilot Chat (Agent mode), try:

```
Check ce_status.
```

If it says `connected: true` — you're good to go.

---

## Usage Examples

Here's a typical workflow using Cheat Engine's bundled tutorial (`Help → Cheat Engine Tutorial`):

```
You:    "List processes that contain 'Tutorial'."
AI:     → calls ce_list_processes, filters results
        Found: Tutorial-x86_64.exe (PID 12345)

You:    "Attach to that."
AI:     → calls ce_attach_process
        Attached to Tutorial-x86_64.exe

You:    "Scan for int32 value 100."
AI:     → calls ce_scan_first
        Found 48,291 results.

        (You click "Hit me" in the tutorial — health drops to 95)

You:    "Narrow the scan to 95."
AI:     → calls ce_scan_next
        3 results remaining.

You:    "Show results."
AI:     → calls ce_scan_results
        0x00ABC123 = 95

You:    "Add that to the cheat table as 'Health' and freeze it at 5000."
AI:     → calls ce_add_entry, ce_set_entry_value, ce_freeze_entry
        Done. Health frozen at 5000.

You:    "Disassemble 20 instructions at the address that wrote to Health."
AI:     → calls ce_disassemble
        (shows assembly listing)
```

---

## Detailed Setup Guide

> New to Node.js, MCP, or Cheat Engine? This section walks through everything step by step.

### Installing Node.js

1. Go to [nodejs.org/en/download](https://nodejs.org/en/download).
2. Download the **Windows Installer (.msi) — LTS** version.
3. Run the installer — click **Next** through everything, accept defaults.
4. Open a **new** PowerShell window and verify:

```powershell
node --version
# Expected: v20.x.x or higher
```

If you see *"command not found"*, restart your PC and try again.

### Installing Cheat Engine

1. Download from [cheatengine.org](https://www.cheatengine.org/).
2. Run the installer. **Decline** all bundled offers (AVG, etc.) — choose **Custom install** and untick everything.
3. Open Cheat Engine → **Help → About** → confirm version **7.5+**.

### Setting up Copilot Chat

1. In VS Code, open **Extensions** (left sidebar).
2. Search for **GitHub Copilot Chat** → **Install**.
3. Click the chat icon in the right sidebar, sign in if prompted.
4. Change the mode dropdown at the bottom from *Ask* to **Agent** — this is what enables tool calling.

### Building the server

```powershell
cd path/to/mcp-cheat-engine
npm install      # downloads dependencies (~10 MB)
npm run build    # compiles TypeScript → dist/
```

You only need to rebuild after changing TypeScript source files. The Lua bridge (`ce-lua/bridge.lua`) doesn't need compilation.

### Loading the Lua bridge

Every time you restart Cheat Engine, you need to reload the bridge:

1. In Copilot Chat, ask anything CE-related to ensure the MCP server is running.
2. In Cheat Engine: **`Ctrl+Alt+L`** → paste `bridge.lua` → **Execute script**.
3. Check the console for `[MCP] Bridge ready`.

> **Tip:** Save the bridge as a `.CT` cheat table (**File → Save** in CE) to auto-load it next time.

---

## Configuration

The server accepts configuration via environment variables:

| Variable | Default | Description |
|---|---|---|
| `CE_BRIDGE_PORT` | `5874` | Port for the HTTP bridge between Node.js and CE |
| `CE_BRIDGE_HOST` | `127.0.0.1` | Host to bind the HTTP server on |

These are set in `.vscode/mcp.json` for the VS Code integration, or can be passed as environment variables when running manually:

```powershell
$env:CE_BRIDGE_PORT = "5874"
node dist/index.js
```

---

## How It Works

### Architecture

The system has three layers:

1. **AI Client** (Copilot / Claude) — sends tool calls via MCP protocol over stdio
2. **Node.js MCP Server** — translates tool calls into commands, hosts an HTTP endpoint for CE to poll
3. **Cheat Engine Lua Bridge** — polls the HTTP endpoint every 250ms, executes commands using CE's Lua API, posts results back

### Communication Flow

```
1. User asks Copilot: "Scan for value 100"
2. Copilot calls tool: ce_scan_first({ type: "int32", value: 100 })
3. MCP Server receives the call via stdio, queues it as a pending command
4. CE Lua bridge polls HTTP endpoint, receives the command
5. Lua bridge calls CE's firstScan() API
6. Lua bridge POSTs the result back to the HTTP endpoint
7. MCP Server resolves the pending promise, returns result to Copilot
8. Copilot tells the user: "Found 48,291 results"
```

### Why HTTP Polling?

Cheat Engine's Lua environment doesn't include `LuaSocket` by default, so raw TCP isn't available out of the box. However, CE does ship `getInternet()` which provides synchronous HTTP. The bridge uses HTTP POST polling with a 250ms long-poll window — low latency without hammering CE's UI thread.

---

## Using with Other MCP Clients

### Claude Desktop

Add to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cheat-engine": {
      "command": "node",
      "args": ["C:/path/to/mcp-cheat-engine/dist/index.js"],
      "env": {
        "CE_BRIDGE_PORT": "5874"
      }
    }
  }
}
```

### Any MCP Client

The server uses **stdio** transport. Launch it with:

```powershell
node dist/index.js
```

It reads JSON-RPC from stdin and writes to stdout, following the [MCP specification](https://modelcontextprotocol.io/).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| *"Cheat Engine bridge is not connected"* | CE hasn't loaded the bridge script | In CE: `Ctrl+Alt+L` → paste `bridge.lua` → **Execute script**. Check console for `[MCP] Hello OK`. |
| *"cannot reach http://127.0.0.1:5874/"* in CE | MCP server isn't running | Ask Copilot any `ce_*` question to spawn it, or run `npm start` manually. |
| *"getInternet() returned nil"* in CE | CE build missing internet object | Reinstall Cheat Engine 7.5+ from [cheatengine.org](https://www.cheatengine.org/). |
| `ce_*` tools not visible in Copilot | VS Code didn't discover `mcp.json` | `Ctrl+Shift+P` → **Developer: Reload Window**. Ensure you're in **Agent** mode. |
| Tool calls hang / timeout after 15s | Lua script crashed in CE | Re-execute the Lua script. Restart CE if needed. |
| Scans are very slow | Large address space, broad search | Use a specific value type (`int32`, `float`) and `scanOption: exact`. |
| `npm install` fails | Node.js not installed or wrong version | Run `node --version` — must be 20+. Delete `node_modules` and `package-lock.json`, retry. |
| Permission prompt on every tool call | Copilot asking for confirmation | Click **Always allow** instead of **Allow**. |

---

## Daily Workflow

Once set up, your everyday process is:

1. **Open VS Code** at the project folder.
2. **Open Cheat Engine** → `Ctrl+Alt+L` → Execute `bridge.lua`.
3. **Open your target** (game, tutorial, etc.).
4. **Chat with your AI** in Agent mode.

That's it.

---

## Project Structure

```
mcp-cheat-engine/
├── src/
│   ├── index.ts        # Entry point — creates MCP server & bridge
│   ├── ceBridge.ts     # HTTP transport (Node ↔ CE communication)
│   └── tools.ts        # All 20 MCP tool definitions
├── ce-lua/
│   └── bridge.lua      # Lua script to load into Cheat Engine
├── .vscode/
│   └── mcp.json        # Auto-registers server for VS Code
├── package.json
├── tsconfig.json
└── LICENSE
```

---

## Safety & Ethics

- ⚠️ **Single-player / offline use only.** Using memory modification tools on multiplayer or online games violates Terms of Service and can result in bans. Don't do it.
- 🔒 **Local only.** The bridge listens on `127.0.0.1` — nothing is exposed to the network.
- 🧠 **Be cautious with writes.** Memory writes (`ce_write_memory`, `ce_auto_assemble`) can crash the target process. Instruct the AI to **describe changes before performing them**.
- 📚 **Educational tool.** This project is intended for learning reverse engineering concepts on safe targets like Cheat Engine's bundled tutorial.

---

## Contributing

Contributions are welcome! Some ideas:

- **New tools** — "Find what writes to this address", breakpoints, structure dissection
- **CE plugin mode** — Auto-load the bridge without manual paste
- **Cross-platform** — Test on Linux/macOS (CE has cross-platform builds)

```powershell
# Development workflow
npm install
npm run dev     # watches & recompiles TypeScript on save
```

After changing TypeScript: restart the MCP server in VS Code (`Ctrl+Shift+P` → **MCP: List Servers** → `cheat-engine` → **Restart**), then re-execute `bridge.lua` in CE.

---

## License

[MIT](LICENSE)
