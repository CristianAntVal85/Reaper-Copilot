-- Reaper Copilot bridge. Runs inside Reaper (ReaScript) and serves a closed list of methods.
-- IPC by files under <repo>/.copilot/reaper-ipc: the client writes inbox/<id>.json, the bridge
-- answers outbox/<id>.json (both written as .tmp and renamed). See section 8.2 of the master document.
-- Keep the logic here minimal: validate, execute, check. Everything else lives in TypeScript.

local PROTOCOL = 1
local SEP = package.config:sub(1, 1)
local HEARTBEAT_EVERY = 0.5
local LOCK_MAX_AGE = 3

-- paths -------------------------------------------------------------------
local script = debug.getinfo(1, "S").source:sub(2)
local function parent(p) return p:match("^(.*)[/\\][^/\\]+$") or p end
-- <repo>/reaper/bridge/bridge.lua -> <repo>
local repo = parent(parent(parent(script)))
local IPC = repo .. SEP .. ".copilot" .. SEP .. "reaper-ipc"
local INBOX = IPC .. SEP .. "inbox"
local OUTBOX = IPC .. SEP .. "outbox"
local HEARTBEAT = IPC .. SEP .. "heartbeat.json"

reaper.RecursiveCreateDirectory(INBOX, 0)
reaper.RecursiveCreateDirectory(OUTBOX, 0)

-- JSON --------------------------------------------------------------------
local ARRAY = {}
local NULL = setmetatable({}, { __tostring = function() return "null" end })
local function array() return setmetatable({}, ARRAY) end

local ESCAPES = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function encode(v)
  local t = type(v)
  if v == NULL or t == "nil" then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if math.type(v) == "integer" then return tostring(v) end
    return string.format("%.14g", v)
  end
  if t == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c)
      return ESCAPES[c] or string.format("\\u%04x", c:byte())
    end) .. '"'
  end
  if t == "table" then
    local out = {}
    if getmetatable(v) == ARRAY then
      for i = 1, #v do out[i] = encode(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    for k, x in pairs(v) do out[#out + 1] = encode(tostring(k)) .. ":" .. encode(x) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  return "null"
end

