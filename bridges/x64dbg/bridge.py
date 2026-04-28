# re-mcp — x64dbg Bridge Script
# ============================================================
# Load this script in x64dbg via the Python scripting interface.
#
# Prerequisites:
#   - x64dbg with Python plugin (x64dbgpy) installed
#   - OR run standalone with x64dbg-automate
#
# The script polls the re-mcp Node.js server on 127.0.0.1:5875
# for commands, executes them using x64dbg's Python API, and
# posts results back. Same protocol as CE and Ghidra bridges.
# ============================================================

import json
import time
import threading
try:
    from urllib.request import urlopen, Request
    from urllib.error import URLError
except ImportError:
    from urllib2 import urlopen, Request, URLError

# Try to import x64dbg Python bindings
try:
    import x64dbg
    HAS_X64DBG = True
except ImportError:
    HAS_X64DBG = False
    print("[re-mcp] WARNING: x64dbg module not found. Running in standalone mode.")

URL = "http://127.0.0.1:5875/"
POLL_INTERVAL = 0.25

# ---- HTTP helper ----
def http_post(url, data):
    body = json.dumps(data).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        resp = urlopen(req, timeout=5)
        return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None

# ---- Helpers ----
def parse_addr(a):
    """Convert string/int to integer address."""
    if a is None:
        return None
    if isinstance(a, (int, float)):
        return int(a)
    s = str(a).strip()
    if s.startswith("0x") or s.startswith("0X"):
        s = s[2:]
    try:
        return int(s, 16)
    except ValueError:
        pass
    # Try as x64dbg expression
    if HAS_X64DBG:
        try:
            return x64dbg.DbgValFromString(s)
        except:
            pass
    return None

def read_mem(addr, size):
    """Read bytes from debuggee memory."""
    if HAS_X64DBG:
        data = x64dbg.Read(addr, size)
        if data:
            return list(data)
    return []

def write_mem(addr, data):
    """Write bytes to debuggee memory."""
    if HAS_X64DBG:
        x64dbg.Write(addr, bytes(data))

# ---- Handlers ----
handlers = {}

def handler(name):
    def decorator(fn):
        handlers[name] = fn
        return fn
    return decorator

@handler("status")
def h_status(params):
    if not HAS_X64DBG:
        return {"mode": "standalone", "debuggee": None}
    return {
        "debugging": x64dbg.DbgIsDebugging(),
        "running": x64dbg.DbgIsRunning(),
    }

@handler("ping")
def h_ping(params):
    return {"pong": True}

@handler("open")
def h_open(params):
    path = params.get("path", "")
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("init \"%s\"" % path)
        return {"ok": True, "path": path}
    return None, "x64dbg not available"

@handler("attach")
def h_attach(params):
    pid = int(params.get("pid", 0))
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("attach %d" % pid)
        return {"ok": True, "pid": pid}
    return None, "x64dbg not available"

@handler("detach")
def h_detach(params):
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("detach")
        return {"ok": True}
    return None, "x64dbg not available"

@handler("run")
def h_run(params):
    addr = params.get("address")
    if HAS_X64DBG:
        if addr:
            a = parse_addr(addr)
            x64dbg.DbgCmdExecDirect("bp %X, ss" % a)
            x64dbg.DbgCmdExecDirect("run")
        else:
            x64dbg.DbgCmdExecDirect("run")
        return {"ok": True}
    return None, "x64dbg not available"

@handler("pause")
def h_pause(params):
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("pause")
        return {"ok": True}
    return None, "x64dbg not available"

@handler("step_into")
def h_step_into(params):
    count = int(params.get("count", 1))
    if HAS_X64DBG:
        for _ in range(count):
            x64dbg.DbgCmdExecDirect("sti")
        return {"ok": True, "count": count}
    return None, "x64dbg not available"

@handler("step_over")
def h_step_over(params):
    count = int(params.get("count", 1))
    if HAS_X64DBG:
        for _ in range(count):
            x64dbg.DbgCmdExecDirect("sto")
        return {"ok": True, "count": count}
    return None, "x64dbg not available"

@handler("step_out")
def h_step_out(params):
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("rtr")
        return {"ok": True}
    return None, "x64dbg not available"

@handler("get_registers")
def h_get_registers(params):
    if not HAS_X64DBG:
        return None, "x64dbg not available"
    regs = {}
    for name in ["RAX","RBX","RCX","RDX","RSI","RDI","RBP","RSP","RIP",
                  "R8","R9","R10","R11","R12","R13","R14","R15","RFLAGS"]:
        try:
            regs[name] = "%X" % x64dbg.DbgValFromString(name)
        except:
            pass
    return {"registers": regs}

@handler("set_register")
def h_set_register(params):
    reg = params.get("register", "")
    val = parse_addr(params.get("value"))
    if HAS_X64DBG and val is not None:
        x64dbg.DbgCmdExecDirect("set %s, %X" % (reg, val))
        return {"ok": True, "register": reg, "value": "%X" % val}
    return None, "x64dbg not available or bad value"

@handler("read_memory")
def h_read_memory(params):
    addr = parse_addr(params.get("address"))
    size = int(params.get("size", 64))
    if addr is None:
        return None, "Bad address"
    data = read_mem(addr, size)
    hex_str = " ".join("%02X" % b for b in data)
    return {"address": "%X" % addr, "size": size, "hex": hex_str}

