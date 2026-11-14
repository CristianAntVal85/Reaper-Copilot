-- Spike: file-based IPC bridge, Windows + Linux. Throwaway code.
local SEP = package.config:sub(1, 1)
local src = debug.getinfo(1, "S").source:sub(2)
local base = src:match("^(.*)[/\\][^/\\]+$")
local INBOX, OUTBOX = base .. SEP .. "ipc" .. SEP .. "inbox", base .. SEP .. "ipc" .. SEP .. "outbox"
local HEART = base .. SEP .. "ipc" .. SEP .. "heartbeat"
reaper.RecursiveCreateDirectory(INBOX, 0)
reaper.RecursiveCreateDirectory(OUTBOX, 0)

-- minimal JSON ---------------------------------------------------------
local function enc(v)
  local t = type(v)
  if t == "nil" then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if math.type(v) == "integer" then return tostring(v) end
    return string.format("%.6f", v)
  end
  if t == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c)
      if c == '"' then return '\\"' elseif c == "\\" then return "\\\\" end
      return string.format("\\u%04x", c:byte())
    end) .. '"'
  end
  if t == "table" then
    if #v > 0 or v.__array then
      local o = {}
      for i = 1, #v do o[i] = enc(v[i]) end
      return "[" .. table.concat(o, ",") .. "]"
    end
    local o = {}
    for k, x in pairs(v) do o[#o + 1] = enc(tostring(k)) .. ":" .. enc(x) end
    return "{" .. table.concat(o, ",") .. "}"
  end
  return "null"
end

local function dec(s)
  local i = 1
  local function ws() i = s:find("%S", i) or #s + 1 end
  local val
  local function str()
    local o = {}
    i = i + 1
    while true do
      local c = s:sub(i, i)
      if c == "" then error("unterminated string") end
      if c == '"' then i = i + 1 break end
      if c == "\\" then
        local n = s:sub(i + 1, i + 1)
        local map = { n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" }
        if n == "u" then
          o[#o + 1] = utf8.char(tonumber(s:sub(i + 2, i + 5), 16)); i = i + 6
        else
          o[#o + 1] = map[n] or n; i = i + 2
        end
      else
        o[#o + 1] = c; i = i + 1
      end
    end
    return table.concat(o)
  end
  function val()
    ws()
    local c = s:sub(i, i)
    if c == "{" then
      local o = {}
      i = i + 1; ws()
      if s:sub(i, i) == "}" then i = i + 1 return o end
      while true do
        ws(); local k = str(); ws()
        if s:sub(i, i) ~= ":" then error("expected :") end
        i = i + 1; o[k] = val(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "}" then return o elseif d ~= "," then error("expected , or }") end
      end
    elseif c == "[" then
      local o = {}
      i = i + 1; ws()
      if s:sub(i, i) == "]" then i = i + 1 return o end
      while true do
        o[#o + 1] = val(); ws()
        local d = s:sub(i, i); i = i + 1
        if d == "]" then return o elseif d ~= "," then error("expected , or ]") end
      end
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == "true" then i = i + 4 return true
    elseif s:sub(i, i + 4) == "false" then i = i + 5 return false
    elseif s:sub(i, i + 3) == "null" then i = i + 4 return nil
    else
      local n = s:match("^-?%d+%.?%d*[eE]?[+-]?%d*", i)
      if not n or n == "" then error("bad json at " .. i) end
      i = i + #n
      return tonumber(n)
    end
  end
  return val()
end

-- helpers ---------------------------------------------------------------
local function read(path)
  local f = io.open(path, "rb"); if not f then return nil end
  local d = f:read("a"); f:close(); return d
end
local function write_atomic(path, data)
  local f = assert(io.open(path .. ".tmp", "wb")); f:write(data); f:close()
  os.remove(path)
  assert(os.rename(path .. ".tmp", path))
end

local ticks, lastTick, maxGap = 0, reaper.time_precise(), 0
local running = true

local function state()
  local _, name = reaper.EnumProjects(-1)
  local tracks = { __array = true }
  for t = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, t)
    local _, tn = reaper.GetTrackName(tr)
    tracks[#tracks + 1] = { index = t, name = tn, items = reaper.CountTrackMediaItems(tr) }
  end
  return { project = name, tempo = reaper.Master_GetTempo(), tracks = tracks,
           lengthSec = reaper.GetProjectLength(0) }
end

-- closed method list ----------------------------------------------------
local M = {}
function M.ping() return { pong = true, base = base, resource = reaper.GetResourcePath(), reaper = reaper.GetAppVersion(), os = reaper.GetOS() } end
M.get_project_state = state
function M.stats()
  local r = { ticks = ticks, maxGapSec = maxGap }
  maxGap = 0
  return r
end
function M.new_tab() reaper.Main_OnCommand(40859, 0) return state() end
function M.set_tempo(p)
  reaper.Undo_BeginBlock()
  reaper.SetCurrentBPM(0, p.bpm, true)
  reaper.Undo_EndBlock("Copilot spike: set tempo", -1)
  return state()
end
function M.undo() local ok = reaper.Undo_DoUndo2(0) return { undone = ok, state = state() } end
function M.import_audio(p)
  reaper.Undo_BeginBlock()
  reaper.SetEditCurPos(0, false, false)
  local ok = reaper.InsertMedia(p.path, 1)
  reaper.Undo_EndBlock("Copilot spike: import audio", -1)
  return { inserted = ok, state = state() }
end
function M.render(p)
  reaper.GetSetProjectInfo_String(0, "RENDER_FILE", p.dir, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", p.name, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "wave", true)
  reaper.GetSetProjectInfo(0, "RENDER_SETTINGS", 0, true)
  reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 1, true)
  local t0 = reaper.time_precise()
  reaper.Main_OnCommand(42230, 0) -- render with most recent settings, auto-close dialog
  return { blockedSec = reaper.time_precise() - t0 }
end
function M.audio_info()
  local r = {}
  for _, k in ipairs({ "MODE", "IDENT_IN", "IDENT_OUT", "BSIZE", "SRATE", "BPS" }) do
    local ok, v = reaper.GetAudioDeviceInfo(k, "")
    r[k] = ok and v or false
  end
  r.audioRunning = reaper.Audio_IsRunning()
  return r
end
function M.quit() running = false return { stopping = true } end

local function handle(file)
  local path = INBOX .. SEP .. file
  local raw = read(path)
  os.remove(path)
  local ok, req = pcall(dec, raw or "")
  local id = (ok and type(req) == "table" and req.id) or file:gsub("%.json$", "")
  local res
  if not ok or type(req) ~= "table" then
    res = { id = id, ok = false, error = { code = "bad_request", message = tostring(req) } }
  elseif not M[req.method] then
    res = { id = id, ok = false, error = { code = "unknown_method", message = tostring(req.method) } }
  else
    local t0 = reaper.time_precise()
    local ok2, out = pcall(M[req.method], req.params or {})
    if ok2 then
      res = { id = id, ok = true, result = out, handlerSec = reaper.time_precise() - t0 }
    else
      res = { id = id, ok = false, error = { code = "handler_error", message = tostring(out) } }
    end
  end
  write_atomic(OUTBOX .. SEP .. id .. ".json", enc(res))
end

local function loop()
  if not running then return end
  local now = reaper.time_precise()
  if now - lastTick > maxGap then maxGap = now - lastTick end
  lastTick = now
  ticks = ticks + 1
  reaper.EnumerateFiles(INBOX, -1) -- drop the cached listing
  local files, i = {}, 0
  while true do
    local f = reaper.EnumerateFiles(INBOX, i)
    if not f then break end
    if f:match("%.json$") then files[#files + 1] = f end
    i = i + 1
  end
  table.sort(files)
  for _, f in ipairs(files) do handle(f) end
  if ticks % 15 == 0 then write_atomic(HEART, string.format("%d %.3f", ticks, os.time())) end
  reaper.defer(loop)
end

reaper.atexit(function() os.remove(HEART) end)
write_atomic(HEART, "0 " .. os.time())
loop()
