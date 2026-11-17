-- Spike reaper-ops: bridge + slice, stretch, FX, render selection. Throwaway code.
local SEP = package.config:sub(1, 1)
local src = debug.getinfo(1, "S").source:sub(2)
local base = src:match("^(.*)[/\\][^/\\]+$")
local IPC = base .. SEP .. "out" .. SEP .. "ipc"
local INBOX, OUTBOX = IPC .. SEP .. "inbox", IPC .. SEP .. "outbox"
local HEART = IPC .. SEP .. "heartbeat"
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
local function arr(t) t.__array = true return t end

local function guid_of(it) local _, g = reaper.GetSetMediaItemInfo_String(it, "GUID", "", false) return g end
local function item_by_guid(g)
  for i = 0, reaper.CountMediaItems(0) - 1 do
    local it = reaper.GetMediaItem(0, i)
    if guid_of(it) == g then return it end
  end
  error("item not found: " .. tostring(g))
end

local function item_info(it)
  local tk = reaper.GetActiveTake(it)
  local src = tk and reaper.GetMediaItemTake_Source(tk)
  local srcLen = src and select(1, reaper.GetMediaSourceLength(src)) or 0
  return {
    guid = guid_of(it),
    position = reaper.GetMediaItemInfo_Value(it, "D_POSITION"),
    length = reaper.GetMediaItemInfo_Value(it, "D_LENGTH"),
    startOffs = tk and reaper.GetMediaItemTakeInfo_Value(tk, "D_STARTOFFS") or 0,
    playRate = tk and reaper.GetMediaItemTakeInfo_Value(tk, "D_PLAYRATE") or 1,
    preservePitch = tk and reaper.GetMediaItemTakeInfo_Value(tk, "B_PPITCH") or 0,
    pitchMode = tk and reaper.GetMediaItemTakeInfo_Value(tk, "I_PITCHMODE") or 0,
    sourceLength = srcLen,
    sourceFile = src and reaper.GetMediaSourceFileName(src, "") or "",
    timebase = reaper.GetMediaItemInfo_Value(it, "C_BEATATTACHMODE"),
  }
end

