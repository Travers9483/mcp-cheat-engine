# re-mcp

> **One MCP server. Every RE tool. One conversation.**

Let your AI assistant drive **Cheat Engine**, **x64dbg**, and **Ghidra** — scan memory, debug processes, decompile functions, and more — all through natural language.

```
AI Assistant ── MCP / stdio ──► re-mcp (Node.js) ──┬── HTTP poll ──► Cheat Engine  (Lua bridge)
  (Copilot / Claude)                                ├── HTTP poll ──► x64dbg       (Python bridge)
                                                    └── HTTP poll ──► Ghidra       (Python bridge)
```

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes the full feature set of multiple reverse engineering tools as AI-callable tools. Works with any MCP-compatible client — **GitHub Copilot Chat** in VS Code, **Claude Desktop**, or any other MCP host.

## Why re-mcp?

Every existing MCP project for RE tools is **tool-specific** — separate repos, separate installs, separate configs. `re-mcp` is the first **unified** server:

- **One install** — one `npm install` gives you access to all backends
- **Cross-tool workflows** — find an address in Cheat Engine, hit a breakpoint in x64dbg, decompile in Ghidra
- **Consistent architecture** — every bridge uses the same HTTP poll protocol
- **Modular** — only start the tools you need; each bridge connects independently

---

## Features

**55+ tools** available to the AI, covering the complete reverse engineering workflow:

| Category | Prefix | Tools | What they do |
|---|---|---|---|
| **Cheat Engine** | `ce_*` | 22 tools | Memory scanning, read/write, disassembly, address list, speed hack, auto-assembler, Lua eval |
| **x64dbg** | `x64_*` | 22 tools | Process attach, breakpoints, stepping, registers, memory, disassembly, modules, stack trace, labels, comments |
| **Ghidra** | `ghidra_*` | 12 tools | Function listing, decompilation, disassembly, cross-references, renaming, comments, strings, imports/exports, segments |
| **Unified** | `re_*` | 1 tool | `re_status` — shows which backends are connected |

---

## Quick Start

### 1. Clone & build

```powershell
git clone https://github.com/Travers9483/mcp-cheat-engine.git
cd mcp-cheat-engine
npm install
npm run build
```

### 2. Configure your AI client

<details>
<summary><strong>VS Code (GitHub Copilot Chat)</strong></summary>

The repo includes `.vscode/mcp.json` — it works automatically when you open the project.

Or add to your user-level `settings.json`:

```json
"mcp": {
  "servers": {
    "re-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/re-mcp/dist/index.js"],
      "env": {
        "CE_BRIDGE_PORT": "5874",
        "X64_BRIDGE_PORT": "5875",
        "GHIDRA_BRIDGE_PORT": "5876"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "re-mcp": {
      "command": "node",
      "args": ["C:/path/to/re-mcp/dist/index.js"],
      "env": {
        "CE_BRIDGE_PORT": "5874",
        "X64_BRIDGE_PORT": "5875",
        "GHIDRA_BRIDGE_PORT": "5876"
      }
    }
  }
}
```
</details>

### 3. Connect your tools

Each tool needs its bridge script running. You only need to start the tools you want to use:

#### Cheat Engine
1. Open Cheat Engine
2. Press **Ctrl + Alt + L** to open the Lua console
3. Paste the contents of `bridges/cheat-engine/bridge.lua`
4. Click **Execute script**

#### x64dbg
1. Open x64dbg
2. Ensure the Python plugin (`x64dbgpy`) is installed
3. Load `bridges/x64dbg/bridge.py` via the Script tab

#### Ghidra
1. Open Ghidra and load a binary in the CodeBrowser
2. Open **Script Manager** (Window → Script Manager)
3. Run `bridges/ghidra/bridge.py`

### 4. Start talking

Once the MCP server is active and at least one bridge is connected:

```
You: "What tools are connected?"
AI:  → calls re_status → "Cheat Engine and Ghidra are connected"

You: "List all functions containing 'Player' in Ghidra"
AI:  → calls ghidra_list_functions with filter "Player"

You: "Decompile the PlayerHealth function"
AI:  → calls ghidra_decompile

You: "Scan for the value 100 in Cheat Engine"
AI:  → calls ce_scan_first with value 100
```

---

## Architecture

### How it works

`re-mcp` runs as a single Node.js process that:

1. Connects to your AI client via **MCP over stdio**
2. Opens **three HTTP servers** (one per backend) on localhost
3. Each tool's bridge script **polls** its HTTP server for commands
4. Results flow back through the same HTTP channel

```
┌─────────────┐     stdio      ┌──────────────────────────────────────────┐
│ AI Assistant │ ◄════════════► │              re-mcp (Node.js)            │
│ (Copilot,    │    MCP JSON    │                                          │
│  Claude)     │                │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
└─────────────┘                │  │ CE Bridge │ │ x64 Brg  │ │ Ghidra   │ │
                               │  │ :5874     │ │ :5875    │ │ :5876    │ │
                               │  └────┬─────┘ └────┬─────┘ └────┬─────┘ │
                               └───────┼────────────┼────────────┼────────┘
                                       │ HTTP poll  │ HTTP poll  │ HTTP poll
                                 ┌─────▼─────┐ ┌───▼──────┐ ┌──▼───────┐
                                 │   Cheat    │ │  x64dbg  │ │  Ghidra  │
                                 │   Engine   │ │          │ │          │
                                 │  (Lua)     │ │ (Python) │ │ (Python) │
                                 └────────────┘ └──────────┘ └──────────┘
```

