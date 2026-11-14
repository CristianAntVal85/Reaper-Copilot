# Kit de flujo de trabajo para Reaper Copilot

Adaptación del flujo SDD de OnWay, con tres vías según el tamaño del cambio.

## Instalación

1. Copia el contenido de esta carpeta a la raíz del repositorio `reaper-copilot/` (respeta las rutas: `.claude/`, `docs/`, `.github/`).
2. Copia el documento maestro a `docs/reaper-copilot.md`.
3. Revisa lo marcado como *(a crear)* o *(a comprobar)*: los comandos `pnpm check` y `pnpm check:full` no existen hasta que la fase 0b (andamiaje) monte el monorepo.

## Contenido

| Archivo | Para qué |
|---|---|
| `CLAUDE.md` | Contexto que se carga en cada sesión. Corto a propósito |
| `docs/constitution.md` | Reglas innegociables |
| `docs/estado.md` | Memoria entre sesiones (máximo 30 líneas) |
| `docs/CHANGELOG.md` | Historial; aquí va lo que sale de `estado.md` |
| `.claude/skills/sdd/SKILL.md` | El flujo: tres vías, verificación, commits, revisores |
| `.claude/commands/quick.md` | Vía directa: cambio trivial |
| `.claude/commands/feature.md` | Vía de cambio pequeño |
| `.claude/commands/spike.md` | Experimento acotado |
| `.claude/commands/sdd-*.md` | Vía de hito: plan, implementar, validar, estado, cambio |
| `.claude/agents/*.md` | `reviewer`, `reviewer-security`, `reviewer-ui` e `implementer` (opcional) |
| `.claude/settings.json` | Permisos: deniega `.env`, `git add -A` y `git push --force` |
| `.gitignore` | Secretos, artefactos de Node y Python, datos locales |
| `.github/workflows/ci.yml` | CI solo en pull requests y en `main` |

## Diferencias con el flujo de OnWay

- Tres vías en lugar de una. Un botón va por `/quick`, sin plan ni subagentes.
- Plan y tareas se aprueban juntos, en un solo paso.
- Verificación en dos niveles: rápida por tarea, completa al cerrar la fase.
- Los revisores especializados solo entran si el diff toca sus rutas.
- Push al cerrar la fase o al abrir la pull request, no por tarea. El commit por tarea se mantiene.
- Sin `coordinator` ni `planner`: el hilo principal planifica e implementa con la skill. Los subagentes son para revisar. Menos consumo del plan Pro.
- Sin recuentos de pruebas copiados a mano.
- Cada regla vive en un solo archivo; los demás la citan.
