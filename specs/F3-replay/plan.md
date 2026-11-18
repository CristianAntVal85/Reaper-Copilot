# F3-replay: plan

Rama: `fase/F3-replay`, creada desde `main` después de fusionar F2b (lleva el commit de cierre de F2b). Fecha: 2026-11-17.

## 1. Alcance

Fase 3 (sección 13 del documento maestro, fila «3. Replay»). Criterio de salida: **URL pública con al menos tres ejecuciones reales.**

**Entra:**
- Contrato del Replay en `core`: `run.json`, índice y datos de forma de onda y espectro.
- Subcomando de Python `replay-assets`: MP3, forma de onda y espectro.
- Comando `pnpm replay:export` (sección 9.3).
- Aplicación Angular `apps/web` con la lista de ejecuciones y, por ejecución, la petición, los pasos, los criterios por intento, los reproductores de antes y después, la forma de onda y el espectro (sección 4.2).
- Despliegue en GitHub Pages.
- README en inglés y documento maestro al día.

**No entra:**
- El indicador «demo en vivo disponible», que depende del servidor Live (fase 4).
- El vídeo del README.
- El modo Live de la web.
- Los pendientes bajos de fases anteriores.

**Decisiones del usuario (2026-11-17):**
- La interfaz del Replay y el README van en inglés. Los documentos internos siguen en español.
- El audio publicado es propio del autor (constitución, regla 16).
- El hosting es GitHub Pages: el repositorio `CristianAntVal85/Reaper-Copilot` es público.
- Dependencias aprobadas, y ninguna más:
  - `@angular/core`, `@angular/common`, `@angular/compiler`, `@angular/compiler-cli`, `@angular/platform-browser`, `@angular/router`, `@angular/build` y `@angular/cli`, en 22.2.
  - `rxjs`, `tslib` y `jsdom`.
  - Sin librerías de gráficas ni de audio: la forma de onda y el espectro se dibujan con SVG propio.
- El audio se comprime y se analiza con Python, sin ffmpeg: MP3 con `soundfile`, y la forma de onda y el espectro precalculados con numpy y scipy. La web no calcula nada.

## 2. Contexto para el implementador

**Entorno.** WSL, Node 24, pnpm 12 por Corepack, TypeScript 6.0 sin compilar en las librerías (imports relativos con `.ts`, solo sintaxis borrable). Python en `python/analysis/.venv` con `soundfile` (libsndfile 1.2.2, escribe MP3 con el subtipo `MPEG_LAYER_III`), numpy, scipy y librosa. No hay ffmpeg. Si `pnpm check` da un `EPIPE` del demonio de Nx, repítelo.

**Dependencias.** Solo las aprobadas en la sección 1. Si falta algo, para y pregunta. pnpm 12 bloquea los scripts de build de las dependencias: si alguna lo necesita, se declara en `allowBuilds` de `pnpm-workspace.yaml`. Angular 22.2 exige `typescript >=6.0 <6.1` (el repositorio usa `~6.0.3`) y su `@angular/build` admite Vitest `^4.0.8 || ^5.0.0` (el repositorio usa `^5.1.0`). La aplicación se hace sin `zone.js` (zoneless), con componentes standalone y signals.

**Monorepo.**
- **Paquetes:** cada uno tiene `package.json` con los scripts `typecheck`, `lint` y `test`, que Nx infiere como objetivos, y la etiqueta `nx.tags`. Las dependencias internas van con `workspace:*`.
- **`apps/web`:** lleva `nx.tags: ["scope:app"]` y, además, `build` y `start`, que llaman a `ng`, con un `angular.json` propio en `apps/web`.
- **Regla de dependencias** (`eslint.config.mjs`): `core` ← `tools` ← `agent` ← `apps`; los adaptadores y `testing` solo dependen de `core`. `apps/web` solo importa `@reaper-copilot/core`, y solo por sus esquemas.
- **Verificación:** `pnpm check` es `nx affected -t typecheck lint test`, y `pnpm check:full` lo hace en todo el repositorio, más `py:test` y `test:contract`.
- **CI:** `.github/workflows/ci.yml` corre `check:full` sin Python real.

