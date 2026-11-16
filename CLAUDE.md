# Reaper Copilot

Copiloto de IA para el DAW Reaper: herramientas MCP que analizan audio, controlan Reaper y verifican el resultado con medidas. Tres bloques: MCP, Replay y Live.

## Dónde está cada cosa

- **Diseño completo:** `docs/reaper-copilot.md` (fuente de verdad del qué y del cómo).
- **Reglas innegociables:** `docs/constitution.md`.
- **Dónde estamos:** `docs/estado.md`. Léelo al empezar; es corto.
- **Flujo de trabajo:** skill `sdd` (tres vías, verificación, commits, revisores).

No leas el documento maestro entero en cada tarea: abre solo la sección que la tarea cite.

## Elegir la vía

| Cambio | Comando |
|---|---|
| Trivial: texto, estilo, botón, bug obvio, renombrado | `/quick` |
| Pequeño: una función o un ajuste con su prueba | `/feature` |
| Experimento para despejar un riesgo | `/spike` |
| Fase o funcionalidad: herramienta nueva, contrato, seguridad | `/sdd-plan` |

En caso de duda entre dos vías, elige la más ligera y sube si el cambio crece. Sube siempre a `/sdd-plan` si toca un contrato, un puerto, el puente de Reaper, la validación de rutas o la API Live.

## Comandos

- `pnpm check`: tipos, lint y pruebas unitarias de lo afectado. Debe tardar segundos. Es la verificación de cada tarea.
- `pnpm check:full`: todo lo anterior en todo el repositorio, más `py:test` y `test:contract` (Python real). Se ejecuta al cerrar una fase.
- `pnpm py:setup`: crea `python/analysis/.venv` e instala el paquete. Se ejecuta una vez, antes de `pnpm check:full`.
- `pnpm mcp:call <herramienta> '<json>'`: llama a una herramienta del servidor MCP por stdio, sin Claude Code.
- `pnpm mcp:traces [n]`: imprime las últimas `n` trazas de llamadas a herramientas (SQLite).
- `pnpm reaper:bridge`: carga `reaper/bridge/bridge.lua` en el Reaper de Windows abierto (`-nonewinst`); si el puente ya corre, hace `quit` y lo recarga. Hay que ejecutarlo antes de usar las herramientas de Reaper.
- `pnpm test:reaper`: integración con Reaper real. Solo en local, con Reaper abierto y el puente cargado.

## Servidor MCP

- Se registra con `.mcp.json` en la raíz (`reaper-copilot`, `MODE=mentor`: solo herramientas de lectura). Claude Code pide aprobarlo la primera vez; `claude mcp list` lo comprueba.
- Para `agent` (las que modifican Reaper), regístralo en ámbito local: `claude mcp add --scope local reaper-copilot -e MODE=agent -- node apps/mcp-server/src/main.ts`.
- Las rutas de audio van relativas a `workspace/` (ignorado por git, hay que crearlo) o absolutas dentro de él. `COPILOT_WORKSPACE` lo cambia, pero con Reaper debe ser el de por defecto (el puente solo acepta rutas bajo `<repositorio>/workspace`; el servidor avisa por stderr si no coincide); `MODE` por defecto es `mentor`.
- Trazas y caché de análisis en SQLite: `<repositorio>/.copilot/copilot.db` (ignorado por git); `COPILOT_DATA_DIR` cambia la carpeta. Variables de Reaper: `COPILOT_REAPER_IPC` (carpeta del IPC, por defecto `<repositorio>/.copilot/reaper-ipc`), `COPILOT_REAPER_PATH_STYLE` (`unc` o `identity`), `COPILOT_PRESETS` (por defecto `reaper/presets`) y `COPILOT_REAPER_EXE` (solo para `reaper:bridge`). Al cambiar el método de análisis de Python, sube `ANALYSIS_REVISION` (`libs/core`) o borra `.copilot/`: si no, la caché devuelve análisis antiguos.

## Estructura

`apps/` (mcp-server, api, web) · `libs/` (core, tools, agent, adapters, testing) · `python/analysis/` · `reaper/` (bridge, presets) · `evals/` · `deploy/` · `specs/` · `docs/`.

Dependencias: `core` ← `tools` ← `agent` ← `apps`. Los adaptadores solo dependen de `core`. `testing` solo depende de `core` y lo usan `tools`, `agent` y `apps` (solo en pruebas).

## Entorno

Claude Code, Node y Python corren en WSL. Reaper es nativo de Windows y alcanza el workspace por `\\wsl.localhost\...`; el adaptador de Reaper traduce las rutas (sección 8.2 del documento maestro). El Reaper para Linux instalado en WSL solo sirve sin interfaz. Suscripción Claude Pro: los subagentes consumen cuota. Reparto: el hilo principal (modelo más capaz) planifica y orquesta; el subagente `implementer` y los revisores (Sonnet) implementan y validan. Nunca exportes `ANTHROPIC_API_KEY` en el entorno global.

## Idioma

Documentos en español. Código, identificadores y commits en inglés. Comentarios solo cuando el motivo no es obvio.
