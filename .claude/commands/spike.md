---
description: Spike · experimento acotado para despejar un riesgo (uso - /spike reaper-bridge-wsl)
---
Spike: $ARGUMENTS

Vía de spike de la skill sdd. Lee la fase 0 en la sección 13 de `docs/reaper-copilot.md` si el spike viene de ahí.
1. Dime en tres líneas qué pregunta responde el spike y cuál es la prueba mínima.
2. Trabaja en `spikes/$1/`. Código desechable: sin pruebas, sin arquitectura.
3. Si un paso necesita que yo haga algo a mano (abrir Reaper, cargar un script), dímelo con el comando exacto y espera.
4. Escribe `specs/spikes/$1.md`: qué se probó, qué pasó (con salidas reales), qué se decide y qué queda abierto.
5. Actualiza `docs/estado.md`.

No reutilices el código del spike en `apps/` o `libs/`.
