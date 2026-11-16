# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-16

## Dónde estamos
- F1a-analisis implementada (8 de 8 tareas) en `fase/F1a-analisis`, sin push; plan en `specs/F1a-analisis/plan.md`. La revisión dio CAMBIOS NECESARIOS por un hallazgo medio (rutas y stderr hacia el cliente); corregido, pendiente de re-revisión de seguridad.
- Pendientes bajos: sin límite de tamaño ni memoria del audio; `invalid_analysis_output` genérico en `server.ts`; `MODE=agent` de `.mcp.json` y `mcp:call` en `mentor` al llegar la escritura (fase 2); cola de un solo análisis para Live.

## Siguiente paso
- Re-revisión de seguridad de F1a-analisis (`reviewer-security`).
- Demostración, paso 5 (usuario, a mano): aprobar el servidor en sesión nueva de terminal y de VS Code, y pedir un análisis.
- Push y pull request a `main` con el CI en verde. Después, F1b (`compare_audio`, caché, trazas).

## Hecho
- Fases 0 y F0b cerradas (spikes, monorepo Nx, CI); diseño en `docs/reaper-copilot.md` v2.6. Detalle en `docs/CHANGELOG.md`.

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
