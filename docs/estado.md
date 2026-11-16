# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-16

## Dónde estamos
- Fase 2 partida en F2a (Reaper desde MCP) y F2b (tareas y verificación). F2a implementada (8/8 tareas) en `fase/F2a-reaper`, pendiente de validación, demostración y pull request.
- Pendientes bajos de F2a: `ToolContext.daw`/`presets` opcionales; pruebas reales anteriores a T6 sin `finally`; `loadPresets` lanza `Error` normal; outbox sin límite de tamaño y esquemas sin acotar textos; respuestas huérfanas en outbox sin limpiar al arrancar; `activeRender` por proceso (un servidor por IPC); nombres de pista/plugin sin tope hacia el LLM; posible bloque de deshacer vacío si `import_audio` falla a medias; rutas del home en `spikes/reaper-ops/*.mjs`. Otros: sin límite de tamaño ni memoria del audio; cola de un solo análisis para Live.
- Antes de Live (fase 4): acotar `args` de las trazas; `.copilot/` en 0700 y `copilot.db` en 0600; la entrada inválida por MCP la rechaza el SDK y no deja traza.
- Caché y almacenamiento: no guardar si el sha256 de Python difiere de la clave; validar la clave en `SqliteStorage` (objetivo 0 chocaría con «sin objetivo»); `hashFile` da `file_not_found` también con EACCES o EISDIR; `mcp:traces` abre la base en escritura; suite de almacenamiento duplicada.

## Siguiente paso
- `/sdd-validate F2a-reaper` y la demostración (sección 6 del plan); después pull request a `main`.

## Hecho
- Fases 0, F0b, F1a y F1b cerradas; diseño en `docs/reaper-copilot.md` v2.9. Detalle en `docs/CHANGELOG.md`.

## Pendiente de decidir (usuario)
- Idioma del README y de la interfaz del Replay.
- Muestras de audio para Replay y Live.
- Hosting estático y túnel definitivos.
- `pnpm check` falla con un error de git poco claro sin rama local `main`: ¿`origin/main` o mensaje claro?
- El permiso `Bash(pnpm nx *)` de `.claude/settings.json` es amplio (`nx exec` ejecuta cualquier comando): ¿se estrecha?

## Hechos que conviene recordar
- Claude Code, Node y Python en WSL; Reaper de Windows 7.86 para trabajar y de WSL 7.85 solo sin interfaz; sin Claude Desktop. Portátil servidor: Intel i3, 8 GB, Ubuntu.
- Reaper tiene activa «Set media offline when application is not active»: conviene desactivarla (Preferences → Media).
- TypeScript está en 6.0 porque `typescript-eslint` 8 exige `typescript` menor que 6.1.
- pnpm 12 bloquea los scripts de build de las dependencias: se declaran en `allowBuilds` de `pnpm-workspace.yaml`.
