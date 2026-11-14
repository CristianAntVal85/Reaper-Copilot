# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-14

## Dónde estamos
- Fase en curso: F0-spikes (Reaper hecho en WSL y en Windows; faltan librosa y MCP).
- Rama: `main`, con el commit inicial.

## Siguiente paso
- `/spike librosa-bpm-alto`: BPM reales en `spikes/librosa-bpm-alto/ground-truth.csv`; los MP3 están en `.mp3/` (fuera de git).
- `/spike mcp-minimo`.
- Tras los tres spikes: `/sdd-plan F0b-andamiaje` (git, Nx, `pnpm check`, CI).

## Hecho
- Diseño en `docs/reaper-copilot.md` v2.3 (Reaper en Windows con traducción de rutas, sección 8.2).
- Spike `reaper-bridge-wsl`: el IPC por archivos funciona; la interfaz por WSLg no es usable.
- Spike `reaper-bridge-windows`: el puente funciona en Reaper de Windows con el IPC en WSL (mediana 32 ms).

## Pendiente de decidir (usuario)
- Idioma del README y de la interfaz del Replay.
- Muestras de audio para Replay y Live.
- Hosting estático y túnel definitivos.

## Hechos que conviene recordar
- Claude Code, Node y Python en WSL; Reaper de Windows 7.86 para trabajar y de WSL 7.85 solo sin interfaz. No se usa Claude Desktop.
- El portátil servidor es un Intel i3 con 8 GB y Ubuntu.
