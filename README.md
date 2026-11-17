# Reaper Copilot

An AI copilot for the [Reaper](https://www.reaper.fm/) DAW. It exposes MCP tools that analyze audio, control Reaper and check the result with measurements, so the model does not have to guess whether a change worked.

## Three blocks

- **MCP:** a server for Claude Code. `mentor` mode only reads (analysis, comparison, project state); `agent` mode can also edit the project and render.
- **Replay:** a static site that replays real recorded runs: the request, the tool calls, the criteria per attempt, before and after players, waveform and spectrum. Live: <https://cristianantval85.github.io/Reaper-Copilot/>
- **Live:** the same tools driven by an agent on a real Reaper, for invited visitors. Not built yet (phase 4).

## Requirements

- Node 24 and pnpm, through Corepack (`corepack enable`)
- Python 3.11 or later
- Reaper (only for the tools that edit the project). Reaper on Windows is reached from WSL.

## Install

```sh
pnpm install
pnpm py:setup
```

Put your own audio in `workspace/` (ignored by git). Tool paths are relative to it.

## Register the MCP server in Claude Code

The `.mcp.json` at the root registers the server in `mentor` mode (read-only tools). Claude Code asks you to approve it the first time; `claude mcp list` checks it.

For `agent` mode, register it in your local scope:

```sh
claude mcp add --scope local reaper-copilot -e MODE=agent -- node apps/mcp-server/src/main.ts
```

Before using the Reaper tools, load the bridge with `pnpm reaper:bridge`.

## Tools

Read-only (`mentor` and `agent`):

- `analyze_audio`: tempo, key, loudness, band levels and dynamics
- `compare_audio`: differences between two files
- `start_task` and `verify_task`: define a goal with measurable criteria and check a render against it
- `get_project_state`, `list_presets`, `get_job_status`

Editing (`agent` only):

- `import_audio`, `slice_loop`, `time_stretch`, `set_tempo`, `apply_fx_chain`, `render_selection`, `undo_last`

## Commands

- `pnpm check`: types, lint and unit tests for what changed
- `pnpm check:full`: everything, plus the Python tests and the contract tests
- `pnpm mcp:call <tool> '<json>'`: call a tool without Claude Code
- `pnpm mcp:traces [n]`: print the latest tool-call traces
- `pnpm reaper:bridge`: load the Lua bridge into the open Reaper
- `pnpm test:reaper`: integration tests against a real Reaper
- `pnpm replay:export <taskId> [--title "..."]`: export a run to `apps/web/public/runs/`
- `pnpm --filter @reaper-copilot/web start`: run the Replay site locally

## Repository layout

- `apps/`: `mcp-server`, `web` (Replay site)
- `libs/`: `core` (contracts and pure logic), `tools`, `agent`, `adapters`, `testing`
- `python/analysis/`: audio analysis and Replay assets
- `reaper/`: Lua bridge and FX presets
- `docs/`: design document (in Spanish), constitution and changelog
- `specs/`: plans per phase
