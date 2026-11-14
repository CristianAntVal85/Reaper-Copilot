# Historial

Entradas nuevas arriba. Una línea por cambio relevante: fecha, fase o vía, qué se hizo y, si cambió una decisión del documento maestro, cuál.

## 2026-11-14
- Documento maestro v2.4: método de tempo por búsqueda fina en lugar de `librosa.feature.tempo`; `tempo.confidence` y umbral de `unmeasured`; preguntas abiertas 10 y 11. Sección 8.1. Origen: spike `librosa-bpm-alto`.
- Fase 0 cerrada: spikes de Reaper (WSL y Windows), librosa y MCP.
- Documento maestro v2.3: en desarrollo Reaper pasa a ser nativo de Windows; se abandona "sin traducción de rutas" y "todo en WSL". Secciones 8.2, 10, 14.1 y 15.1. Origen: spikes `reaper-bridge-wsl` y `reaper-bridge-windows`.
- Documento maestro v2.2: contrato de criterios en la sección 9.2 (criterios fijados en `start_task`, base `absolute` o `delta`, criterios derivados de `target`, estado `unmeasured`); pregunta abierta 10.
- Documento maestro v2.2: fase 0b de andamiaje en la sección 13.
- Flujo: el hilo principal planifica y orquesta con el modelo de la sesión; `implementer` y revisores implementan y validan con Sonnet; `/quick` y `/feature` fijan Sonnet. Se elimina el subagente `planner`.
- Flujo: `.claude/settings.json` con permisos denegados y `.gitignore`.
- Diseño inicial: `docs/reaper-copilot.md` v2.1.
