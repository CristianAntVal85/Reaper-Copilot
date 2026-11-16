# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-16

## Dónde estamos
- Fase F1a-analisis implementada (8 de 8 tareas) en `fase/F1a-analisis`, sin push, pendiente de revisión, demostración y pull request. Plan en `specs/F1a-analisis/plan.md`.

## Siguiente paso
- Ejecutar `/sdd-validate F1a-analisis`.
- Demostración del usuario (paso 5 del plan): aprobar el servidor en sesión nueva de terminal y de VS Code, y pedir un análisis.
- Pull request a `main` con el CI en verde. Después, F1b (`compare_audio`, caché, trazas).

## Hecho
- Fases 0 y F0b cerradas (spikes, monorepo Nx, `pnpm check` y `check:full`, CI). Detalle en `docs/CHANGELOG.md`.
- Diseño en `docs/reaper-copilot.md` v2.6.

## Pendiente de decidir (usuario)
- Idioma del README y de la interfaz del Replay.
- Muestras de audio para Replay y Live.
- Hosting estático y túnel definitivos.
- `pnpm check` falla con un error de git poco claro sin rama local `main`: ¿`origin/main` o mensaje claro?
- El permiso `Bash(pnpm nx *)` de `.claude/settings.json` es amplio (`nx exec` ejecuta cualquier comando): ¿se estrecha?

## Hechos que conviene recordar
- Claude Code, Node y Python en WSL; Reaper de Windows 7.86 para trabajar y de WSL 7.85 solo sin interfaz. No se usa Claude Desktop.
- El portátil servidor es un Intel i3 con 8 GB y Ubuntu.
- TypeScript está en 6.0 porque `typescript-eslint` 8 exige `typescript` menor que 6.1.
- pnpm 12 bloquea los scripts de build de las dependencias: se declaran en `allowBuilds` de `pnpm-workspace.yaml`.