**Reglas de la constitución que aplican.**
- **3 y 4.** Contrato primero en zod y una prueba por contrato. El `run.json` lo escribe el exportador y lo valida la web con el mismo esquema.
- **7.** Lo externo, detrás de puertos: el subcomando de Python se usa a través de `AnalyzerPort`.
- **13.** Rutas restringidas al workspace: el exportador valida con `resolveAssetPath` cada ruta leída de SQLite antes de leer audio.
- **14.** Lo que viene de las trazas (petición, argumentos, resultados) es dato. La web lo muestra como texto: interpolación de Angular, nunca `innerHTML` ni `bypassSecurityTrust*`.
- **15 y 16.** Sin secretos, y audio publicado solo propio. Exportar equivale a publicar, así que el exportador imprime qué va a escribir.
- **18.** No se aplica a la web, pero los datos de las gráficas van compactos (cientos de puntos, no muestras).

**Lo que hay hoy.**
- **`libs/core`:**
  - `AudioFeaturesSchema` y `FEATURE_METRICS`.
  - `TaskSchema` `{ taskId, createdAt, request, source, target, criteria }`.
  - `VerificationSchema` `{ taskId, attempt, verifiedAt, render: { path, sha256 }, pass, results }`, donde cada resultado es `{ id, derived, metric, basis, status, measured, min, max, sourceValue, renderValue }`.
  - `ToolCallTraceSchema` `{ sessionId, step, taskId, tool, args, ok, result, errorCode, durationMs, startedAt, cacheHits }`.
  - `AnalyzerPort.analyze(path, { targetBpm? })`.
  - `StoragePort`: `getTask`, `listVerifications(taskId)` (en orden de `attempt`) y `listToolCalls({ limit? })` (las más recientes primero).
- **`libs/adapters/analysis-py`:** `PythonAnalyzer`. Ejecuta `python -m analysis analyze [--target-bpm N] -- <ruta>` sin shell, con tiempo límite (120 s por defecto), stdout de 1 MB como máximo y stderr truncado. Valida la salida con zod y traduce los códigos de salida 2, 3 y 1 a `file_not_found`, `unsupported_format` y `analysis_failed`. Tiene pruebas `*.contract.test.ts` con Python real.
- **`python/analysis`:**
  - `cli.py`: argparse con subcomandos y un parser que sale con 1 ante argumentos inválidos. Los errores salen por stderr como `code: mensaje` y el JSON por stdout.
  - `audio.load`, `to_mono` y `levels.band_energies_db`, que usa Welch y dB relativos a un seno de fondo de escala.
  - Pruebas con pytest en `python/analysis/tests`.
- **`apps/mcp-server`:** `config.ts` (`readConfig(env)` con `workspaceRoot`, `dataDir`, `pythonPath` y `databasePath(dataDir)`). En `scripts/` están `mcp-call.ts`, `mcp-traces.ts` y `reaper-bridge.ts`, que se lanzan desde el `package.json` de la raíz.
- **`libs/tools`:** `resolveAssetPath(workspaceRoot, input)` y `analyzeWithCache(ctx, path, options)`.
- **`libs/testing`:** `FakeAnalyzer` (con `resultFor` por ruta) y `FakeStorage`.

**Contrato: activos de audio.** `python -m analysis replay-assets --out <archivo.mp3> -- <entrada>`:
- **Qué hace:** escribe un MP3 estéreo a 44100 Hz (`MPEG_LAYER_III`, `compression_level` 0,5 o la opción equivalente que dé unos 128 kbps) y saca por stdout este JSON, validado con `ReplayAssetsSchema`:
  ```json
  { "durationSec": 5.647, "waveform": { "min": [-0.81, …], "max": [0.79, …] },
    "spectrum": { "freqHz": [20.0, …], "db": [-42.1, …] } }
  ```
- **`waveform`:** 800 cubos sobre la mezcla mono, con el mínimo y el máximo de cada uno, en [-1, 1] y redondeados a 3 decimales.
- **`spectrum`:** 96 bandas logarítmicas de 20 Hz a 20 kHz, con la media de Welch en dB relativos a un seno de fondo de escala (la misma referencia que `bands`), redondeadas a 1 decimal y limitadas a -120.
- **Errores:** los mismos códigos y códigos de salida que `analyze`. La salida no puede ser un archivo ya existente: es un error de argumentos, con salida 1.
- **Desde TypeScript:** `AnalyzerPort` gana `replayAssets(input: AssetPath, output: string): Promise<ReplayAssets>`.