@handler("write_memory")
def h_write_memory(params):
    addr = parse_addr(params.get("address"))
    hex_str = params.get("hex", "")
    if addr is None:
        return None, "Bad address"
    data = []
    for h in hex_str.replace(" ", ""):
        if len(h) == 2:
            data.append(int(h, 16))
    # parse hex pairs
    import re
    data = [int(h, 16) for h in re.findall(r'[0-9a-fA-F]{2}', hex_str)]
    write_mem(addr, data)
    return {"ok": True, "address": "%X" % addr, "size": len(data)}

@handler("disassemble")
def h_disassemble(params):
    addr = parse_addr(params.get("address"))
    count = int(params.get("count", 20))
    if addr is None and HAS_X64DBG:
        addr = x64dbg.DbgValFromString("RIP")
    if addr is None:
        return None, "Bad address"
    instructions = []
    if HAS_X64DBG:
        cur = addr
        for _ in range(count):
            result = x64dbg.DbgDisasmAt(cur)
            if result:
                instructions.append({
                    "address": "%X" % cur,
                    "instruction": result,
                })
                size = x64dbg.DbgGetInstrSize(cur)
                if size <= 0:
                    break
                cur += size
            else:
                break
    return {"instructions": instructions}

@handler("set_breakpoint")
def h_set_breakpoint(params):
    addr = parse_addr(params.get("address"))
    if addr is None:
        return None, "Bad address"
    singleshot = params.get("singleshot", False)
    if HAS_X64DBG:
        if singleshot:
            x64dbg.DbgCmdExecDirect("bp %X, ss" % addr)
        else:
            x64dbg.DbgCmdExecDirect("bp %X" % addr)
        return {"ok": True, "address": "%X" % addr}
    return None, "x64dbg not available"

@handler("remove_breakpoint")
def h_remove_breakpoint(params):
    addr = parse_addr(params.get("address"))
    if addr is None:
        return None, "Bad address"
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("bc %X" % addr)
        return {"ok": True}
    return None, "x64dbg not available"

@handler("list_breakpoints")
def h_list_breakpoints(params):
    if HAS_X64DBG:
        # Use command to list breakpoints
        x64dbg.DbgCmdExecDirect("bplist")
        return {"ok": True, "note": "Breakpoint list shown in x64dbg log"}
    return None, "x64dbg not available"

@handler("modules")
def h_modules(params):
    if not HAS_X64DBG:
        return None, "x64dbg not available"
    # Get module list via command
    mods = []
    # x64dbg Python API for modules
    base = x64dbg.DbgValFromString("mod.main()")
    mods.append({"name": "main", "base": "%X" % base if base else "unknown"})
    return {"modules": mods, "note": "Use x64_command with 'modlist' for full list"}

@handler("stack_trace")
def h_stack_trace(params):
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("k")
        return {"ok": True, "note": "Stack trace shown in x64dbg log"}
    return None, "x64dbg not available"

@handler("add_comment")
def h_add_comment(params):
    addr = parse_addr(params.get("address"))
    comment = params.get("comment", "")
    if addr is None:
        return None, "Bad address"
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect('commentset %X, "%s"' % (addr, comment.replace('"', "'")))
        return {"ok": True}
    return None, "x64dbg not available"

@handler("add_label")
def h_add_label(params):
    addr = parse_addr(params.get("address"))
    label = params.get("label", "")
    if addr is None:
        return None, "Bad address"
    if HAS_X64DBG:
        x64dbg.DbgCmdExecDirect("labelset %X, %s" % (addr, label))
        return {"ok": True}
    return None, "x64dbg not available"

@handler("command")
def h_command(params):
    cmd = params.get("command", "")
    if not cmd:
        return None, "Empty command"
    if HAS_X64DBG:
        result = x64dbg.DbgCmdExecDirect(cmd)
        return {"ok": True, "command": cmd, "result": result}
    return None, "x64dbg not available"

# ---- Polling loop ----
def poll_loop():
    while True:
        try:
            resp = http_post(URL, {"action": "poll"})
            if resp and "method" in resp:
                method = resp["method"]
                req_id = resp["id"]
                params = resp.get("params", {})
                h = handlers.get(method)
                if not h:
                    http_post(URL, {"action": "reply", "id": req_id, "error": "unknown method: " + method})
                else:
                    try:
                        result = h(params)
                        if isinstance(result, tuple) and len(result) == 2 and result[0] is None:
                            http_post(URL, {"action": "reply", "id": req_id, "error": result[1]})
                        else:
                            http_post(URL, {"action": "reply", "id": req_id, "result": result})
                    except Exception as e:
                        http_post(URL, {"action": "reply", "id": req_id, "error": str(e)})
        except Exception:
            pass
        time.sleep(POLL_INTERVAL)

# ---- Main ----
print("[re-mcp] Connecting to %s ..." % URL)
hello = http_post(URL, {"action": "hello"})
if not hello:
    print("[re-mcp] ERROR: Cannot reach %s. Is the MCP server running?" % URL)
else:
    print("[re-mcp] Connected to MCP server.")
    print("[re-mcp] x64dbg API available: %s" % HAS_X64DBG)
    print("[re-mcp] Handlers: %s" % ", ".join(sorted(handlers.keys())))
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    print("[re-mcp] Bridge ready (polling in background thread).")
