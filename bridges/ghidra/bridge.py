# re-mcp — Ghidra Bridge Script
# ============================================================
# Run this inside Ghidra's Script Manager (or via headless mode).
#
# Prerequisites:
#   - Ghidra 10.x+ with Python scripting enabled
#   - A program loaded in the CodeBrowser
#
# The script starts an HTTP server on 127.0.0.1:5876 that polls
# the re-mcp Node.js server for commands. Same protocol as the
# Cheat Engine Lua bridge.
# ============================================================

import json
import time
import threading
try:
    from urllib.request import urlopen, Request
    from urllib.error import URLError
except ImportError:
    from urllib2 import urlopen, Request, URLError

# Ghidra imports (available in Ghidra's scripting environment)
from ghidra.app.decompiler import DecompInterface
from ghidra.program.model.listing import CodeUnit
from ghidra.util.task import ConsoleTaskMonitor
import ghidra.program.model.symbol.RefType as RefType

URL = "http://127.0.0.1:5876/"
POLL_INTERVAL = 0.25  # seconds

# ---- HTTP helper ----
def http_post(url, data):
    """POST JSON to the MCP server."""
    body = json.dumps(data).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        resp = urlopen(req, timeout=5)
        return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return None

# ---- Address helpers ----
def parse_addr(a):
    """Convert string/int to Ghidra Address."""
    if a is None:
        return None
    if isinstance(a, (int, float)):
        return currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(int(a))
    s = str(a).strip()
    if s.startswith("0x") or s.startswith("0X"):
        s = s[2:]
    try:
        return currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(int(s, 16))
    except:
        # Try as symbol
        syms = currentProgram.getSymbolTable().getGlobalSymbols(s)
        if syms and len(syms) > 0:
            return syms[0].getAddress()
    return None

def addr_str(addr):
    """Format an address as hex string."""
    return str(addr) if addr else None

# ---- Handlers ----
handlers = {}

def handler(name):
    def decorator(fn):
        handlers[name] = fn
        return fn
    return decorator

@handler("status")
def h_status(params):
    prog = currentProgram
    return {
        "program": prog.getName() if prog else None,
        "language": str(prog.getLanguage().getLanguageID()) if prog else None,
        "compiler": str(prog.getCompilerSpec().getCompilerSpecID()) if prog else None,
        "imageBase": str(prog.getImageBase()) if prog else None,
    }

@handler("ping")
def h_ping(params):
    return {"pong": True}

@handler("list_functions")
def h_list_functions(params):
    filt = (params.get("filter") or "").lower()
    offset = int(params.get("offset", 0))
    limit = int(params.get("limit", 100))
    fm = currentProgram.getFunctionManager()
    funcs = []
    idx = 0
    for f in fm.getFunctions(True):
        name = f.getName()
        if filt and filt not in name.lower():
            continue
        if idx < offset:
            idx += 1
            continue
        if len(funcs) >= limit:
            break
        funcs.append({
            "name": name,
            "address": str(f.getEntryPoint()),
            "size": f.getBody().getNumAddresses(),
            "signature": str(f.getSignature()),
        })
        idx += 1
    return {"functions": funcs, "total": fm.getFunctionCount()}

@handler("decompile")
def h_decompile(params):
    target = params.get("function")
    func = None
    # Try as function name first
    if isinstance(target, str) and not all(c in "0123456789abcdefABCDEF" for c in target.replace("0x", "")):
        fm = currentProgram.getFunctionManager()
        for f in fm.getFunctions(True):
            if f.getName() == target:
                func = f
                break
    # Try as address
    if func is None:
        addr = parse_addr(target)
        if addr:
            func = currentProgram.getFunctionManager().getFunctionAt(addr)
            if func is None:
                func = currentProgram.getFunctionManager().getFunctionContaining(addr)
    if func is None:
        return None, "Function not found: " + str(target)
    decomp = DecompInterface()
    decomp.openProgram(currentProgram)
    result = decomp.decompileFunction(func, 30, ConsoleTaskMonitor())
    if result and result.decompileCompleted():
        return {
            "function": func.getName(),
            "address": str(func.getEntryPoint()),
            "code": result.getDecompiledFunction().getC(),
        }
    return None, "Decompilation failed for " + func.getName()

@handler("disassemble")
def h_disassemble(params):
    addr = parse_addr(params.get("address"))
    if not addr:
        return None, "Bad address"
    count = int(params.get("count", 20))
    listing = currentProgram.getListing()
    instructions = []
    cur = addr
    for _ in range(count):
        instr = listing.getInstructionAt(cur)
        if instr is None:
            break
        instructions.append({
            "address": str(cur),
            "bytes": " ".join("%02X" % b for b in instr.getBytes()),
            "mnemonic": instr.getMnemonicString(),
            "operands": str(instr.getDefaultOperandRepresentation(0)) if instr.getNumOperands() > 0 else "",
            "raw": str(instr),
        })
        cur = instr.getFallThrough() or cur.add(instr.getLength())
    return {"instructions": instructions}