**Contrato: `run.json`** (`ReplayRunSchema`, `schemaVersion: 1`, estricto):
```json
{
  "schemaVersion": 1,
  "taskId": "…", "title": "Loop of 4 bars at 170 BPM", "request": "…", "createdAt": "…",
  "target": { "bpm": 170, "bars": 4, "beatsPerBar": 4 },
  "criteria": [ /* TaskCriterion[] */ ],
  "source": { "file": "source.mp3", "features": { /* AudioFeatures */ }, "assets": { /* ReplayAssets */ } },
  "verifications": [
    { "attempt": 1, "verifiedAt": "…", "pass": false, "results": [ /* CriterionResult[] */ ],
      "render": { "file": "render-1.mp3", "features": { … }, "assets": { … } } }
  ],
  "steps": [ { "step": 3, "sessionId": "…", "tool": "start_task", "startedAt": "…", "durationMs": 8,
               "ok": true, "errorCode": null, "args": { … }, "result": { … } } ]
}
```
- **`steps`:** todas las trazas con ese `taskId`, ordenadas por `startedAt` y después por `step`.
- **`file`:** un nombre dentro de la carpeta de la ejecución (`^[a-z0-9-]+\.mp3$`), nunca una ruta.
- **`features`:** el análisis del audio original. El del render se hace con `targetBpm = target.bpm`; el del origen, sin `targetBpm`.
- **`title`:** opcional al exportar (si falta, es la `request`), de 1 a 120 caracteres.
- **Índice:** `runs/index.json` (`ReplayIndexSchema`) es `{ schemaVersion: 1, runs: [{ taskId, title, createdAt, pass, attempts }] }`, ordenado de la más reciente a la más antigua. `pass` es el de la última verificación.

**Exportador.** `pnpm replay:export <taskId> [--title "<text>"]`:
- Usa `readConfig` del servidor MCP y abre SQLite en solo lectura, o, si no hay opción, sin escribir.
- Lee la tarea, sus verificaciones (al menos una, o error) y sus trazas.
- Valida con `resolveAssetPath` la `source` de la tarea y la ruta de cada render.
- Por cada audio, llama a `replayAssets` y a `analyze` (con la caché si encaja).
- Escribe `apps/web/public/runs/<taskId>/` (`run.json`, `source.mp3` y `render-<attempt>.mp3`) y regenera `apps/web/public/runs/index.json` leyendo todas las carpetas.
- Si la carpeta ya existe, la sustituye entera.
- Termina imprimiendo las rutas y los tamaños escritos, y avisa si una ejecución pasa de 15 MB.
- No lleva rutas absolutas en `run.json`.

**Web (`apps/web`).**
- **Rutas:** Angular 22, routing con hash (`withHashLocation`) para que GitHub Pages no necesite un 404 propio, y `base href` configurable en el build (`/Reaper-Copilot/` en Pages).
- **Datos:** `RunsService` carga `runs/index.json` y `runs/<id>/run.json` con `fetch` o `HttpClient` y los valida con los esquemas de `core`. Si un archivo no valida, la página muestra «This run could not be loaded» sin romper el resto.
- **Páginas:**
  - **`/`:** la lista de ejecuciones, con el título, la fecha, `pass` o `fail` y el número de intentos.
  - **`/runs/:taskId`:** la ejecución, con:
    - una cabecera con el título, la petición literal, el objetivo y el resultado global;
    - la tabla de criterios por intento, con `measured`, `min`, `max` y `status`;
    - la línea temporal de pasos (herramienta, ok o código de error, duración), con `args` y `result` desplegables como JSON con formato;
    - el panel de audio: reproductores de antes (origen) y después (render del intento elegido), la forma de onda en SVG con una marca de reproducción que sigue a `timeupdate` y permite saltar con un clic, y el espectro de antes y después superpuestos en SVG con el eje logarítmico en Hz.
- **Texto:** todo en inglés, salvo la petición original, que se muestra tal como la escribió el usuario (sección 7).
- **Accesibilidad:** contraste suficiente, controles con teclado y etiquetas en los reproductores.
- **Pruebas:** con Vitest y jsdom, con datos de ejemplo validados por el esquema.

**Despliegue.**
- **Workflow:** `.github/workflows/pages.yml` corre en cada push a `main` que toque `apps/web/**`, `libs/core/**` o el propio workflow, y también a mano (`workflow_dispatch`). Hace `pnpm install`, el build de `apps/web` con `--base-href /Reaper-Copilot/` y despliega con `actions/upload-pages-artifact` y `actions/deploy-pages`, con permisos `pages: write` e `id-token: write`.
- **Paso manual del autor:** activar Pages en Settings → Pages → Source: GitHub Actions.

**Verificación y commits** (skill `sdd`, secciones 3 y 4).
- **Antes de cada commit:** `pnpm check` en verde. Las tareas de Python ejecutan también `pnpm py:test` y `pnpm check:full`.
- **Commits:** uno por tarea en `fase/F3-replay`, sin push. Mensaje en inglés `<tipo>(<ámbito>): <resumen>` con la línea `Co-Authored-By` vigente. Añade los archivos por nombre y marca la casilla de la tarea en este archivo, en el mismo commit.
- **Fuera de alcance:** no toques `spikes/` ni `specs/spikes/`.

