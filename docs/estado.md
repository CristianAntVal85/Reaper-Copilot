# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-14

## Dónde estamos
- Fase en curso: F0-spikes (sin empezar).
- Rama: `main`, con el commit inicial.

## Siguiente paso
- `/spike reaper-bridge-wsl`: Reaper en WSL ejecuta `bridge.lua` y responde por IPC.
- Tras los tres spikes: `/sdd-plan F0b-andamiaje` (git, Nx, `pnpm check`, CI).

## Hecho
- Diseño en `docs/reaper-copilot.md` v2.2 (fase 0b y contrato de criterios, sección 9.2).

## Pendiente de decidir (usuario)
- Idioma del README y de la interfaz del Replay.
- Muestras de audio para Replay y Live.
- Hosting estático y túnel definitivos.

## Hechos que conviene recordar
- Todo corre en WSL; no se usa Claude Desktop.
- El portátil servidor es un Intel i3 con 8 GB y Ubuntu.