### Bridge protocol

All bridges use the same simple HTTP protocol:

| Action | Direction | Payload |
|---|---|---|
| `hello` | Bridge → Server | `{ action: "hello" }` |
| `poll` | Bridge → Server | `{ action: "poll" }` → `{ id, method, params }` |
| `reply` | Bridge → Server | `{ action: "reply", id, result }` |

---

## Configuration

All settings are via environment variables:

| Variable | Default | Description |
|---|---|---|
| `CE_BRIDGE_PORT` | `5874` | HTTP port for Cheat Engine bridge |
| `X64_BRIDGE_PORT` | `5875` | HTTP port for x64dbg bridge |
| `GHIDRA_BRIDGE_PORT` | `5876` | HTTP port for Ghidra bridge |
| `RE_BRIDGE_HOST` | `127.0.0.1` | Bind address for all bridges |

---

## Tool Reference

### Unified Tools
| Tool | Description |
|---|---|
| `re_status` | Show connection status for all backends |

### Cheat Engine Tools (`ce_*`)
| Tool | Description |
|---|---|
| `ce_status` | Connection status and attached process info |
| `ce_list_processes` | List all visible processes |
| `ce_attach_process` | Attach to a process by PID or name |
| `ce_read_memory` | Read a typed value from memory |
| `ce_write_memory` | Write a typed value to memory |
| `ce_read_bytes` | Read raw hex bytes |
| `ce_write_bytes` | Write raw hex bytes |
| `ce_disassemble` | Disassemble instructions at address |
| `ce_scan_first` | Start a new memory scan |
| `ce_scan_next` | Narrow the current scan |
| `ce_scan_results` | Get results from current scan |
| `ce_scan_reset` | Reset the scan state |
| `ce_list_entries` | List address-list entries |
| `ce_add_entry` | Add an entry to the address list |
| `ce_set_entry_value` | Set value of an address-list entry |
| `ce_freeze_entry` | Freeze/unfreeze an entry |
| `ce_auto_assemble` | Run Auto-Assembler script |
| `ce_resolve_symbol` | Resolve a symbol to absolute address |
| `ce_set_speedhack` | Enable speed hack |
| `ce_list_windows` | List CE's open windows |
| `ce_inspect_form` | Dump a CE form's control tree |
| `ce_get_control` / `ce_set_control` / `ce_click_control` | UI automation |
| `ce_eval_lua` | Execute arbitrary Lua code |

### x64dbg Tools (`x64_*`)
| Tool | Description |
|---|---|
| `x64_status` | Connection status and debuggee info |
| `x64_open` | Open an executable for debugging |
| `x64_attach` | Attach to a process by PID |
| `x64_detach` | Detach from process |
| `x64_run` / `x64_pause` | Resume or pause execution |
| `x64_step_into` / `x64_step_over` / `x64_step_out` | Stepping |
| `x64_get_registers` / `x64_set_register` | Register access |
| `x64_read_memory` / `x64_write_memory` | Memory access |
| `x64_disassemble` | Disassemble at address |
| `x64_set_breakpoint` / `x64_remove_breakpoint` / `x64_list_breakpoints` | Breakpoint management |
| `x64_modules` | List loaded modules/DLLs |
| `x64_stack_trace` | Get call stack |
| `x64_add_comment` / `x64_add_label` | Annotations |
| `x64_command` | Execute arbitrary x64dbg command |

### Ghidra Tools (`ghidra_*`)
| Tool | Description |
|---|---|
| `ghidra_status` | Connection status and loaded program info |
| `ghidra_list_functions` | List all functions (with filter) |
| `ghidra_decompile` | Decompile a function to C pseudocode |
| `ghidra_disassemble` | Disassemble at address |
| `ghidra_get_xrefs_to` / `ghidra_get_xrefs_from` | Cross-references |
| `ghidra_rename` | Rename function or symbol |
| `ghidra_add_comment` | Add comment at address |
| `ghidra_list_strings` | List defined strings |
| `ghidra_list_imports` / `ghidra_list_exports` | Import/export tables |
| `ghidra_list_segments` | List memory segments |
| `ghidra_eval` | Execute arbitrary Python in Ghidra |

---

## Roadmap

- [x] **Cheat Engine** — Live memory scanning, read/write, disassembly
- [x] **x64dbg** — Live debugging, breakpoints, stepping, registers
- [x] **Ghidra** — Static analysis, decompilation, cross-references
- [ ] **IDA Pro** — Static analysis (IDAPython bridge)
- [ ] **ReClass.NET** — Structure/class editing

---

## How it compares

| Feature | re-mcp | BinaryAnalysisMCPs | x64dbg-automate | ghidra-mcp |
|---|---|---|---|---|
| Unified server | ✅ One install | ❌ 3 separate servers | ❌ x64dbg only | ❌ Ghidra only |
| Cheat Engine | ✅ | ❌ | ❌ | ❌ |
| x64dbg | ✅ | ✅ | ✅ | ❌ |
| Ghidra | ✅ | ❌ | ❌ | ✅ |
| Cross-tool workflows | ✅ | ❌ | ❌ | ❌ |
| Language | TypeScript | Python | Python/C++ | Java/Python |
| AI client support | Any MCP client | Any MCP client | Any MCP client | Any MCP client |

---

## Contributing

PRs, bug reports, and new bridge implementations are welcome! If you've built a bridge for another tool (IDA Pro, Binary Ninja, Frida, etc.), we'd love to integrate it.

## License

[MIT](LICENSE)