## 3. Qué cambia, por carpeta

| Ruta | Cambio |
|---|---|
| `libs/core/` | `replay.ts`: `ReplayAssetsSchema`, `ReplayRunSchema`, `ReplayIndexSchema`; `AnalyzerPort.replayAssets`; `listToolCalls({ taskId })` |
| `libs/adapters/storage-sqlite/`, `libs/testing/` | Filtro por `taskId` en `listToolCalls`; `FakeAnalyzer.replayAssets` |
| `python/analysis/` | `replay.py` y el subcomando `replay-assets`, con pruebas |
| `libs/adapters/analysis-py/` | `PythonAnalyzer.replayAssets` con su prueba de contrato |
| `apps/mcp-server/scripts/` | `replay-export.ts`; `pnpm replay:export` en la raíz |
| `apps/web/` | Nuevo: aplicación Angular y `public/runs/` con las ejecuciones exportadas |
| `.github/workflows/` | `pages.yml` |
| raíz | `package.json`, `pnpm-workspace.yaml` si hace falta, `README.md` en inglés |
| `docs/`, `CLAUDE.md` | 4.2, 6.4, 8.1, 9.3, 10, 14.1 y 15.2 del documento maestro (v2.11); comandos nuevos; historial y estado |

## 4. Decisiones y riesgos

| Decisión | Alternativa descartada |
|---|---|
| MP3 con `soundfile` y gráficas precalculadas en Python (decisión del usuario) | ffmpeg con gráficas calculadas en el navegador: hay que instalarlo, y la web decodifica y calcula al cargar |
| El subcomando de Python a través de `AnalyzerPort.replayAssets` | Que el exportador llame a Python directamente: salta el puerto (constitución, regla 7) |
| Ejecuciones exportadas en `apps/web/public/runs/`, versionadas en git | Generarlas en el CI: el CI no tiene la base de datos ni el audio. Git LFS: más configuración para unos pocos MB |
| Una ejecución por invocación, con `--title` opcional en inglés | Exportar varias a la vez: el título en inglés es por ejecución y las peticiones suelen estar en español |
| `run.json` validado en la web con el esquema de `core` | Tipos sin validación en la web: un `run.json` corrupto rompería la página |
| Routing con hash | Rutas limpias con un `404.html` copiado: un truco más en el build de Pages |
| El audio de «antes» es el archivo de origen entero | Recortar el tramo cortado a partir de las trazas: depende de los argumentos de `slice_loop` y se sale del alcance |
| Sin indicador de Live hasta la fase 4 | Un indicador fijo en «no disponible»: promete algo que aún no existe |

Riesgos:
- **Angular 22 con TypeScript 6.0, Vitest 5 y pnpm 12** en un monorepo Nx sin `@nx/angular`. Mitigación: T4 es solo el andamiaje, con la lista mínima en verde en `pnpm check` y en el CI. Si no encaja, para y lo decimos antes de seguir.
- **Peso del repositorio:** cada ejecución lleva los MP3 de origen y de render. A unos 128 kbps, un tema de 3 minutos ocupa unos 3 MB. El exportador avisa a partir de 15 MB por ejecución.
- **Calidad del MP3 de libsndfile:** se escucha en la demostración. Si suena mal, se sube la calidad.
- **Datos personales publicados:** `run.json` lleva la petición literal y los argumentos de las herramientas. No hay rutas absolutas porque las trazas no las tienen, pero el autor revisa lo exportado antes del commit.

## 5. Tareas

- [x] **T1. Contratos del Replay y trazas por tarea.**
  - Cambios:
    - `libs/core/src/replay.ts` con `ReplayAssetsSchema`, `ReplayRunSchema` y `ReplayIndexSchema`, con sus reglas: `file` con patrón, `title` de 1 a 120 caracteres, 800 valores por canal en `waveform`, 96 en `spectrum` y `freqHz` creciente.
    - `AnalyzerPort.replayAssets`.
    - `StoragePort.listToolCalls({ limit?, taskId? })`, con `SqliteStorage` y `FakeStorage` y los dos conjuntos compartidos.
    - `FakeAnalyzer.replayAssets`, que devuelve activos de ejemplo válidos y registra la llamada.
  - Hecho cuando: hay pruebas de los esquemas (un ejemplo completo válido, `file` con `/` o `..` rechazado, una longitud de `waveform` distinta de 800 rechazada) y el filtro por `taskId` devuelve solo las trazas de esa tarea en las dos implementaciones.
