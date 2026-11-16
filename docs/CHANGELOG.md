# Historial

Entradas nuevas arriba. Una línea por cambio relevante: fecha, fase o vía, qué se hizo y, si cambió una decisión del documento maestro, cuál.

## 2026-11-16
- Fase F1a cerrada: pull request #3 fusionada. Revisión en dos vueltas: un hallazgo medio de seguridad (rutas del host y stderr de Python llegaban al cliente) corregido con mensajes fijos por código; además, entorno del proceso hijo por lista permitida y dependencias de Python acotadas. Demostración: seis temas de prueba a ±0,25 BPM, ~4 s por tema.
- Fase F1a-analisis implementada (8 de 8 tareas), pendiente de revisión, demostración manual y pull request: contrato `AudioFeatures` en zod, `python -m analysis analyze`, `PythonAnalyzer`, validación de rutas, `analyze_audio`, `FakeAnalyzer`, servidor MCP por stdio y `.mcp.json`. CI con caché de pip.
- Documento maestro v2.6: precisiones del contrato de análisis, códigos de salida y errores de dominio (8.1), firma de `AnalyzerPort.analyze` con `targetBpm` (6.4), excepción de zod en `core` (2.1), zod 4, TypeScript sin compilar y `check:full` (14.1), fase 1 partida en 1a y 1b (13). `compare_audio` y la caché pasan a F1b.
- Decisión de F1a: para errores inesperados el servidor MCP devuelve `internal_error` (código de protocolo, fuera de la lista de `CopilotError`); el detalle solo va por stderr.

## 2026-11-15
- Fase F0b cerrada: pull request #2 fusionada, CI en verde en la pull request y en `main`.
- La fase 1 se parte en F1a (`analyze_audio` de punta a punta) y F1b (`compare_audio`, caché, trazas). zod queda permitido en `libs/core` (decisión del usuario; se aplica en F1a).
- Documento maestro v2.5: stack concretado, con Node 24 en lugar de «20 o superior», TypeScript 6, pnpm, ESLint y Vitest. Sección 14.1. La sección 11.3 decía «Node LTS»: ahora dice Node 24, sin subir la versión del documento.
- Fase F0b implementada y revisada, pendiente del CI en la pull request y de la fusión (el cierre se anotará al fusionar): monorepo Nx con pnpm, `pnpm check` y `pnpm check:full`, esqueleto de `python/analysis` y CI en un job.

## 2026-11-14
- Documento maestro v2.4: método de tempo por búsqueda fina en lugar de `librosa.feature.tempo`; `tempo.confidence` y umbral de `unmeasured`; preguntas abiertas 10 y 11. Sección 8.1. Origen: spike `librosa-bpm-alto`.
- Fase 0 cerrada: spikes de Reaper (WSL y Windows), librosa y MCP.
- Documento maestro v2.3: en desarrollo Reaper pasa a ser nativo de Windows; se abandona "sin traducción de rutas" y "todo en WSL". Secciones 8.2, 10, 14.1 y 15.1. Origen: spikes `reaper-bridge-wsl` y `reaper-bridge-windows`.
- Documento maestro v2.2: contrato de criterios en la sección 9.2 (criterios fijados en `start_task`, base `absolute` o `delta`, criterios derivados de `target`, estado `unmeasured`); pregunta abierta 10.
- Documento maestro v2.2: fase 0b de andamiaje en la sección 13.
- Flujo: el hilo principal planifica y orquesta con el modelo de la sesión; `implementer` y revisores implementan y validan con Sonnet; `/quick` y `/feature` fijan Sonnet. Se elimina el subagente `planner`.
- Flujo: `.claude/settings.json` con permisos denegados y `.gitignore`.
- Diseño inicial: `docs/reaper-copilot.md` v2.1.