local function state()
  local _, name = reaper.EnumProjects(-1)
  local tracks = arr({})
  for t = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, t)
    local _, tn = reaper.GetTrackName(tr)
    local items = arr({})
    for i = 0, reaper.CountTrackMediaItems(tr) - 1 do items[#items + 1] = item_info(reaper.GetTrackMediaItem(tr, i)) end
    local fx = arr({})
    for f = 0, reaper.TrackFX_GetCount(tr) - 1 do
      local _, fn = reaper.TrackFX_GetFXName(tr, f, "")
      fx[#fx + 1] = fn
    end
    tracks[#tracks + 1] = { index = t, name = tn, items = items, fx = fx }
  end
  local ts, te = reaper.GetSet_LoopTimeRange2(0, false, false, 0, 0, false)
  return { project = name, tempo = reaper.Master_GetTempo(), tracks = tracks,
           lengthSec = reaper.GetProjectLength(0), timeSel = { ts, te } }
end

local function undoable(label, fn)
  reaper.Undo_BeginBlock()
  local ok, res = pcall(fn)
  reaper.Undo_EndBlock("Copilot spike: " .. label, -1)
  if not ok then error(res, 0) end
  reaper.UpdateArrange()
  return res
end

local function fx_params(tr, fx)
  local ps = arr({})
  for p = 0, reaper.TrackFX_GetNumParams(tr, fx) - 1 do
    local _, pn = reaper.TrackFX_GetParamName(tr, fx, p, "")
    local v, mn, mx = reaper.TrackFX_GetParam(tr, fx, p)
    local _, fv = reaper.TrackFX_GetFormattedParamValue(tr, fx, p, "")
    ps[#ps + 1] = { i = p, name = pn, value = v, min = mn, max = mx, text = fv }
  end
  return ps
end

-- closed method list ----------------------------------------------------
local ticks = 0
local running = true
local M = {}
function M.ping() return { pong = true, base = base, reaper = reaper.GetAppVersion(), os = reaper.GetOS() } end
M.get_project_state = state
function M.new_tab() reaper.Main_OnCommand(40859, 0) return state() end
function M.set_tempo(p) return undoable("set tempo", function() reaper.SetCurrentBPM(0, p.bpm, true) return state() end) end
function M.undo() local ok = reaper.Undo_DoUndo2(0) return { undone = ok, state = state() } end

function M.import_audio(p)
  if not reaper.file_exists(p.path) then error("file_not_found: " .. p.path, 0) end
  return undoable("import audio", function()
    local idx = reaper.CountTracks(0)
    reaper.InsertTrackAtIndex(idx, true)
    local tr = reaper.GetTrack(0, idx)
    reaper.SetOnlyTrackSelected(tr)
    reaper.SetEditCurPos(0, false, false)
    local ok = reaper.InsertMedia(p.path, 0)
    local n = reaper.CountTrackMediaItems(tr)
    if n == 0 then error("import_failed: no item created (inserted=" .. tostring(ok) .. ")", 0) end
    local it = reaper.GetTrackMediaItem(tr, n - 1)
    local info = item_info(it)
    if info.length <= 0 then error("import_failed: empty item", 0) end
    info.track = idx
    return info
  end)
end

-- Cut `bars` bars starting at bar `startBar` (1-based), given the source tempo and the offset of bar 1.
function M.slice(p)
  local it = item_by_guid(p.guid)
  local barSec = (p.beatsPerBar or 4) * 60 / p.sourceBpm
  local startSec = (p.offsetSec or 0) + (p.startBar - 1) * barSec
  local lenSec = p.bars * barSec
  return undoable("slice loop", function()
    local pos = reaper.GetMediaItemInfo_Value(it, "D_POSITION")
    if p.mode == "split" then
      local right = reaper.SplitMediaItem(it, pos + startSec)
      if not right then error("split failed at start", 0) end
      local tail = reaper.SplitMediaItem(right, pos + startSec + lenSec)
      local tr = reaper.GetMediaItem_Track(it)
      reaper.DeleteTrackMediaItem(tr, it)
      if tail then reaper.DeleteTrackMediaItem(tr, tail) end
      reaper.SetMediaItemInfo_Value(right, "D_POSITION", 0)
      local info = item_info(right)
      info.expectedLength = lenSec
      return info
    end
    local tk = reaper.GetActiveTake(it)
    local offs = reaper.GetMediaItemTakeInfo_Value(tk, "D_STARTOFFS")
    reaper.SetMediaItemTakeInfo_Value(tk, "D_STARTOFFS", offs + startSec)
    reaper.SetMediaItemInfo_Value(it, "D_LENGTH", lenSec)
    reaper.SetMediaItemInfo_Value(it, "D_POSITION", 0)
    local info = item_info(it)
    info.expectedLength = lenSec
    return info
  end)
end

-- Play-rate stretch with pitch preserved.
function M.stretch(p)
  local it = item_by_guid(p.guid)
  local rate = p.targetBpm / p.sourceBpm
  return undoable("time stretch", function()
    local tk = reaper.GetActiveTake(it)
    local len = reaper.GetMediaItemInfo_Value(it, "D_LENGTH")
    local oldRate = reaper.GetMediaItemTakeInfo_Value(tk, "D_PLAYRATE")
    reaper.SetMediaItemTakeInfo_Value(tk, "B_PPITCH", 1)
    if p.pitchMode then reaper.SetMediaItemTakeInfo_Value(tk, "I_PITCHMODE", p.pitchMode) end
    reaper.SetMediaItemTakeInfo_Value(tk, "D_PLAYRATE", oldRate * rate)
    reaper.SetMediaItemInfo_Value(it, "D_LENGTH", len / rate)
    -- C_BEATATTACHMODE: -1 project default, 0 time, 1 beats (pos/len/rate), 2 beats (pos only)
    if p.timebase then reaper.SetMediaItemInfo_Value(it, "C_BEATATTACHMODE", p.timebase) end
    if p.setProjectTempo then reaper.SetCurrentBPM(0, p.targetBpm, true) end
    local info = item_info(it)
    info.rate = rate
    return info
  end)
end

function M.installed_fx(p)
  local out, i = arr({}), 0
  local f = (p.filter or ""):lower()
  while true do
    local ok, name, ident = reaper.EnumInstalledFX(i)
    if not ok then break end
    if f == "" or name:lower():find(f, 1, true) then out[#out + 1] = { name = name, ident = ident } end
    i = i + 1
  end
  return { count = i, matches = out }
end

function M.fx_add(p)
  local tr = reaper.GetTrack(0, p.track)
  return undoable("add fx", function()
    local fx = reaper.TrackFX_AddByName(tr, p.name, false, -1)
    if fx < 0 then error("fx_not_found: " .. p.name, 0) end
    local _, fn = reaper.TrackFX_GetFXName(tr, fx, "")
    return { fx = fx, name = fn, params = fx_params(tr, fx) }
  end)
end

function M.fx_params(p)
  local tr = reaper.GetTrack(0, p.track)
  return { params = fx_params(tr, p.fx) }
end

function M.fx_set(p)
  local tr = reaper.GetTrack(0, p.track)
  return undoable("set fx param", function()
    local ok = reaper.TrackFX_SetParam(tr, p.fx, p.param, p.value)
    local v = reaper.TrackFX_GetParam(tr, p.fx, p.param)
    local _, fv = reaper.TrackFX_GetFormattedParamValue(tr, p.fx, p.param, "")
    return { ok = ok, value = v, text = fv }
  end)
end

-- Set a param by its displayed value (real units): bisect the normalized value, assuming monotonic display.
function M.fx_set_display(p)
  local tr = reaper.GetTrack(0, p.track)
  local function shown(n)
    local ok, txt = reaper.TrackFX_FormatParamValueNormalized(tr, p.fx, p.param, n, "")
    if not ok then error("format_unsupported", 0) end
    local v = tonumber((txt:gsub("[^%d%.%-+eE]", "")))
    if not v then error("not_numeric: " .. txt, 0) end
    return v, txt
  end
  local lo, hi = 0.0, 1.0
  local vlo, vhi = shown(lo), shown(hi)
  local inc = vhi > vlo
  if (inc and (p.value < vlo or p.value > vhi)) or (not inc and (p.value > vlo or p.value < vhi)) then
    error("out_of_range: " .. vlo .. ".." .. vhi, 0)
  end
  for _ = 1, 40 do
    local mid = (lo + hi) / 2
    local v = shown(mid)
    if (v < p.value) == inc then lo = mid else hi = mid end
  end
  return undoable("set fx param", function()
    reaper.TrackFX_SetParamNormalized(tr, p.fx, p.param, (lo + hi) / 2)
    local _, fv = reaper.TrackFX_GetFormattedParamValue(tr, p.fx, p.param, "")
    return { normalized = (lo + hi) / 2, text = fv, range = { vlo, vhi } }
  end)
end

function M.media_online()
  reaper.Main_OnCommand(40182, 0) -- select all items
  reaper.Main_OnCommand(40439, 0) -- set selected media online
  reaper.Main_OnCommand(40289, 0) -- unselect all items
  return state()
end
function M.offline_prefs()
  local r = {}
  for _, k in ipairs({ "offlineinact", "runafterstop", "runallonstop" }) do r[k] = reaper.SNM_GetIntConfigVar and reaper.SNM_GetIntConfigVar(k, -999) or "no SWS" end
  local ok, v = reaper.get_config_var_string("offlineinact")
  r.offlineinact_str = ok and v or false
  return r
end

-- Render the master mix over the item's bounds (time selection) to dir/name.wav.
function M.render_selection(p)
  local it = item_by_guid(p.guid)
  local s = reaper.GetMediaItemInfo_Value(it, "D_POSITION")
  local e = s + reaper.GetMediaItemInfo_Value(it, "D_LENGTH")
  reaper.GetSet_LoopTimeRange2(0, true, false, s, e, false)
  reaper.GetSetProjectInfo_String(0, "RENDER_FILE", p.dir, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", p.name, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "evaw", true) -- wave
  reaper.GetSetProjectInfo(0, "RENDER_SETTINGS", 0, true)   -- master mix
  reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 2, true) -- time selection
  reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG", 0, true)
  local t0 = reaper.time_precise()
  reaper.Main_OnCommand(42230, 0)
  local out = p.dir .. SEP .. p.name .. ".wav"
  return { blockedSec = reaper.time_precise() - t0, file = out, exists = reaper.file_exists(out), bounds = { s, e } }
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
  ticks = ticks + 1
  reaper.EnumerateFiles(INBOX, -1)
  local files, i = {}, 0
  while true do
    local f = reaper.EnumerateFiles(INBOX, i)
    if not f then break end
    if f:match("%.json$") then files[#files + 1] = f end
    i = i + 1
  end
  table.sort(files)
  for _, f in ipairs(files) do handle(f) end
  if ticks % 15 == 0 then write_atomic(HEART, string.format("%d %d", ticks, os.time())) end
  reaper.defer(loop)
end

reaper.atexit(function() os.remove(HEART) end)
write_atomic(HEART, "0 " .. os.time())
loop()
