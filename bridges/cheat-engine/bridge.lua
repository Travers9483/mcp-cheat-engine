--[[
  MCP Cheat Engine — Lua Bridge (HTTP version, no LuaSocket required)
  --------------------------------------------------------------------
  Paste this script into:
      Cheat Engine -> Table -> Show Cheat Table Lua Script  (Ctrl+Alt+L)
  then press "Execute script".

  How it works:
    Every POLL_MS milliseconds we POST {"action":"poll"} to the local MCP
    server. If the server returns a command, we execute it and POST the
    result back. Uses Cheat Engine's bundled getInternet() — works on a
    plain CE 7.x install with no extra dependencies.
--]]

local URL = "http://127.0.0.1:5874/"
-- Poll interval. The server long-polls for ~250ms, so 250ms here means we
-- block CE's UI thread on a sync HTTP call ~once per 250ms instead of constantly.
-- Lower = faster command pickup but more UI stutter. 250ms is the sweet spot.
local POLL_MS = 250

------------------------------------------------------------
-- Stop any previous instance
------------------------------------------------------------
if MCP_BRIDGE and MCP_BRIDGE.timer then
  pcall(function() MCP_BRIDGE.timer.destroy() end)
end
MCP_BRIDGE = { busy = false }

------------------------------------------------------------
-- HTTP helper (uses CE's bundled internet object)
------------------------------------------------------------
local internet = getInternet()
if not internet then
  showMessage("MCP bridge: getInternet() returned nil. Your Cheat Engine build is missing the Internet object.")
  return
end

local function http_post(url, body)
  -- internet.postURL signature: postURL(url, postdata)
  -- body is a query string OR raw; CE sends it as application/x-www-form-urlencoded.
  -- We pass JSON; the Node server parses the raw body regardless of content-type.
  local ok, result = pcall(function() return internet.postURL(url, body or "") end)
  if not ok then return nil, tostring(result) end
  return result
end

------------------------------------------------------------
-- Tiny JSON encoder/decoder
------------------------------------------------------------
local function json_encode(v)
  local t = type(v)
  if t == "nil" then return "null"
  elseif t == "boolean" then return v and "true" or "false"
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    return tostring(v)
  elseif t == "string" then
    return '"'..v:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r'):gsub('\t','\\t'):gsub('[%z\1-\31]', function(c) return string.format('\\u%04x', string.byte(c)) end)..'"'
  elseif t == "table" then
    local n = 0; for _ in pairs(v) do n = n + 1 end
    local isArr = (#v == n)
    if isArr then
      local parts = {}
      for i = 1, #v do parts[#parts+1] = json_encode(v[i]) end
      return "["..table.concat(parts, ",").."]"
    else
      local parts = {}
      for k, val in pairs(v) do
        parts[#parts+1] = json_encode(tostring(k))..":"..json_encode(val)
      end
      return "{"..table.concat(parts, ",").."}"
    end
  end
  return "null"
end

local function json_decode(s)
  if not s or s == "" then return nil end
  local pos = 1
  local function skip_ws()
    while pos <= #s do
      local c = s:sub(pos,pos)
      if c == " " or c == "\t" or c == "\n" or c == "\r" then pos = pos + 1 else break end
    end
  end
  local parse_value
  local function parse_string()
    pos = pos + 1
    local out = {}
    while pos <= #s do
      local c = s:sub(pos,pos)
      if c == '"' then pos = pos + 1; return table.concat(out)
      elseif c == "\\" then
        local nxt = s:sub(pos+1,pos+1)
        if nxt == "n" then out[#out+1] = "\n"
        elseif nxt == "t" then out[#out+1] = "\t"
        elseif nxt == "r" then out[#out+1] = "\r"
        elseif nxt == '"' then out[#out+1] = '"'
        elseif nxt == "\\" then out[#out+1] = "\\"
        elseif nxt == "/" then out[#out+1] = "/"
        elseif nxt == "u" then
          local hex = s:sub(pos+2, pos+5)
          out[#out+1] = string.char(tonumber(hex,16) % 256)
          pos = pos + 4
        else out[#out+1] = nxt end
        pos = pos + 2
      else out[#out+1] = c; pos = pos + 1 end
    end
    error("unterminated string")
  end
  local function parse_number()
    local s2 = s:sub(pos)
    local num = s2:match("^%-?%d+%.?%d*[eE]?[%+%-]?%d*")
    pos = pos + #num
    return tonumber(num)
  end
  local function parse_array()
    pos = pos + 1
    local arr = {}
    skip_ws()
    if s:sub(pos,pos) == "]" then pos = pos + 1; return arr end
    while true do
      arr[#arr+1] = parse_value()
      skip_ws()
      local c = s:sub(pos,pos)
      if c == "," then pos = pos + 1; skip_ws()
      elseif c == "]" then pos = pos + 1; return arr
      else error("expected , or ]") end
    end
  end
  local function parse_object()
    pos = pos + 1
    local obj = {}
    skip_ws()
    if s:sub(pos,pos) == "}" then pos = pos + 1; return obj end
    while true do
      skip_ws()
      local key = parse_string()
      skip_ws()
      if s:sub(pos,pos) ~= ":" then error("expected :") end
      pos = pos + 1
      obj[key] = parse_value()
      skip_ws()
      local c = s:sub(pos,pos)
      if c == "," then pos = pos + 1
      elseif c == "}" then pos = pos + 1; return obj
      else error("expected , or }") end
    end
  end
  parse_value = function()
    skip_ws()
    local c = s:sub(pos,pos)
    if c == '"' then return parse_string()
    elseif c == "{" then return parse_object()
    elseif c == "[" then return parse_array()
    elseif c == "t" then pos = pos + 4; return true
    elseif c == "f" then pos = pos + 5; return false
    elseif c == "n" then pos = pos + 4; return nil
    else return parse_number() end
  end
  return parse_value()
end

------------------------------------------------------------
-- Helpers
------------------------------------------------------------
local function parse_addr(a)
  if type(a) == "number" then return a end
  if type(a) == "string" then
    local n = getAddressSafe(a)
    if n then return n end
    return tonumber(a, 16) or tonumber(a)
  end
  return nil
end

local function bytes_to_hex(t)
  if not t then return nil end
  local out = {}
  for i = 1, #t do out[i] = string.format("%02X", t[i]) end
  return table.concat(out, " ")
end

local function hex_to_bytes(s)
  local t = {}
  for h in s:gmatch("%x%x") do t[#t+1] = tonumber(h, 16) end
  return t
end

------------------------------------------------------------
-- Method handlers
------------------------------------------------------------
local handlers = {}

handlers.ping = function(p)
  return { pong = true, ce_version = getCEVersion and getCEVersion() or "unknown" }
end

handlers.list_processes = function(p)
  local list = {}
  local pl = getProcessList()
  for line in pl:gmatch("[^\r\n]+") do
    local pid_hex, name = line:match("^(%x+)%-(.+)$")
    if pid_hex then
      list[#list+1] = { pid = tonumber(pid_hex, 16), name = name }
    end
  end
  return { processes = list }
end

handlers.attach = function(p)
  local target = p.process
  if type(target) == "number" then openProcess(target) else openProcess(tostring(target)) end
  local pid = getOpenedProcessID()
  if not pid or pid == 0 then return nil, "failed to open process" end
  return { pid = pid, name = (type(process) == "string") and process or tostring(target) }
end

handlers.current_process = function(p)
  return { pid = getOpenedProcessID(), name = (type(process) == "string") and process or nil }
end

local function read_value(addr, vtype)
  if vtype == "byte" or vtype == "uint8" then return readBytes(addr, 1, false) end
  if vtype == "int8" then
    local b = readBytes(addr, 1, false)
    if b and b >= 128 then b = b - 256 end
    return b
  end
  if vtype == "int16"  then return readSmallInteger(addr, true) end
  if vtype == "uint16" then return readSmallInteger(addr, false) end
  if vtype == "int32" or vtype == "int" then return readInteger(addr) end
  if vtype == "int64"  then return readQword(addr) end
  if vtype == "float"  then return readFloat(addr) end
  if vtype == "double" then return readDouble(addr) end
  if vtype == "string" then return readString(addr, 256, false) end
  if vtype == "wstring" then return readString(addr, 256, true) end
  return readInteger(addr)
end

local function write_value(addr, value, vtype)
  if vtype == "int32" or vtype == "int" then return writeInteger(addr, tonumber(value)) end
  if vtype == "int64"  then return writeQword(addr, tonumber(value)) end
  if vtype == "float"  then return writeFloat(addr, tonumber(value)) end
  if vtype == "double" then return writeDouble(addr, tonumber(value)) end
  if vtype == "string" then return writeString(addr, tostring(value), false) end
  if vtype == "wstring" then return writeString(addr, tostring(value), true) end
  return writeInteger(addr, tonumber(value))
end

handlers.read_memory = function(p)
  local addr = parse_addr(p.address); if not addr then return nil, "bad address" end
  local val = read_value(addr, p.type or "int32")
  return { address = string.format("%X", addr), type = p.type or "int32", value = val }
end

handlers.write_memory = function(p)
  local addr = parse_addr(p.address); if not addr then return nil, "bad address" end
  local ok = write_value(addr, p.value, p.type or "int32")
  return { ok = ok and true or false, address = string.format("%X", addr) }
end

handlers.read_bytes = function(p)
  local addr = parse_addr(p.address); if not addr then return nil, "bad address" end
  local n = tonumber(p.size) or 64
  local b = readBytes(addr, n, true)
  return { address = string.format("%X", addr), size = n, hex = bytes_to_hex(b) }
end

handlers.write_bytes = function(p)
  local addr = parse_addr(p.address); if not addr then return nil, "bad address" end
  local b = hex_to_bytes(p.hex or "")
  writeBytes(addr, b)
  return { ok = true, address = string.format("%X", addr), size = #b }
end

handlers.disassemble = function(p)
  local addr = parse_addr(p.address); if not addr then return nil, "bad address" end
  local count = tonumber(p.count) or 10
  local out = {}
  local cur = addr
  for i = 1, count do
    local d = disassemble(cur)
    local addr_s, bytes_s, op_s, extra_s
    if splitDisassembledString then
      addr_s, bytes_s, op_s, extra_s = splitDisassembledString(d)
    end
    out[#out+1] = {
      address = string.format("%X", cur),
      bytes = bytes_s, opcode = op_s, comment = extra_s, raw = d,
    }
    local size = getInstructionSize and getInstructionSize(cur) or 1
    if not size or size <= 0 then break end
    cur = cur + size
  end
  return { instructions = out }
end

------------------------------------------------------------
-- Memory scanning
------------------------------------------------------------
local SCAN
local SCAN_TYPE_MAP = {
  byte = vtByte, int8 = vtByte,
  int16 = vtWord, int32 = vtDword, int = vtDword,
  int64 = vtQword,
  float = vtSingle, double = vtDouble,
  string = vtString, aob = vtByteArray,
}

handlers.scan_first = function(p)
  if SCAN then pcall(function() SCAN.destroy() end); SCAN = nil end
  SCAN = createMemScan()
  SCAN.OnlyOneResult = false
  local vt = SCAN_TYPE_MAP[p.type or "int32"] or vtDword
  local scanOption = ({
    exact = soExactValue, bigger = soBiggerThan, smaller = soSmallerThan,
    between = soValueBetween, unknown = soUnknownValue,
  })[p.scanOption or "exact"] or soExactValue
  SCAN.firstScan(
    scanOption, vt, rtRounded,
    tostring(p.value or ""), tostring(p.value2 or ""),
    0, 0x7FFFFFFFFFFFFFFF,
    "+W-C", fsmAligned, "4",
    p.hex == true, false, false, false
  )
  SCAN.waitTillDone()
  if SCAN._fl then pcall(function() SCAN._fl.destroy() end); SCAN._fl = nil end
  SCAN._fl = createFoundList(SCAN); SCAN._fl.initialize()
  return { count = SCAN._fl.Count }
end

handlers.scan_next = function(p)
  if not SCAN then return nil, "no active scan; call scan_first first" end
  local scanOption = ({
    exact = soExactValue, bigger = soBiggerThan, smaller = soSmallerThan,
    between = soValueBetween, increased = soIncreasedValue,
    decreased = soDecreasedValue, changed = soChangedValue, unchanged = soUnchangedValue,
  })[p.scanOption or "exact"] or soExactValue
  SCAN.nextScan(scanOption, rtRounded, tostring(p.value or ""), tostring(p.value2 or ""), p.hex == true, false, false, false)
  SCAN.waitTillDone()
  if SCAN._fl then pcall(function() SCAN._fl.destroy() end) end
  SCAN._fl = createFoundList(SCAN); SCAN._fl.initialize()
  return { count = SCAN._fl.Count }
end

handlers.scan_results = function(p)
  if not SCAN or not SCAN._fl then return nil, "no scan results" end
  local n = math.min(tonumber(p.limit) or 50, SCAN._fl.Count)
  local results = {}
  for i = 0, n - 1 do
    results[#results+1] = { address = SCAN._fl.Address[i], value = SCAN._fl.Value[i] }
  end
  return { total = SCAN._fl.Count, returned = n, results = results }
end

handlers.scan_reset = function(p)
  if SCAN then
    if SCAN._fl then pcall(function() SCAN._fl.destroy() end) end
    pcall(function() SCAN.destroy() end)
    SCAN = nil
  end
  return { ok = true }
end

------------------------------------------------------------
-- Cheat table entries
------------------------------------------------------------
handlers.list_entries = function(p)
  local al = getAddressList()
  local out = {}
  for i = 0, al.Count - 1 do
    local mr = al.getMemoryRecord(i)
    out[#out+1] = {
      index = i, description = mr.Description, address = mr.AddressString,
      type = mr.Type,
      value = (pcall(function() return mr.Value end)) and mr.Value or nil,
      active = mr.Active,
    }
  end
  return { entries = out }
end

handlers.add_entry = function(p)
  local al = getAddressList()
  local mr = al.createMemoryRecord()
  mr.Description = p.description or "AI added"
  mr.Address = p.address
  if p.type then
    local tmap = { int32 = vtDword, int = vtDword, int64 = vtQword, float = vtSingle, double = vtDouble, byte = vtByte }
    mr.Type = tmap[p.type] or vtDword
  end
  return { ok = true, description = mr.Description, address = mr.AddressString }
end

local function find_entry(al, p)
  if p.description and p.description ~= "" then
    local mr = al.getMemoryRecordByDescription(p.description)
    if mr then return mr end
  end
  if p.index ~= nil then return al.getMemoryRecord(tonumber(p.index)) end
  return nil
end

handlers.set_entry_value = function(p)
  local al = getAddressList()
  local mr = find_entry(al, p)
  if not mr then return nil, "entry not found" end
  mr.Value = tostring(p.value)
  return { ok = true }
end

handlers.freeze_entry = function(p)
  local al = getAddressList()
  local mr = find_entry(al, p)
  if not mr then return nil, "entry not found" end
  mr.Active = (p.frozen ~= false)
  return { ok = true, frozen = mr.Active }
end

handlers.auto_assemble = function(p)
  local script = tostring(p.script or "")
  local ok, err = autoAssemble(script)
  if not ok then return nil, "autoAssemble failed: "..tostring(err) end
  return { ok = true }
end

handlers.resolve_symbol = function(p)
  local addr = getAddressSafe(tostring(p.symbol))
  if not addr then return nil, "could not resolve" end
  return { symbol = p.symbol, address = string.format("%X", addr) }
end

handlers.set_speedhack = function(p)
  speedhack_setSpeed(tonumber(p.speed) or 1.0)
  return { ok = true, speed = tonumber(p.speed) or 1.0 }
end

------------------------------------------------------------
-- UI introspection & automation
------------------------------------------------------------

-- Resolve a control by dotted path: "MainForm.Panel1.btnFirstScan".
-- The first segment is a known root: MainForm, MemoryView, Disassembler,
-- AddressList, ScanForm, or any form name from list_windows.
local function get_root(name)
  if name == "MainForm" then return getMainForm() end
  if name == "MemoryView" then
    return (getMemoryViewForm and getMemoryViewForm()) or nil
  end
  if name == "AddressList" or name == "AddressListForm" then
    return (getAddressList and getAddressList()) or nil
  end
  -- fall back to scanning all forms by Name
  local n = getFormCount and getFormCount() or 0
  for i = 0, n - 1 do
    local f = getForm(i)
    if f and (f.Name == name or f.ClassName == name) then return f end
  end
  return nil
end

local function resolve_control(path)
  if not path or path == "" then return nil, "empty path" end
  local parts = {}
  for seg in tostring(path):gmatch("[^%.]+") do parts[#parts+1] = seg end
  local cur = get_root(parts[1])
  if not cur then return nil, "root not found: "..tostring(parts[1]) end
  for i = 2, #parts do
    local seg = parts[i]
    local nxt
    -- try property access first
    local ok, v = pcall(function() return cur[seg] end)
    if ok and v then nxt = v end
    -- try findComponent
    if not nxt and cur.findComponent then
      local ok2, v2 = pcall(function() return cur.findComponent(seg) end)
      if ok2 then nxt = v2 end
    end
    -- try child by name via ControlCount
    if not nxt and cur.ControlCount then
      for j = 0, cur.ControlCount - 1 do
        local c = cur.Control[j]
        if c and (c.Name == seg) then nxt = c; break end
      end
    end
    if not nxt then return nil, "not found: "..seg.." (under "..table.concat(parts, ".", 1, i-1)..")" end
    cur = nxt
  end
  return cur
end

local function get_prop(obj, name)
  local ok, v = pcall(function() return obj[name] end)
  if ok then return v end
  return nil
end

-- enumerate all top-level forms CE has open
handlers.list_windows = function(p)
  local out = {}
  local n = getFormCount and getFormCount() or 0
  for i = 0, n - 1 do
    local f = getForm(i)
    if f then
      out[#out+1] = {
        index = i,
        name = get_prop(f, "Name"),
        caption = get_prop(f, "Caption"),
        class = get_prop(f, "ClassName"),
        visible = get_prop(f, "Visible"),
        left = get_prop(f, "Left"), top = get_prop(f, "Top"),
        width = get_prop(f, "Width"), height = get_prop(f, "Height"),
      }
    end
  end
  -- also include the canonical roots even if not in form list
  local mf = getMainForm()
  if mf then
    out[#out+1] = {
      index = -1, name = get_prop(mf, "Name") or "MainForm",
      caption = get_prop(mf, "Caption"), class = get_prop(mf, "ClassName"),
      visible = get_prop(mf, "Visible"),
      left = get_prop(mf, "Left"), top = get_prop(mf, "Top"),
      width = get_prop(mf, "Width"), height = get_prop(mf, "Height"),
      isMain = true,
    }
  end
  return { windows = out }
end

-- recursively dump a form's control tree
handlers.inspect_form = function(p)
  local root = (p.path and resolve_control(p.path)) or get_root(p.name or "MainForm")
  if not root then return nil, "form not found" end
  local maxDepth = tonumber(p.maxDepth) or 5
  local includeText = p.includeText ~= false

  local function walk(obj, depth)
    if not obj then return nil end
    local node = {
      name = get_prop(obj, "Name"),
      class = get_prop(obj, "ClassName"),
      visible = get_prop(obj, "Visible"),
    }
    if includeText then
      node.caption = get_prop(obj, "Caption")
      node.text = get_prop(obj, "Text")
    end
    local enabled = get_prop(obj, "Enabled"); if enabled ~= nil then node.enabled = enabled end
    local L,T,W,H = get_prop(obj,"Left"), get_prop(obj,"Top"), get_prop(obj,"Width"), get_prop(obj,"Height")
    if L then node.bounds = { left=L, top=T, width=W, height=H } end
    if depth < maxDepth then
      local cc = get_prop(obj, "ControlCount")
      if cc and cc > 0 then
        node.children = {}
        for i = 0, cc - 1 do
          local c
          local ok = pcall(function() c = obj.Control[i] end)
          if ok and c then node.children[#node.children+1] = walk(c, depth + 1) end
        end
      end
    end
    return node
  end
  return { tree = walk(root, 0) }
end

handlers.get_control = function(p)
  local c, err = resolve_control(p.path)
  if not c then return nil, err end
  return {
    name = get_prop(c, "Name"),
    class = get_prop(c, "ClassName"),
    caption = get_prop(c, "Caption"),
    text = get_prop(c, "Text"),
    visible = get_prop(c, "Visible"),
    enabled = get_prop(c, "Enabled"),
    itemIndex = get_prop(c, "ItemIndex"),
    checked = get_prop(c, "Checked"),
  }
end

handlers.set_control = function(p)
  local c, err = resolve_control(p.path)
  if not c then return nil, err end
  local changed = {}
  if p.text ~= nil then
    local ok = pcall(function() c.Text = tostring(p.text) end)
    if ok then changed.text = p.text end
  end
  if p.caption ~= nil then
    local ok = pcall(function() c.Caption = tostring(p.caption) end)
    if ok then changed.caption = p.caption end
  end
  if p.itemIndex ~= nil then
    local ok = pcall(function() c.ItemIndex = tonumber(p.itemIndex) end)
    if ok then changed.itemIndex = p.itemIndex end
  end
  if p.checked ~= nil then
    local ok = pcall(function() c.Checked = (p.checked == true) end)
    if ok then changed.checked = p.checked end
  end
  return { ok = true, changed = changed }
end

handlers.click_control = function(p)
  local c, err = resolve_control(p.path)
  if not c then return nil, err end
  local clicked = false
  -- prefer doClick (programmatic, no focus required)
  local ok = pcall(function() c.doClick() end)
  if ok then clicked = true
  else
    ok = pcall(function() c.Click() end)
    if ok then clicked = true end
  end
  if not clicked then return nil, "no clickable method on control ("..(get_prop(c,"ClassName") or "?")..")" end
  return { ok = true }
end

-- Arbitrary CE Lua eval. Body is wrapped as a function whose return value is
-- captured. For statements (no return), use prefix 'do '.
handlers.eval_lua = function(p)
  local code = tostring(p.code or "")
  if code == "" then return nil, "empty code" end
  local chunk, err
  -- try with implicit return first
  chunk, err = load("return "..code, "mcp_eval")
  if not chunk then
    chunk, err = load(code, "mcp_eval")
  end
  if not chunk then return nil, "compile: "..tostring(err) end
  local ok, res = pcall(chunk)
  if not ok then return nil, "runtime: "..tostring(res) end
  -- coerce common types
  local tt = type(res)
  if tt == "nil" then return { ok = true, result = nil } end
  if tt == "number" or tt == "boolean" or tt == "string" then
    return { ok = true, type = tt, result = res }
  end
  -- objects -> describe minimally
  return { ok = true, type = tt, result = tostring(res) }
end

------------------------------------------------------------
-- Polling loop (timer-driven)
------------------------------------------------------------
local function poll_once()
  if MCP_BRIDGE.busy then return end
  MCP_BRIDGE.busy = true
  local ok = pcall(function()
    local resp, err = http_post(URL, '{"action":"poll"}')
    if not resp then return end
    local req = json_decode(resp)
    if not req or not req.method then return end

    -- execute handler
    local h = handlers[req.method]
    local body
    if not h then
      body = json_encode({ action = "reply", id = req.id, error = "unknown method: "..tostring(req.method) })
    else
      local ok2, result, herr = pcall(h, req.params or {})
      if not ok2 then
        body = json_encode({ action = "reply", id = req.id, error = "exception: "..tostring(result) })
      elseif herr then
        body = json_encode({ action = "reply", id = req.id, error = herr })
      else
        body = json_encode({ action = "reply", id = req.id, result = result })
      end
    end
    http_post(URL, body)
  end)
  MCP_BRIDGE.busy = false
end

-- Initial hello
local hresp, herr = http_post(URL, '{"action":"hello"}')
if not hresp then
  showMessage("MCP bridge: cannot reach "..URL.."\n("..tostring(herr)..")\n\nMake sure the MCP server is running (VS Code launches it automatically when Copilot uses a ce_* tool).")
  return
end
print("[MCP] Hello OK from "..URL)

MCP_BRIDGE.timer = createTimer(nil, false)
MCP_BRIDGE.timer.Interval = POLL_MS
MCP_BRIDGE.timer.OnTimer = poll_once
MCP_BRIDGE.timer.Enabled = true

print("[MCP] Bridge ready. Methods: "..(function()
  local k = {}; for n in pairs(handlers) do k[#k+1] = n end
  table.sort(k); return table.concat(k, ", ")
end)())