- [x] **T2. Subcomando de Python `replay-assets` y adaptador.**
  - Cambios:
    - `python/analysis/src/analysis/replay.py` y su entrada en `cli.py`.
    - `PythonAnalyzer.replayAssets`, con el tiempo límite y la validación de `analyze`.
    - Prueba de contrato con Python real.
  - Hecho cuando:
    - En pytest, un seno de 1 kHz a -12 dBFS da un MP3 legible con `soundfile`, de duración ±50 ms, con el pico del espectro en la banda de 1 kHz cerca de -12 dB (±3) y la forma de onda en ±0,25 (±0,05).
    - Una salida existente da código 1 y una entrada inexistente código 2.
    - La prueba de contrato valida la salida real con `ReplayAssetsSchema`.
    - `pnpm check:full` en verde.
- [x] **T3. Exportador `pnpm replay:export`.**
  - Cambios: `apps/mcp-server/scripts/replay-export.ts` y el script en la raíz.
  - Hecho cuando: hay pruebas con `FakeStorage`, `FakeAnalyzer` y un workspace y una salida temporales que cubren estos casos:
    - escribe `run.json`, que valida con `ReplayRunSchema`, junto a los MP3 esperados, y regenera `index.json`;
    - una `source` guardada fuera del workspace da `path_outside_workspace` y no escribe nada;
    - una tarea sin verificaciones da error;
    - repetir la exportación sustituye la carpeta;
    - no hay rutas absolutas en `run.json`.
  - Para poder probarla, la lógica va en una función con los puertos y las rutas inyectados, y el script solo la cablea.
- [x] **T4. Andamiaje de `apps/web`.**
  - Cambios:
    - Las dependencias aprobadas y `angular.json`.
    - La aplicación zoneless con router hash y la página `/` con la lista, leyendo `runs/index.json` con `RunsService`, que valida con `ReplayIndexSchema`.
    - Los scripts `typecheck`, `lint`, `test` (Vitest con jsdom), `build` y `start`.
    - `apps/web/public/runs/index.json` vacío y válido.
  - Hecho cuando:
    - `pnpm check` y `pnpm check:full` incluyen `apps/web` y salen en verde.
    - `pnpm nx run web:build` (o el nombre que tenga el proyecto) genera el sitio.
    - Hay pruebas de la lista con un índice de ejemplo y con uno inválido, que muestra el mensaje de error.
- [x] **T5. Página de ejecución: cabecera, criterios y pasos.**
  - Cambios: la ruta `/runs/:taskId`, con la cabecera, la tabla de criterios por intento (con el intento elegible) y la línea temporal de pasos con `args` y `result` desplegables.
  - Hecho cuando: con un `run.json` de ejemplo de dos intentos (`fail` y `pass`), las pruebas muestran los dos intentos y los valores de `measured`, y un texto con `<script>` en `request` o en `args` sale como texto literal. Un `run.json` inválido muestra el mensaje de error.
- [x] **T6. Panel de audio: reproductores, forma de onda y espectro.**
  - Cambios: componentes SVG propios para la forma de onda (con marca de reproducción y salto con clic) y para el espectro de antes y después en eje logarítmico, más los reproductores HTML de antes y después del intento elegido.
  - Hecho cuando: las pruebas comprueban que el SVG de la forma de onda tiene un trazado a partir de los 800 puntos, que un `timeupdate` simulado mueve la marca y que un clic fija `currentTime`. El espectro dibuja dos series con 96 puntos y los reproductores tienen etiqueta accesible.
- [x] **T7. Despliegue en GitHub Pages.**
  - Cambios: `.github/workflows/pages.yml` y el build con `--base-href /Reaper-Copilot/`.
  - Hecho cuando: el build local con ese `base href` genera `index.html` con `<base href="/Reaper-Copilot/">` y los recursos relativos, y el workflow pasa `actionlint` si está disponible o una revisión de su sintaxis. El despliegue real se comprueba en la demostración.
- [x] **T8. Documentación.**
  - Cambios:
    - Documento maestro v2.11:
      - **4.2:** el indicador de Live queda para la fase 4.
      - **6.4:** `AnalyzerPort.replayAssets` y `listToolCalls` con `taskId`.
      - **8.1:** el subcomando `replay-assets`.
      - **9.3:** el contrato de `run.json` y el exportador.
      - **10:** GitHub Pages.
      - **14.1:** ffmpeg ya no es necesario para el Replay.
      - **15.2:** se cierran las preguntas 1 (solo hosting), 4 y 5 (Replay).
    - `README.md` en inglés: qué es, los tres bloques, el enlace al Replay, cómo instalar y registrar el servidor MCP, y los comandos.
    - `CLAUDE.md` con `replay:export` y cómo arrancar la web.
    - `CHANGELOG.md` y `docs/estado.md`.
  - Hecho cuando: `pnpm check:full` pasa, el documento no contradice lo implementado y `docs/estado.md` tiene 30 líneas o menos.

