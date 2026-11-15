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
- `pnpm check:full`: todo lo anterior en todo el repositorio, más pruebas de contrato y de Python. Se ejecuta al cerrar una fase.
- `pnpm py:setup`: crea `python/analysis/.venv` e instala el paquete. Se ejecuta una vez, antes de `pnpm check:full`.
- `pnpm test:reaper`: integración con Reaper real. Solo en local, con Reaper abierto. Llega en la fase 2.

## Estructura

`apps/` (mcp-server, api, web) · `libs/` (core, tools, agent, adapters, testing) · `python/analysis/` · `reaper/` (bridge, presets) · `evals/` · `deploy/` · `specs/` · `docs/`.

Dependencias: `core` ← `tools` ← `agent` ← `apps`. Los adaptadores solo dependen de `core`.

## Entorno

Claude Code, Node y Python corren en WSL. Reaper es nativo de Windows y alcanza el workspace por `\\wsl.localhost\...`; el adaptador de Reaper traduce las rutas (sección 8.2 del documento maestro). El Reaper para Linux instalado en WSL solo sirve sin interfaz. Suscripción Claude Pro: los subagentes consumen cuota. Reparto: el hilo principal (modelo más capaz) planifica y orquesta; el subagente `implementer` y los revisores (Sonnet) implementan y validan. Nunca exportes `ANTHROPIC_API_KEY` en el entorno global.

## Idioma

Documentos en español. Código, identificadores y commits en inglés. Comentarios solo cuando el motivo no es obvio.
