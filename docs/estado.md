# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-15

## Dónde estamos
- Fase F0b-andamiaje implementada (7 de 7 tareas), a falta de validarla.
- Rama: `fase/F0b-andamiaje`, sin push.

## Siguiente paso
- `/sdd-validate F0b-andamiaje`.
- Después, pull request a `main`: ahí se comprueba el CI.
- Después, `/sdd-plan` de la fase 1.

## Hecho
- Fase 0: los tres spikes funcionan (puente de Reaper, MCP mínimo, tempo con librosa). Detalle en `docs/CHANGELOG.md` y `specs/spikes/`.
- Fase F0b: monorepo Nx con pnpm, `pnpm check` y `pnpm check:full`, esqueleto de Python y CI.
- Diseño en `docs/reaper-copilot.md` v2.5.

## Pendiente de decidir (usuario)
- Idioma del README y de la interfaz del Replay.
- Muestras de audio para Replay y Live.
- Hosting estático y túnel definitivos.

## Hechos que conviene recordar
- Claude Code, Node y Python en WSL; Reaper de Windows 7.86 para trabajar y de WSL 7.85 solo sin interfaz. No se usa Claude Desktop.
- El portátil servidor es un Intel i3 con 8 GB y Ubuntu.
- TypeScript está en 6.0 porque `typescript-eslint` 8 exige `typescript` menor que 6.1.
- pnpm 12 bloquea los scripts de build de las dependencias: se declaran en `allowBuilds` de `pnpm-workspace.yaml`.