## 6. Demostración de la fase

Criterio de salida: URL pública con al menos tres ejecuciones reales.

1. `pnpm check` y `pnpm check:full` en verde. El CI pasa en la pull request.
2. El autor copia su propio audio en `workspace/` y, en Claude Code en modo `agent`, hace al menos tres tareas completas con `start_task`, las herramientas de Reaper y `verify_task`. Al menos una debe tener dos intentos.
3. Exporta cada una con `pnpm replay:export <taskId> --title "<English title>"` y revisa la salida (rutas y tamaños) antes del commit.
4. `pnpm --filter web start` (o el comando que quede en `CLAUDE.md`) abre la web en local. Hay que ver la lista de tres ejecuciones y, en cada una, la petición, los pasos, los criterios por intento, los dos reproductores, la forma de onda con la marca de reproducción y el espectro superpuesto.
5. Commit de las ejecuciones, pull request a `main` y fusión. El autor activa Pages (Settings → Pages → Source: GitHub Actions). El workflow despliega y `https://cristianantval85.github.io/Reaper-Copilot/` muestra las tres ejecuciones con el audio reproduciéndose.

## 7. Correcciones de la validación

Primera vuelta de validación; todo corregido en `fix(web): route input binding, player and mobile fixes, exporter hardening`.

| # | Hallazgo | Decidido |
|---|---|---|
| 1 | `RunPage.taskId` nunca se rellenaba (sin `withComponentInputBinding()`), todas las ejecuciones fallaban | `withComponentInputBinding()` en `app.config.ts`; prueba con `RouterTestingHarness` y la configuración real; el `catch` hace `console.error` y sigue mostrando el mensaje |
| 2 | `*.mp3` ignoraba los MP3 exportados | negación `!apps/web/public/runs/**/*.mp3` (comprobada con `git check-ignore`); línea en `CLAUDE.md` sobre audio propio (constitución 16) |
| 3 | Reproductores | al reproducir uno se pausa el otro; al cambiar de intento «After» se pausa y vuelve a 0 |
| 4 | Espectro ilegible en móvil | texto de ejes y títulos («Frequency (Hz, logarithmic)», «Level (dB, relative to full scale)») en HTML a 12 px; marcas en 20 Hz y 20 kHz; en móvil se oculta la marca de 10k para que no choque con 20k |
| 5 | Contexto del visitante | párrafo, enlace al repositorio, `<meta name="description">` y leyenda bajo la tabla |
| 6 | Petición en otro idioma | **Decisión del usuario (b):** se muestra en su idioma original, con la etiqueta «Original request», bajo el título en inglés; no se traduce ni se pide en inglés; sin `lang` |
| 7 | Móvil | tabla en contenedor con scroll, región etiquetada y enfocable; `summary` con `flex-wrap`; fila de lista en columna; fechas en UTC con formato fijo |
| 8 | Forma de onda | parte reproducida con `clipPath` y tono más oscuro; `aria-orientation="horizontal"` |
| 9 | Exportador | `taskId` validado como uuid; fallo sin escribir si queda una ruta de host tras `scrubPaths`; el índice se regenera antes de borrar `.old` y, si falla, se restaura la carpeta anterior |
| 10 | Workflow | `contents: read` global; `pages: write` e `id-token: write` solo en `deploy` |
| 11 | Formato fuera de alcance | revertido en `python-analyzer.ts` |
| 12 | Presupuesto del bundle | aviso a 800 kB (el bundle inicial son unos 730 kB por zod de `core`), comentado en `angular.json` |

Añadido sin pedirlo: `**/.angular/` en los ignores de ESLint (la caché de Angular rompía `lint` de `web`).

Segunda vuelta (`reviewer`, `reviewer-security` y `reviewer-ui`: APROBADO). Corregido además en `47c6e41`: la página de ejecución se recarga cuando solo cambia el `taskId` (el router reutiliza el componente; hallazgo medio de `reviewer-ui`, con prueba de navegación entre ejecuciones), la cabecera dice «Final result» y el exportador rechaza también `C:/`, `/Users/` y `/root/`. Los bajos restantes están en `docs/estado.md`.

