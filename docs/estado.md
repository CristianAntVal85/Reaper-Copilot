# Reaper Copilot: estado

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/CHANGELOG.md`. Sin recuentos de pruebas: se obtienen ejecutando `pnpm check:full`.

Última actualización: 2026-11-18

## Dónde estamos
- F3 (Replay) en `fase/F3-replay` (11 de 11 tareas, con el arreglo de `eq_lowcut` en la sección 8 del plan) validada: `reviewer`, `reviewer-security` y `reviewer-ui`, APROBADO; el arreglo, revisado aparte por `reviewer` y `reviewer-security`, APROBADO. Fusionada en `main` (pull request #7). Demostración hecha; sus ejecuciones se retiraron del repositorio (decisión del usuario) y siguen en el historial de git. F2b cerrada (pull request #6). Visto en la demostración de F2a, sin resolver: el render sale a 44100 Hz con fuente de 48000; una pista importada en otra sesión quedó con `source: null` y `undo_last` no la alcanza (`nothing_to_undo`).
- Bajos de F3: en móvil la columna de estado de la tabla de criterios queda fuera de la vista hasta desplazar; poco contraste entre la parte reproducida y la pendiente de la forma de onda; si falla el borrado de `.old` tras regenerar el índice, se restaura la carpeta anterior pero el índice describe la nueva; sin favicon (404 en consola).
- Pendientes bajos de F2a: `ToolContext.daw`/`presets` opcionales; pruebas reales anteriores a T6 sin `finally`; `loadPresets` lanza `Error` normal; outbox sin límite de tamaño y esquemas sin acotar textos; respuestas huérfanas en outbox sin limpiar al arrancar; `activeRender` por proceso (un servidor por IPC); nombres de pista/plugin sin tope hacia el LLM; posible bloque de deshacer vacío si `import_audio` falla a medias; rutas del home en `spikes/reaper-ops/*.mjs`; la prueba real de M2 deja ajustes `RENDER_*` de prueba y la selección cambiada en el proyecto abierto; el puente acepta UNC con una sola barra inicial y solo rechaza `..` literal (no `.. ` ni `...`); lista de plugins duplicada en TS y Lua sin prueba que las compare. Otros: sin límite de tamaño ni memoria del audio; cola de un solo análisis para Live.
- Bajos del arreglo de `eq_lowcut`: la prueba de presets de `reaper-daw.reaper.test.ts` no limpia con try/finally si falla a medias y deja pistas en Reaper; el adaptador no aplica `ALLOWED_FX_CONFIG` (solo `loadPresets` y el puente); paridad TS/Lua de `ALLOWED_FX_CONFIG` sin prueba; la prueba del protocolo solo usa `config: []`; el `source.mp3` va copiado en cada ejecución (3,4 MB × 3).
- Antes de Live (fase 4): acotar `args` de las trazas; `.copilot/` en 0700 y `copilot.db` en 0600; la entrada inválida por MCP la rechaza el SDK y no deja traza.
- Caché y almacenamiento: no guardar si el sha256 de Python difiere de la clave; validar la clave en `SqliteStorage` (objetivo 0 chocaría con «sin objetivo»); `hashFile` da `file_not_found` también con EACCES o EISDIR; `mcp:traces` abre la base en escritura; suite de almacenamiento duplicada. De F2b: el tope de 50 verificaciones se comprueba fuera del `INSERT` (dos llamadas concurrentes lo pasan por una) y no cuenta filas corruptas; `reserveTask` gasta hueco aunque `createTask` falle; tipo `NewVerification` sin usar.

## Siguiente paso
- Publicación aplazada por el usuario: Pages sin activar y workflow `pages` desactivado (`gh workflow enable pages` lo reactiva). El usuario usará el copiloto y elegirá las ejecuciones; la entrada pública será su portfolio. Siguiente: plan de despliegue en el portátil servidor y fase 4 (Live).

## Hecho
- Fases 0, F0b, F1a, F1b, F2a y F2b cerradas; diseño en `docs/reaper-copilot.md` v2.12. Detalle en `docs/CHANGELOG.md`.

## Pendiente de decidir (usuario)
- Muestras de audio para Live y túnel definitivo (el idioma, las muestras del Replay y el hosting están decididos).
- `pnpm check` falla con un error de git poco claro sin rama local `main`: ¿`origin/main` o mensaje claro?
- El permiso `Bash(pnpm nx *)` de `.claude/settings.json` es amplio (`nx exec` ejecuta cualquier comando): ¿se estrecha?

## Hechos que conviene recordar
- Claude Code, Node y Python en WSL; Reaper de Windows 7.86 para trabajar y de WSL 7.85 solo sin interfaz; sin Claude Desktop. Portátil servidor: Intel i3, 8 GB, Ubuntu.
- En Reaper está desactivada «Set media offline when application is not active» (si se activa, los renders salen en silencio). El puente se carga o recarga con `pnpm reaper:bridge`.
- TypeScript está en 6.0 porque `typescript-eslint` 8 exige `typescript` menor que 6.1.
- pnpm 12 bloquea los scripts de build de las dependencias: se declaran en `allowBuilds` de `pnpm-workspace.yaml`.