@handler("get_xrefs_to")
def h_get_xrefs_to(params):
    addr = parse_addr(params.get("address"))
    if not addr:
        return None, "Bad address"
    refs = []
    for ref in currentProgram.getReferenceManager().getReferencesTo(addr):
        refs.append({
            "from": str(ref.getFromAddress()),
            "type": str(ref.getReferenceType()),
        })
    return {"xrefs": refs, "count": len(refs)}

@handler("get_xrefs_from")
def h_get_xrefs_from(params):
    addr = parse_addr(params.get("address"))
    if not addr:
        return None, "Bad address"
    refs = []
    for ref in currentProgram.getReferenceManager().getReferencesFrom(addr):
        refs.append({
            "to": str(ref.getToAddress()),
            "type": str(ref.getReferenceType()),
        })
    return {"xrefs": refs, "count": len(refs)}

@handler("rename")
def h_rename(params):
    addr = parse_addr(params.get("address"))
    if not addr:
        return None, "Bad address"
    new_name = params.get("newName", "")
    func = currentProgram.getFunctionManager().getFunctionAt(addr)
    if func:
        func.setName(new_name, ghidra.program.model.symbol.SourceType.USER_DEFINED)
        return {"ok": True, "address": str(addr), "newName": new_name}
    sym = currentProgram.getSymbolTable().getPrimarySymbol(addr)
    if sym:
        sym.setName(new_name, ghidra.program.model.symbol.SourceType.USER_DEFINED)
        return {"ok": True, "address": str(addr), "newName": new_name}
    return None, "No function or symbol at " + str(addr)

@handler("add_comment")
def h_add_comment(params):
    addr = parse_addr(params.get("address"))
    if not addr:
        return None, "Bad address"
    comment = params.get("comment", "")
    comment_type_map = {
        "eol": CodeUnit.EOL_COMMENT,
        "pre": CodeUnit.PRE_COMMENT,
        "post": CodeUnit.POST_COMMENT,
        "plate": CodeUnit.PLATE_COMMENT,
    }
    ct = comment_type_map.get(params.get("type", "eol"), CodeUnit.EOL_COMMENT)
    cu = currentProgram.getListing().getCodeUnitAt(addr)
    if cu:
        cu.setComment(ct, comment)
        return {"ok": True}
    return None, "No code unit at " + str(addr)

@handler("list_strings")
def h_list_strings(params):
    filt = (params.get("filter") or "").lower()
    limit = int(params.get("limit", 100))
    strings = []
    for data in currentProgram.getListing().getDefinedData(True):
        if data.hasStringValue():
            val = str(data.getValue())
            if filt and filt not in val.lower():
                continue
            strings.append({"address": str(data.getAddress()), "value": val})
            if len(strings) >= limit:
                break
    return {"strings": strings}

@handler("list_imports")
def h_list_imports(params):
    filt = (params.get("filter") or "").lower()
    imports = []
    st = currentProgram.getSymbolTable()
    for sym in st.getExternalSymbols():
        name = sym.getName()
        if filt and filt not in name.lower():
            continue
        imports.append({
            "name": name,
            "library": str(sym.getParentNamespace()),
            "address": str(sym.getAddress()),
        })
    return {"imports": imports}

@handler("list_exports")
def h_list_exports(params):
    filt = (params.get("filter") or "").lower()
    exports = []
    st = currentProgram.getSymbolTable()
    for sym in st.getSymbolIterator():
        if sym.isExternalEntryPoint():
            name = sym.getName()
            if filt and filt not in name.lower():
                continue
            exports.append({"name": name, "address": str(sym.getAddress())})
    return {"exports": exports}

@handler("list_segments")
def h_list_segments(params):
    blocks = []
    for block in currentProgram.getMemory().getBlocks():
        blocks.append({
            "name": block.getName(),
            "start": str(block.getStart()),
            "end": str(block.getEnd()),
            "size": block.getSize(),
            "read": block.isRead(),
            "write": block.isWrite(),
            "execute": block.isExecute(),
        })
    return {"segments": blocks}

@handler("eval")
def h_eval(params):
    code = params.get("code", "")
    if not code:
        return None, "Empty code"
    loc = {}
    exec(code, {"currentProgram": currentProgram, "monitor": monitor, "state": state}, loc)
    result = loc.get("result", None)
    return {"ok": True, "result": str(result) if result is not None else None}

# ---- Polling loop ----
def poll_loop():
    """Continuously poll the MCP server for commands."""
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
    print("[re-mcp] Start it by asking your AI assistant any re_* question.")
else:
    print("[re-mcp] Connected! Program: %s" % (currentProgram.getName() if currentProgram else "none"))
    print("[re-mcp] Handlers: %s" % ", ".join(sorted(handlers.keys())))
    # Run polling in a background thread so Ghidra UI stays responsive
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    print("[re-mcp] Bridge ready (polling in background thread).")