## 8. Cambio de alcance (2026-11-18): el paso alto de `eq_lowcut` no actúa

**Hallazgo de la demostración.** En la tarea 3, `eq_lowcut` dejó la banda sub igual: −6,50 dB en el render frente a −6,46 dB en el mismo tramo sin efectos. La verificación dio `fail` (tarea `c7dc0e09-96a2-4fb4-937c-b726683ac5c2`, que no se publica). El autor comprobó en la ventana de ReaEQ que la banda 5 (High Pass) aparece **sin activar**: el preset fija `Freq-High Pass 5` a 80 Hz, pero la banda está apagada. La prueba de integración de F2a solo leía el valor mostrado del parámetro, no medía el sonido. Por eso no se detectó.

**Alcance.** Entra:
- que un preset fije ajustes de configuración del plugin, de una lista cerrada;
- que el puente los aplique con `TrackFX_SetNamedConfigParm` y los relea;
- una prueba con Reaper real que mida la caída de la banda sub;
- repetir la tarea 3 de la demostración.

No entra: revisar los rangos de los presets (pregunta abierta 7) ni otros plugins.

**Contexto para el implementador.**
- **API de Reaper:** `TrackFX_SetNamedConfigParm(track, fx, name, value)` devuelve `true` si el plugin acepta la clave. `TrackFX_GetNamedConfigParm(track, fx, name)` devuelve `ok, value`. En ReaEQ, las claves `BANDENABLEDx` usan índice desde 0: la banda 5 es `BANDENABLED4`, con valor `"1"` (activa) o `"0"`. **Comprobarlo primero en T10 con Reaper real.** Si la clave no existe o no activa la banda, para y avisa antes de seguir.
- **Lo que hay hoy** (`libs/core/src/daw.ts`):
  - `FxChainSchema` = `[{ plugin, params: [{ name, value }] }]`.
  - `AppliedFxChainSchema` = `{ trackId, fx: [{ plugin, params: [{ name, text }] }] }`.
  - `PresetSchema.fx[]` = `{ plugin, params: record<name, { knob } | { value }> }`.
  - `ALLOWED_FX_PLUGINS`, repetida en `bridge.lua` como `FX_ALLOWED`.
  - La resolución de preset a cadena está en `libs/tools/src/apply-fx-chain.ts`. `bridge.lua` `methods.apply_fx_chain` valida la entrada antes del bloque de deshacer, añade los FX dentro de él y, si algo falla, borra los añadidos. `FakeDaw.applyFxChain` está en `libs/testing`.
- **Reglas que aplican:**
  - **3 y 4:** contrato zod primero, y una prueba por contrato.
  - **11:** el conjunto de comandos es cerrado. Las claves de configuración son una lista cerrada por plugin, validada en `core` (al cargar los presets) y otra vez en el puente. Nunca se pasa una clave libre.
  - **12:** el ajuste va dentro del mismo bloque de deshacer que el FX.
- **Seguridad:** `reviewer-security` revisa este cambio, porque toca `reaper/bridge/` y `libs/adapters/reaper/`.

**Contrato nuevo.**
- **`ALLOWED_FX_CONFIG`** (en `core`, repetida en `bridge.lua` como `FX_CONFIG_ALLOWED`, y deben ser iguales): `{ "ReaEQ (Cockos)": /^BANDENABLED[0-9]$/ }`, con valores `/^[01]$/`.
- **`PresetSchema.fx[]`** gana `config?: record<string, string>`. `loadPresets` rechaza una clave o un valor fuera de la lista del plugin, así que el servidor no arranca con un preset inválido.
- **`FxChainSchema`:** cada entrada gana `config: [{ name, value }]`, con `[]` por defecto.
- **`AppliedFxChainSchema`:** cada entrada gana `config: [{ name, value }]`, con el valor releído de Reaper. La salida de `apply_fx_chain` lo incluye, y así el LLM y el Replay ven que la banda quedó activa.
- **Errores en el puente:**
  - una clave no permitida da `fx_not_allowed`;
  - si `SetNamedConfigParm` devuelve `false`, da `param_not_found`;
  - en los dos casos se borran los FX añadidos, como hoy.

  Los dos códigos ya existen y el adaptador los traduce a `daw_error`.
- **`reaper/presets/eq_lowcut.json`:** `"config": { "BANDENABLED4": "1" }` en la entrada de ReaEQ.

**Qué cambia, por carpeta.**

