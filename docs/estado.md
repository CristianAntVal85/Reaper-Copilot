# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-14

## Dónde estamos
- Fase 0 (spikes) terminada: los tres funcionan. Siguiente fase: F0b-andamiaje.
- Rama: `fase/F0-spikes`, en remoto.

## Siguiente paso
- `/sdd-plan F0b-andamiaje` (Nx, `pnpm check`, entorno de Python, CI). Antes: fusionar la pull request de `fase/F0-spikes`.

## Hecho
- Diseño en `docs/reaper-copilot.md` v2.4 (Reaper en Windows, sección 8.2; método de tempo, sección 8.1).
- Spike `reaper-bridge-wsl`: el IPC por archivos funciona; la interfaz por WSLg no es usable.
- Spike `reaper-bridge-windows`: el puente funciona en Reaper de Windows con el IPC en WSL (mediana 32 ms).
- Spike `mcp-minimo`: funciona en terminal y VS Code con zod 4; el cliente no pidió permiso para ninguna herramienta.
- Spike `librosa-bpm-alto`: `feature.tempo` no basta; un refinado propio acierta los 6 temas a 0,25 BPM o menos.

## Pendiente de decidir (usuario)
- Idioma del README y de la interfaz del Replay.
- Muestras de audio para Replay y Live.
- Hosting estático y túnel definitivos.

## Hechos que conviene recordar
- Claude Code, Node y Python en WSL; Reaper de Windows 7.86 para trabajar y de WSL 7.85 solo sin interfaz. No se usa Claude Desktop.
- El portátil servidor es un Intel i3 con 8 GB y Ubuntu.