local function decode(s)
  local i = 1
  local function skip() i = s:find("%S", i) or (#s + 1) end
  local value
  local function str()
    local out = {}
    i = i + 1
    while true do
      local c = s:sub(i, i)
      if c == "" then error("unterminated string") end
      if c == '"' then i = i + 1; break end
      if c == "\\" then
        local n = s:sub(i + 1, i + 1)
        if n == "u" then
          local code = tonumber(s:sub(i + 2, i + 5), 16)
          if not code then error("bad unicode escape") end
          -- Surrogate pairs: combine \uD8xx\uDCxx into one code point.
          if code >= 0xD800 and code <= 0xDBFF and s:sub(i + 6, i + 7) == "\\u" then
            local low = tonumber(s:sub(i + 8, i + 11), 16)
            if low and low >= 0xDC00 and low <= 0xDFFF then
              code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
              i = i + 6
            end
          end
          out[#out + 1] = utf8.char(code)
          i = i + 6
        else
          local map = { n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" }
          out[#out + 1] = map[n] or n
          i = i + 2
        end
      else
        out[#out + 1] = c
        i = i + 1
      end
    end
    return table.concat(out)
  end
  function value()
    skip()
    local c = s:sub(i, i)
    if c == "{" then
      local o = {}
      i = i + 1; skip()
      if s:sub(i, i) == "}" then i = i + 1; return o end
      while true do
        skip()
        if s:sub(i, i) ~= '"' then error("expected key") end
        local k = str(); skip()
        if s:sub(i, i) ~= ":" then error("expected :") end
        i = i + 1
        o[k] = value(); skip()
        local d = s:sub(i, i); i = i + 1
        if d == "}" then return o elseif d ~= "," then error("expected , or }") end
      end
    elseif c == "[" then
      local o = array()
      i = i + 1; skip()
      if s:sub(i, i) == "]" then i = i + 1; return o end
      while true do
        o[#o + 1] = value(); skip()
        local d = s:sub(i, i); i = i + 1
        if d == "]" then return o elseif d ~= "," then error("expected , or ]") end
      end
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == "true" then i = i + 4; return true
    elseif s:sub(i, i + 4) == "false" then i = i + 5; return false
    elseif s:sub(i, i + 3) == "null" then i = i + 4; return NULL
    else
      local n = s:match("^-?%d+%.?%d*[eE]?[+-]?%d*", i)
      if not n or n == "" then error("bad json at " .. i) end
      i = i + #n
      return tonumber(n)
    end
  end
  local result = value()
  skip()
  if i <= #s then error("trailing characters") end
  return result
end

-- files -------------------------------------------------------------------
local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local data = f:read("a")
  f:close()
  return data
end

-- Write to <path>.tmp and rename (os.rename does not overwrite on Windows, so remove first).
local function write_atomic(path, data)
  local tmp = path .. ".tmp"
  local f = io.open(tmp, "wb")
  if not f then return false end
  f:write(data)
  f:close()
  os.remove(path)
  return os.rename(tmp, path) and true or false
end

-- Errors ------------------------------------------------------------------
local CODES = {
  bad_request = true, unknown_method = true, invalid_params = true, file_not_found = true,
  item_not_found = true, track_not_found = true, fx_not_found = true, param_not_found = true,
  out_of_range = true, output_exists = true, media_offline = true, render_failed = true,
  nothing_to_undo = true, internal = true,
}

local function fail(code, message)
  error({ code = code, message = message or code }, 0)
end

-- Heartbeat and lock ------------------------------------------------------
local instance = reaper.genGuid("")
local state = "idle"

local function write_heartbeat()
  -- Overwritten in place: the client only looks at its mtime and, if stale, at `state`.
  local f = io.open(HEARTBEAT, "wb")
  if not f then return end
  f:write(encode({ state = state, instance = instance, time = os.time() }))
  f:close()
end

local function another_instance_alive()
  local raw = read_file(HEARTBEAT)
  if not raw then return false end
  local ok, hb = pcall(decode, raw)
  if not ok or type(hb) ~= "table" then return false end
  if hb.instance == instance or type(hb.time) ~= "number" then return false end
  return os.time() - hb.time <= LOCK_MAX_AGE
end

-- Reaper objects ----------------------------------------------------------
local function item_guid(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, "GUID", "", false)
  return guid
end

local function item_info(item, track_id)
  local take = reaper.GetActiveTake(item)
  local source = take and reaper.GetMediaItemTake_Source(take)
  local file = source and reaper.GetMediaSourceFileName(source, "") or ""
  return {
    id = item_guid(item),
    trackId = track_id,
    positionSec = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
    lengthSec = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
    startOffsetSec = take and reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS") or 0,
    playRate = take and reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE") or 1,
    source = (file ~= "") and file or NULL,
  }
end

-- Methods (closed list) ---------------------------------------------------
local running = true
local methods = {}

function methods.ping()
  return { pong = true, protocol = PROTOCOL, instance = instance, reaper = reaper.GetAppVersion() }
end

function methods.get_project_state()
  local tracks = array()
  for t = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, t)
    local track_id = reaper.GetTrackGUID(track)
    local _, name = reaper.GetTrackName(track)
    local items = array()
    for i = 0, reaper.CountTrackMediaItems(track) - 1 do
      items[#items + 1] = item_info(reaper.GetTrackMediaItem(track, i), track_id)
    end
    local fx = array()
    for f = 0, reaper.TrackFX_GetCount(track) - 1 do
      local _, fx_name = reaper.TrackFX_GetFXName(track, f, "")
      fx[#fx + 1] = fx_name
    end
    tracks[#tracks + 1] = { id = track_id, name = name, fx = fx, items = items }
  end
  return {
    tempo = reaper.Master_GetTempo(),
    lengthSec = reaper.GetProjectLength(0),
    tracks = tracks,
  }
end

-- Runs `fn` as one undo block labelled "Copilot: <action>"; the block is closed even if `fn` fails.
local function undoable(action, fn)
  reaper.Undo_BeginBlock()
  local ok, result = pcall(fn)
  reaper.Undo_EndBlock("Copilot: " .. action, -1)
  if not ok then error(result, 0) end
  return result
end

local function track_ref(track)
  local _, name = reaper.GetTrackName(track)
  return { id = reaper.GetTrackGUID(track), name = name }
end

function methods.import_audio(params)
  local path = params.path
  if type(path) ~= "string" or path == "" then fail("invalid_params", "path must be a non-empty string") end
  -- Without this check a path Reaper cannot read becomes an empty item and no error.
  if not reaper.file_exists(path) then fail("file_not_found", "file does not exist") end
  return undoable("import_audio", function()
    local index = reaper.CountTracks(0)
    reaper.InsertTrackAtIndex(index, true)
    local track = reaper.GetTrack(0, index)
    if not track then fail("internal", "could not create the track") end
    local function abort(code, message)
      reaper.DeleteTrack(track)
      fail(code, message)
    end
    reaper.GetSetMediaTrackInfo_String(track, "P_NAME", path:match("[^/\\]+$") or "audio", true)
    reaper.SetOnlyTrackSelected(track)
    reaper.SetEditCurPos(0, false, false)
    reaper.InsertMedia(path, 0)
    if reaper.CountTrackMediaItems(track) < 1 then abort("internal", "Reaper did not create an item") end
    local item = reaper.GetTrackMediaItem(track, 0)
    if not item or reaper.GetMediaItemInfo_Value(item, "D_LENGTH") <= 0 then
      abort("internal", "the imported item is empty")
    end
    -- Time timebase right away: with the project default, a later tempo change stretches the item.
    reaper.SetMediaItemInfo_Value(item, "C_BEATATTACHMODE", 0)
    return { track = track_ref(track), item = item_info(item, reaper.GetTrackGUID(track)) }
  end)
end

function methods.set_tempo(params)
  local bpm = params.bpm
  if type(bpm) ~= "number" or bpm ~= bpm then fail("invalid_params", "bpm must be a number") end
  if bpm < 40 or bpm > 320 then fail("out_of_range", "bpm must lie within [40, 320]") end
  return undoable("set_tempo", function()
    reaper.SetCurrentBPM(0, bpm, true)
    return { tempo = reaper.Master_GetTempo() }
  end)
end

-- Only undoes the copilot's own blocks: never the user's work.
function methods.undo()
  local label = reaper.Undo_CanUndo2(0)
  if type(label) ~= "string" or label:sub(1, 9) ~= "Copilot: " then
    fail("nothing_to_undo", "the last undo step is not the copilot's")
  end
  if reaper.Undo_DoUndo2(0) == 0 then fail("internal", "Reaper did not undo") end
  return { undone = label }
end

function methods.quit()
  running = false
  return { bye = true }
end

-- Request handling --------------------------------------------------------
local function respond(id, ok, payload)
  local body
  if ok then
    body = { id = id, ok = true, result = payload }
  else
    body = { id = id, ok = false, error = payload }
  end
  write_atomic(OUTBOX .. SEP .. id .. ".json", encode(body))
end

local function handle(file_name)
  local id = file_name:match("^([%w_%-]+)%.json$")
  if not id then return end
  local path = INBOX .. SEP .. file_name
  local raw = read_file(path)
  os.remove(path)
  if not raw then return end

  local parsed_ok, request = pcall(decode, raw)
  if not parsed_ok or type(request) ~= "table" then
    return respond(id, false, { code = "bad_request", message = "request is not valid JSON" })
  end
  if request.id ~= id or request.schemaVersion ~= PROTOCOL or type(request.method) ~= "string" then
    return respond(id, false, { code = "bad_request", message = "malformed request" })
  end
  local method = methods[request.method]
  if not method then
    return respond(id, false, { code = "unknown_method", message = "unknown method" })
  end
  local params = request.params
  if params ~= nil and type(params) ~= "table" then
    return respond(id, false, { code = "invalid_params", message = "params must be an object" })
  end

  local ok, result = pcall(method, params or {})
  if ok then
    return respond(id, true, result)
  end
  if type(result) == "table" and CODES[result.code] then
    return respond(id, false, { code = result.code, message = tostring(result.message or result.code) })
  end
  return respond(id, false, { code = "internal", message = tostring(result) })
end

local function poll()
  reaper.EnumerateFiles(INBOX, -1) -- refresh the listing
  local names = {}
  local i = 0
  while true do
    local name = reaper.EnumerateFiles(INBOX, i)
    if not name then break end
    if name:sub(-5) == ".json" then names[#names + 1] = name end
    i = i + 1
  end
  table.sort(names)
  for _, name in ipairs(names) do
    if not running then break end
    handle(name)
  end
end

-- Lifecycle ---------------------------------------------------------------
local function cleanup()
  -- Remove the heartbeat only if it is still ours.
  local raw = read_file(HEARTBEAT)
  local ok, hb = pcall(decode, raw or "")
  if ok and type(hb) == "table" and hb.instance == instance then os.remove(HEARTBEAT) end
end

-- Drop requests left over from a previous session: they must not run now.
local function clear_inbox()
  reaper.EnumerateFiles(INBOX, -1)
  local i = 0
  while true do
    local name = reaper.EnumerateFiles(INBOX, i)
    if not name then break end
    os.remove(INBOX .. SEP .. name)
    i = i + 1
  end
end

local last_beat = 0

local function loop()
  if not running then
    cleanup()
    return
  end
  local ok, err = pcall(poll)
  if not ok then reaper.ShowConsoleMsg("Reaper Copilot bridge error: " .. tostring(err) .. "\n") end
  local now = reaper.time_precise()
  if now - last_beat >= HEARTBEAT_EVERY then
    write_heartbeat()
    last_beat = now
  end
  if running then
    reaper.defer(loop)
  else
    cleanup()
  end
end

-- Start only when no other instance is alive. A heartbeat left by a bridge that just died stays
-- "recent" for LOCK_MAX_AGE seconds, so wait that long before giving up. Note: launching this script
-- while it already runs makes Reaper terminate the running copy and start nothing; reload with the
-- `quit` method first.
local BOOT_WAIT = LOCK_MAX_AGE + 1
local boot_deadline = reaper.time_precise() + BOOT_WAIT

local function boot()
  if another_instance_alive() then
    if reaper.time_precise() > boot_deadline then
      reaper.ShowConsoleMsg("Reaper Copilot bridge: another instance is already running; this one did not start.\n")
      return
    end
    reaper.defer(boot)
    return
  end
  clear_inbox()
  reaper.atexit(cleanup)
  write_heartbeat()
  last_beat = reaper.time_precise()
  reaper.defer(loop)
end

reaper.defer(boot)