| Ruta | Cambio |
|---|---|
| `libs/core/` | `ALLOWED_FX_CONFIG`, `config` en `PresetSchema`, `FxChainSchema` y `AppliedFxChainSchema`, con pruebas |
| `libs/tools/` | `loadPresets` valida `config`; `apply-fx-chain.ts` lo pasa a la cadena y lo devuelve |
| `libs/testing/` | `FakeDaw.applyFxChain` devuelve el `config` recibido |
| `reaper/bridge/` | `FX_CONFIG_ALLOWED`; validación, `SetNamedConfigParm` y relectura en `apply_fx_chain` |
| `libs/adapters/reaper/` | Prueba `*.reaper.test.ts` que mide el sonido |
| `reaper/presets/` | `eq_lowcut.json` con `config` |
| `docs/` | Documento maestro v2.12 (sección 7: fila de `apply_fx_chain` y «Presets de FX como datos»; sección 8.2: el puente se defiende solo, punto (1), y parámetros de FX), `CHANGELOG.md` y `estado.md` |

**Decisiones.**

| Decisión | Alternativa descartada |
|---|---|
| `config` genérico en el preset, con una lista cerrada de claves por plugin | Que el puente active la banda 5 siempre que añade ReaEQ: es un caso especial oculto y no sirve para otras bandas ni plugins |
| Releer el valor y devolverlo en la salida | Fiarse del `true` de `Set`: sería repetir el error de F2a, que solo comprobaba la escritura |
| Prueba que mide el sonido, con Python real | Comprobar solo `GetNamedConfigParm`: la banda podría estar activa y aun así no filtrar |
| Las tareas siguen con T9-T11, por encima del máximo de 8, como corrección de la fase | Abrir una fase aparte: retrasa el cierre de F3 por un fallo de F2a de tres tareas |

**Riesgos.**
- **La clave puede no llamarse como suponemos.** T10 empieza comprobándola.
- **La pendiente del paso alto de ReaEQ es desconocida.** Por eso el umbral de la prueba es moderado.

**Tareas.**

- [ ] **T9. Contrato de `config` y presets.**
  - Cambios:
    - `ALLOWED_FX_CONFIG` y `config` en los tres esquemas de `core`.
    - Validación en `loadPresets`.
    - `apply-fx-chain.ts` y `FakeDaw` pasan y devuelven `config`.
    - `eq_lowcut.json` con `BANDENABLED4: "1"`.
  - Hecho cuando hay pruebas que demuestran que:
    - un preset con `config` permitido valida;
    - una clave no permitida (`FOO`, o `BANDENABLED4` en `ReaLimit`) o un valor `"2"` hacen fallar `loadPresets`;
    - `apply_fx_chain` con `FakeDaw` y `eq_lowcut` envía `config: [{ name: "BANDENABLED4", value: "1" }]` y lo devuelve en la salida;
    - las cadenas sin `config` siguen funcionando;
    - `pnpm check` sale en verde.
- [ ] **T10. Puente y prueba con Reaper real.**
  - Cambios:
    - `FX_CONFIG_ALLOWED` y la validación antes del bloque de deshacer.
    - `TrackFX_SetNamedConfigParm` y `TrackFX_GetNamedConfigParm` dentro del bloque, con limpieza si falla.
    - Prueba nueva en `reaper-daw.reaper.test.ts`.
  - Hecho cuando:
    - **Primero:** con Reaper real, `BANDENABLED4 = "1"` se acepta y se relee como `"1"`. Si no es así, para y avisa.
    - **La prueba del sonido pasa:** genera en el workspace un WAV de 4 s con un seno de 40 Hz y otro de 1 kHz (−12 dBFS cada uno), lo importa, le aplica la cadena de `eq_lowcut` resuelta del preset, lo renderiza y lo mide con `PythonAnalyzer`. La banda `sub` del render debe bajar al menos 6 dB respecto al original, y `mid` no debe cambiar más de 1 dB.
    - **La clave prohibida se rechaza:** una clave no permitida da `fx_not_allowed` sin dejar FX en la pista.
    - **Verificación:** `pnpm check` en verde, y `pnpm test:reaper` en verde en local.
- [ ] **T11. Documentación y repetición de la tarea 3.**
  - Cambios:
    - Documento maestro v2.12 en las secciones indicadas.
    - `CHANGELOG.md` y `docs/estado.md`, dentro de sus 30 líneas.
  - Hecho cuando:
    - el documento no contradice lo implementado;
    - `pnpm check:full` sale en verde;
    - el autor repite la tarea 3 con un `taskId` nuevo, la verificación de la banda sub da `pass` y la salida de `apply_fx_chain` muestra `BANDENABLED4: "1"`.
