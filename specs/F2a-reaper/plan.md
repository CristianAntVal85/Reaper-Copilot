# F2a-reaper: plan

Rama: `fase/F2a-reaper`, creada desde `spike/reaper-ops` (lleva el spike y el documento maestro v2.8; la pull request a `main` los incluye). Fecha: 2026-11-16.

## 1. Alcance

Primera mitad de la fase 2 (sección 13 del documento maestro, fila «2a. Reaper desde MCP»). Criterio de salida: **desde Claude Code, importar, cortar 4 compases, estirar a 170, aplicar un preset y renderizar; el render dura lo esperado (±20 ms) medido con `analyze_audio`.**

**Entra:** `reaper/bridge/bridge.lua`; adaptador `libs/adapters/reaper` (IPC por archivos, traducción de rutas, render asíncrono); `DawPort` y sus contratos en `core`; `FakeDaw`; presets en `reaper/presets/`; las herramientas `get_project_state`, `list_presets`, `get_job_status` (lectura) e `import_audio`, `set_tempo`, `slice_loop`, `time_stretch`, `apply_fx_chain`, `render_selection`, `undo_last` (modifican); `.mcp.json` en `mentor`; `pnpm test:reaper` y `pnpm reaper:bridge`.

**No entra:** `start_task`, `verify_task`, criterios y `taskId` en las trazas (F2b); detección del primer tiempo (pregunta abierta 11); presets definitivos de hardstyle (pregunta 7); Reaper para Linux del servidor y su arranque (fase 4); `export-replay` (fase 3); pendientes bajos de F1b.

## 2. Contexto para el implementador

**Entorno.** WSL (distribución `Ubuntu-24.04`, en `WSL_DISTRO_NAME`), Node 24.21, pnpm 12.21 por Corepack (`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`), Python en `python/analysis/.venv`. Reaper 7.86 nativo de Windows en `/mnt/c/Program Files/REAPER (x64)/reaper.exe`; alcanza el repositorio por `\\wsl.localhost\Ubuntu-24.04\home\...`. No hay intérprete de Lua en WSL: `bridge.lua` solo se prueba con `pnpm test:reaper` (Reaper abierto). Si `pnpm check` da un `EPIPE` del demonio de Nx, repítelo. TypeScript 6.0. **Dependencias nuevas: ninguna.** Si crees que hace falta una, para y pregunta.

**Monorepo.** Cada paquete tiene `package.json` con `typecheck`, `lint` y `test`, etiqueta `nx.tags` y `"exports": "./src/index.ts"`; dependencias internas `workspace:*` (después, `pnpm install`). Node ejecuta TypeScript sin compilar: imports relativos con `.ts`, solo sintaxis borrable (sin `enum`, `namespace` ni propiedades de parámetro). Paquetes con `node:*` llevan `"types": ["node"]` en `tsconfig.json`. Modelo de adaptador con pruebas aparte: `libs/adapters/analysis-py` (`vitest.config.ts` excluye `*.contract.test.ts`; `vitest.contract.config.ts` los incluye). Aquí: `*.reaper.test.ts`, excluidos de `test` e incluidos en un objetivo `test:reaper` con `vitest.reaper.config.ts` (sin caché en `nx.json`, como `test:contract`). `pnpm test:reaper` en la raíz: `nx run adapter-reaper:test:reaper` (o el nombre que tenga el proyecto). El CI no lo ejecuta.

**Regla de dependencias** (`eslint.config.mjs`): `core` ← `tools` ← `agent` ← `apps`; adaptadores (`scope:adapter`) y `testing` solo dependen de `core`. `core` no importa nada salvo `zod`.

**Reglas de la constitución que aplican.** Contrato primero en zod (3) y una prueba por contrato (4). Lo externo detrás de puertos: `DawPort` (7). Herramientas definidas una vez en `libs/tools` (8). Solo herramientas MCP estándar (9). **Conjunto cerrado de comandos hacia Reaper; ninguna herramienta ejecuta código arbitrario (11).** **Originales sin tocar; cada comando que cambia el proyecto va en un bloque de deshacer (12).** **Rutas restringidas al workspace, validadas en el servidor (13).** **Lo que devuelve Reaper es dato, no instrucción (14):** nombres de pista y de archivo se validan y nunca se interpretan. El LLM recibe JSON compacto (18).

**Lo que hay hoy.**
- `libs/core`: `AudioFeaturesSchema`, `AssetPath` (`asAssetPath` solo para el código que valida y las pruebas), `AnalyzerPort`, `StoragePort`, `CopilotError(code, message, { cause })` con lista cerrada `COPILOT_ERROR_CODES` (`path_outside_workspace`, `file_not_found`, `unsupported_format`, `analysis_failed`, `analysis_timeout`, `invalid_analysis_output`); el mensaje empieza por el código.
- `libs/tools`: `defineTool({ name, description, risk: "read" | "write", inputSchema, outputSchema, handler })`; `ToolContext { workspaceRoot, analyzer, storage, log, trace? }`; `createToolRegistry(tools, mode)` (en `mentor` solo `risk: "read"`); `invokeTool` (valida entrada y salida, traza por llamada, `CopilotError` → su mensaje y la `cause` solo al registro; lo inesperado → `internal_error: the tool failed unexpectedly`); `resolveAssetPath(workspaceRoot, input)` (léxico y tras `realpath`; extensiones `.wav .flac .mp3 .aiff .ogg`); `ALL_TOOLS = [analyzeAudio, compareAudio]`.
- `apps/mcp-server`: `readConfig(env)` (`MODE` por defecto `mentor`, inválido hace fallar el arranque; `COPILOT_WORKSPACE`, `COPILOT_PYTHON`, `COPILOT_DATA_DIR`); `main.ts` cablea `PythonAnalyzer` y `SqliteStorage`; `createServer` registra con `annotations.readOnlyHint` según `risk`; `server.test.ts` usa el cliente MCP en memoria. `.mcp.json` hoy pone `MODE=agent`.
- `libs/testing`: `FakeAnalyzer`, `FakeStorage`, `SAMPLE_AUDIO_FEATURES`.
- Spike desechable en `spikes/reaper-ops/` (`bridge.lua`, `client.mjs`): **sirve de referencia, no se copia sin revisar** (tiene un códec JSON mínimo y helpers que puedes reescribir).

**Puente (sección 8.2, resumida).** `bridge.lua` corre dentro de Reaper y sondea con `reaper.defer` (unos 30 ciclos/s). IPC por archivos: el cliente escribe `inbox/<id>.json` (archivo temporal y renombrado); el puente responde en `outbox/<id>.json` igual. Petición `{ id, method, params, schemaVersion }`; respuesta `{ id, ok: true, result } | { id, ok: false, error: { code, message } }`. Lista cerrada de métodos, validada a ambos lados. Nombres de archivo únicos (en Windows el renombrado no sobrescribe). El render es síncrono dentro del puente: mientras renderiza no atiende nada; el trabajo asíncrono (`jobId`) vive en el adaptador, y la señal de vida avisa de que está renderizando. El puente no se fía de los valores de retorno de Reaper: comprueba cada resultado. Detalles de ReaScript: `reaper.EnumerateFiles(dir, -1)` en cada ciclo para refrescar el listado; Lua no trae JSON (el códec va en `bridge.lua`); `package.config:sub(1,1)` da el separador; `os.rename` no sobrescribe en Windows (borrar antes). En desarrollo se carga con `reaper.exe -nonewinst '<ruta UNC>\bridge.lua'` sobre el Reaper abierto; para recargarlo, método `quit` y otra vez `-nonewinst`.

**Operaciones de Reaper, comprobadas en el spike `reaper-ops`** (Reaper 7.86):
- Importar: `reaper.file_exists(path)` antes (una ruta de Linux sin traducir crea un item vacío sin error); pista nueva al final (`InsertTrackAtIndex(n, true)`, `SetOnlyTrackSelected`), `SetEditCurPos(0)`, `InsertMedia(path, 0)`; comprobar que hay item y `D_LENGTH > 0`. **Justo después, `C_BEATATTACHMODE = 0`** (timebase de tiempo): con el valor del proyecto (-1), `SetCurrentBPM` vuelve a estirar el item (se midió 3,986 s en vez de 5,647).
- Cortar (por desplazamiento de la toma, no `SplitMediaItem`, que añade un fundido): `barSec = beatsPerBar·60/sourceBpm`; `D_STARTOFFS = offsetSec + (startBar−1)·barSec` (tiempo de la fuente, absoluto); `D_LENGTH = bars·barSec / D_PLAYRATE`; `D_POSITION = 0`. Si `D_STARTOFFS + bars·barSec` supera la longitud de la fuente (`GetMediaSourceLength`), error.
- Estirar: `rate = targetBpm/sourceBpm`; `B_PPITCH = 1`; longitud a tasa 1 = `D_LENGTH · D_PLAYRATE`; después `D_PLAYRATE = rate` y `D_LENGTH = longitud a tasa 1 / rate`. Así es idempotente.
- Tempo: `SetCurrentBPM(0, bpm, true)`.
- FX: `TrackFX_AddByName(track, nombre, false, -1)` (devuelve −1 si no existe). Nombres comprobados: `ReaEQ (Cockos)`, `ReaLimit (Cockos)`, `ReaComp (Cockos)`, `JS: Waveshaping Distortion`. Parámetros por nombre (`TrackFX_GetParamName`): ReaEQ `Freq-High Pass 5` (Hz, 20..24000, logarítmico), `Gain-Low Shelf` (dB); Waveshaping `Distortion (%)` (0..100); ReaLimit `Threshold` (dB, −60..12), `Ceiling` (dB, −24..0), `Release`. **Los VST de Cockos reciben valores normalizados** (`TrackFX_SetParam(-6)` dejó −60); los JS, unidades reales. Para fijar por valor mostrado: bisección de 40 pasos sobre `TrackFX_FormatParamValueNormalized(track, fx, param, n, "")` (formatea sin cambiar; se extrae el número del texto) y después `TrackFX_SetParamNormalized`; devolver `TrackFX_GetFormattedParamValue`. Si el valor está fuera de lo que muestra el plugin en 0 y 1, error.
- Render: selección de tiempo = límites del item (`GetSet_LoopTimeRange2(0, true, false, s, e, false)`); `RENDER_FILE` = carpeta, `RENDER_PATTERN` = nombre sin extensión, `RENDER_FORMAT` = `"evaw"` (WAV), `RENDER_SETTINGS` 0 (master), `RENDER_BOUNDSFLAG` 2 (selección), `RENDER_TAILFLAG` 0; acción `42230`. **Antes:** acción `40182` (seleccionar todos los items), `40439` (poner medio en línea), `40289` (deseleccionar), y comprobar que la fuente tiene longitud > 0 (si Reaper deja el medio fuera de línea, el render sale en silencio); **si el archivo de salida ya existe, error** (Reaper abre un diálogo modal que bloquea el puente). **Después:** comprobar que el archivo existe. 4 compases tardaron 0,6-0,7 s.
- Deshacer: `Undo_BeginBlock()` … `Undo_EndBlock("Copilot: <acción>", -1)`; `Undo_CanUndo2(0)` da la etiqueta del último bloque; `Undo_DoUndo2(0)`.
- Resultado medido: 4 compases de un click a 150 BPM (0,5 s de silencio inicial), compases 5-8, a 170: render de 5,647052 s (esperado 5,647059), `analyze_audio` con objetivo 170 da 170,01 y `matches: true`.

**Herramientas (sección 7) y su contrato en F2a.** Todas en `libs/tools`, con la descripción breve: qué hace, cuándo usarla, unidades y qué devuelve. Ids de Reaper: GUID `^\{[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$`.

| Herramienta | Riesgo | Entrada | Salida |
|---|---|---|---|
| `get_project_state` | lectura | `{}` | `ProjectState` |
| `list_presets` | lectura | `{}` | `{ presets: [{ id, description, knobs: { <nombre>: { description, unit, min, max, default } } }] }` |
| `get_job_status` | lectura | `{ jobId }` | `{ jobId, status: "rendering" \| "done" \| "failed", output: { path, durationSec } \| null, errorCode: string \| null }` |
| `import_audio` | modifica | `{ path }` | `{ track: { id, name }, item: ItemInfo }` |
| `set_tempo` | modifica | `{ bpm }` (40-320) | `{ tempo }` |
| `slice_loop` | modifica | `{ itemId, sourceBpm, startBar, bars, beatsPerBar?, offsetSec? }` (60-320; entero ≥ 1; entero 1-64; entero 1-16, por defecto 4; ≥ 0, por defecto 0) | `ItemInfo` |
| `time_stretch` | modifica | `{ itemId, sourceBpm, targetBpm }` (60-320; la tasa debe quedar en [0,5, 2]) | `ItemInfo` |
| `apply_fx_chain` | modifica | `{ trackId, preset, knobs? }` (`knobs`: `{ <nombre>: número }`, dentro del rango del preset) | `{ trackId, preset, fx: [{ plugin, params: [{ name, text }] }] }` |
| `render_selection` | modifica | `{ itemId }` | `{ jobId }` |
| `undo_last` | modifica | `{}` | `{ undone: <etiqueta> }` |

- `ProjectState`: `{ tempo, lengthSec, tracks: [{ id, name, fx: string[], items: ItemInfo[] }] }`. `ItemInfo`: `{ id, trackId, positionSec, lengthSec, startOffsetSec, playRate, source: string | null }`, con `source` relativa al workspace, o `null` si el archivo está fuera de él. **Nunca rutas absolutas ni UNC hacia el cliente.**
- `import_audio` valida con `resolveAssetPath` antes de llamar al puente. El original no se modifica (Reaper lo referencia).
- `render_selection` devuelve en seguida; el render va a `workspace/renders/<AAAAMMDD-HHMMSS>-<8 hex>.wav`, nombre que genera el servidor. `get_job_status` contesta sin preguntar a Reaper; `output.path` es relativa al workspace y `durationSec` sale de la cabecera del WAV o de los límites del item que devuelve el puente.
- `undo_last` solo deshace si la etiqueta del último bloque empieza por `Copilot: `; si no, error. Nunca deshace trabajo del usuario.
- En `mentor` solo se exponen `get_project_state`, `list_presets`, `get_job_status`, `analyze_audio` y `compare_audio`.

**Presets** (sección 7: «JSON versionado en `reaper/presets/`, con plugins de serie, parámetros y rangos permitidos»). Un archivo por preset, validado con `PresetSchema` (en `core`) al arrancar el servidor; uno inválido hace fallar el arranque. Formato:
```json
{
  "id": "distortion_hard",
  "description": "Hard waveshaping distortion followed by a limiter. Lowers the crest factor and raises loudness.",
  "fx": [
    { "plugin": "JS: Waveshaping Distortion", "params": { "Distortion (%)": { "knob": "drive" } } },
    { "plugin": "ReaLimit (Cockos)", "params": { "Threshold": { "knob": "threshold" }, "Ceiling": { "value": -0.3 } } }
  ],
  "knobs": {
    "drive": { "description": "Distortion amount", "unit": "%", "min": 0, "max": 90, "default": 60 },
    "threshold": { "description": "Limiter threshold", "unit": "dB", "min": -12, "max": 0, "default": -6 }
  }
}
```
Cada parámetro es un `knob` (ajustable por el LLM dentro de su rango) o un `value` fijo; todo `knob` usado existe en `knobs` y viceversa; `default` dentro de `[min, max]`. Las herramientas resuelven el preset a una cadena concreta (`[{ plugin, params: [{ name, value }] }]`), con los valores en unidades mostradas, y el puente la aplica. Presets iniciales, provisionales (pregunta abierta 7): `distortion_hard` (el de arriba), `limiter_loud` (ReaLimit: `threshold` −12..0, `ceiling` −3..0) y `eq_lowcut` (ReaEQ `Freq-High Pass 5`: `cutoff` 20..200 Hz).

**Errores de dominio nuevos** (se añaden a `COPILOT_ERROR_CODES`; mensaje fijo por código, sin rutas ni texto de Reaper hacia el cliente; el detalle va a `cause` y al registro): `daw_unavailable` (sin señal de vida reciente o puente no cargado), `daw_timeout`, `daw_busy` (render en curso), `daw_error` (fallo del puente sin código propio), `invalid_daw_output` (respuesta del puente fuera de su esquema), `item_not_found`, `track_not_found`, `preset_not_found`, `job_not_found`, `out_of_range` (corte fuera de la fuente, tasa fuera de [0,5, 2], valor fuera del rango del plugin), `nothing_to_undo`, `render_failed`. El puente usa su propia lista cerrada de códigos (`bad_request`, `unknown_method`, `invalid_params`, `file_not_found`, `item_not_found`, `track_not_found`, `fx_not_found`, `param_not_found`, `out_of_range`, `output_exists`, `media_offline`, `render_failed`, `nothing_to_undo`, `internal`) y el adaptador la traduce; un código desconocido es `daw_error`.

**Adaptador de Reaper** (`libs/adapters/reaper`, `scope:adapter`):
- Opciones: `ipcDir` (por defecto `<repositorio>/.copilot/reaper-ipc`), `pathStyle: "unc" | "identity"` y `distro` (para `unc`), `timeoutMs` por comando (10 s) y `renderTimeoutMs` (300 s), `heartbeatMaxAgeMs` (3 s).
- **Traducción de rutas**, función pura y probada: Linux → `\\wsl.localhost\<distro>\...` en lo que envía; UNC → Linux en lo que recibe (ignorando mayúsculas en el prefijo, y aceptando también `\\wsl$\`). Con `identity`, sin cambios. Una ruta recibida que no traduce a una ruta de Linux válida es `invalid_daw_output`.
- **Señal de vida:** el puente reescribe `heartbeat.json` (`{ state: "idle" | "rendering", instance }`) cada medio segundo y justo antes de renderizar. El adaptador mira su `mtime`: si es más viejo que `heartbeatMaxAgeMs` y el estado no es `rendering`, responde `daw_unavailable` sin esperar al tiempo límite.
- **Bloqueo del puente:** al arrancar, si hay un `heartbeat.json` reciente de otra `instance`, el puente no arranca (muestra un mensaje en la consola de Reaper). Evita dos puentes sobre el mismo `inbox/`, que compiten por las peticiones.
- **Render asíncrono:** `render(item, outputPath)` envía la petición, guarda el trabajo en memoria y devuelve el `jobId` en seguida; el resultado llega cuando el puente responde. Mientras haya un render en curso, cualquier otro comando falla con `daw_busy`. Los trabajos viven en memoria del proceso (con `pnpm mcp:call`, que arranca un servidor por llamada, no se puede consultar un render de otra llamada; queda documentado).
- Cada respuesta se valida con su esquema zod antes de devolverla; el adaptador borra la respuesta de `outbox/` al leerla y la petición de `inbox/` si vence el tiempo.

**`DawPort`** (sección 6.4, ajustado; los tipos salen de esquemas zod en `core`):
```ts
interface DawPort {
  getProjectState(): Promise<ProjectState>;
  setTempo(bpm: number): Promise<{ tempo: number }>;
  importAudio(path: AssetPath): Promise<{ track: TrackRef; item: DawItem }>;
  sliceByBars(item: ItemId, spec: SliceSpec): Promise<DawItem>;     // SliceSpec: sourceBpm, startBar, bars, beatsPerBar, offsetSec
  stretchToTempo(item: ItemId, spec: StretchSpec): Promise<DawItem>; // StretchSpec: sourceBpm, targetBpm
  applyFxChain(track: TrackId, chain: FxChain): Promise<AppliedFxChain>;
  render(item: ItemId, output: AssetPath): Promise<JobId>;
  getJob(job: JobId): Promise<JobStatus>;
  undo(): Promise<{ undone: string }>;
}
```
`DawItem` lleva la ruta de la fuente ya traducida a Linux (absoluta); las herramientas la pasan a relativa al workspace (o `null`) antes de devolverla.

**Verificación y commits** (skill `sdd`, secciones 3 y 4). `pnpm check` en verde antes de cada commit; las tareas que tocan el puente ejecutan además `pnpm test:reaper` con Reaper abierto y el puente cargado (si no puedes, dilo en la respuesta y el hilo principal lo pide al usuario). Un commit por tarea en `fase/F2a-reaper`, sin push; mensaje en inglés `<tipo>(<ámbito>): <resumen>` con la línea `Co-Authored-By` vigente; archivos por nombre; la casilla de la tarea se marca aquí en el mismo commit. No toques `spikes/` ni `specs/spikes/`.

## 3. Qué cambia, por carpeta

| Ruta | Cambio |
|---|---|
| `libs/core/` | `DawPort`; esquemas `ProjectState`, `DawItem`, `FxChain`, `AppliedFxChain`, `JobStatus`, `PresetSchema`; códigos de error nuevos |
| `libs/testing/` | `FakeDaw` (en memoria, misma semántica que el puente) |
| `reaper/bridge/` | Nuevo: `bridge.lua` |
| `reaper/presets/` | Nuevo: `distortion_hard.json`, `limiter_loud.json`, `eq_lowcut.json` |
| `libs/adapters/reaper/` | Nuevo: `ReaperDaw` (IPC, rutas, señal de vida, trabajos), pruebas con un puente falso en Node y `*.reaper.test.ts` |
| `libs/tools/` | Carga de presets; las 10 herramientas; `ToolContext` gana `daw` y `presets` |
| `apps/mcp-server/` | Configuración de Reaper y presets; cableado en `main.ts`; script `reaper-bridge.ts` |
| raíz | `.mcp.json` en `mentor`; `package.json` (`test:reaper`, `reaper:bridge`); `.gitignore` (`peaks/` en `workspace/` ya está ignorado; nada más) |
| `docs/`, `CLAUDE.md` | 6.4, 7, 8.2, 13; cómo registrar `agent` en local; estado e historial |

## 4. Decisiones y riesgos

| Decisión | Alternativa descartada |
|---|---|
| IPC en `<repositorio>/.copilot/reaper-ipc/` (`COPILOT_REAPER_IPC`), que el puente encuentra relativo a su propia ruta (`reaper/bridge/../../.copilot/reaper-ipc`) | En `workspace/` (sección 8.2): mezcla datos internos con el audio del usuario, como ya se descartó para SQLite. Reaper no ve las variables de entorno de WSL, así que el puente no puede leer `COPILOT_WORKSPACE` |
| Ids de Reaper (GUID) para pistas e items | Índices: cambian si el usuario reordena pistas |
| Corte y estirado absolutos (idempotentes) | Relativos al estado actual: repetir una llamada acumula el efecto |
| `apply_fx_chain` añade la cadena al final; para reajustar, `undo_last` y aplicar otra vez | Sustituir la cadena de la pista: borraría FX del usuario. Actualizar en el sitio: más estado que seguir |
| Presets con `knobs` con nombre y rango, y valores en unidades mostradas | Parámetros crudos del plugin: el LLM tendría que conocer índices y valores normalizados |
| `undo_last` solo deshace bloques `Copilot: ` | Deshacer sin mirar: podría borrar trabajo del usuario |
| Render a `workspace/renders/` con nombre generado por el servidor | Nombre elegido por el LLM: choques de nombres (diálogo modal) y una entrada más que validar |
| Con un render en curso, los demás comandos fallan con `daw_busy` | Encolarlos: el LLM esperaría sin saber por qué |
| Bloqueo en el puente (una instancia por `inbox/`); sin bloqueo del cliente | Bloqueo del cliente (sección 8.2): `pnpm mcp:call` y la sesión de Claude Code chocarían, y los ids únicos ya evitan respuestas cruzadas. Se corrige 8.2 |
| Trabajos de render en memoria del adaptador | Estado en archivos para consultarlo desde otro proceso: más complejidad para un caso (`mcp:call`) que no es el de uso |
| Se trabaja en la pestaña de proyecto activa | Pestaña propia del copiloto: Reaper no la identifica de forma estable entre recargas del puente |

Riesgos:
- **`bridge.lua` sin pruebas unitarias** (no hay Lua en WSL). Mitigación: lógica mínima en Lua (validar, ejecutar, comprobar), todo lo demás en TypeScript; `pnpm test:reaper` cubre cada método.
- **Audio real sin el primer tiempo al principio.** El corte supone que el compás 1 empieza en `offsetSec`. La demostración usa el click generado y, como prueba aparte, un tema real con desplazamiento a mano.
- **Render de la mezcla del master:** otras pistas que suenen en ese tramo entran en el render. Se documenta en la descripción de `render_selection`.
- **Precedencia de `.mcp.json` frente al ámbito local** de Claude Code: se comprueba en la demostración que el registro local en `agent` gana.

## 5. Tareas

- [x] **T1. Contratos de Reaper en `core` y `FakeDaw`.** `DawPort` y los esquemas de la sección 2 (`ProjectState`, `DawItem`, `SliceSpec`, `StretchSpec`, `FxChain`, `AppliedFxChain`, `JobStatus`, `PresetSchema` con sus reglas de `knob`), los códigos de error nuevos y `FakeDaw` en `libs/testing` (estado en memoria, corte y estirado con las mismas fórmulas, trabajos de render que terminan al pedirlo la prueba, fallos configurables, registro de llamadas).
  - Hecho cuando: pruebas de los esquemas (GUID inválido, `knob` sin definir o sobrante, `default` fuera de rango, `JobStatus` coherente con `status`); `FakeDaw` corta 4 compases a 150 desde el 5 con `offsetSec` 0,5 en `startOffsetSec` 6,9 y 6,4 s, y estirado a 170 da 5,647 s; repetir el corte o el estirado da lo mismo.
- [x] **T2. Puente y adaptador: estado del proyecto.** `reaper/bridge/bridge.lua` con el bucle, el códec JSON, la señal de vida, el bloqueo, `ping`, `get_project_state` y `quit`. `libs/adapters/reaper` con `ReaperDaw`: escritura atómica, espera de la respuesta, tiempos límite, señal de vida, traducción de rutas, validación con zod y traducción de errores. Herramienta `get_project_state`.
  - Hecho cuando: con un puente falso en Node sobre un directorio temporal, las pruebas cubren respuesta correcta, respuesta fuera de esquema (`invalid_daw_output`), código del puente traducido, sin señal de vida (`daw_unavailable` en menos de 1 s) y tiempo límite (`daw_timeout`, con la petición borrada de `inbox/`); la traducción de rutas tiene sus pruebas en los dos sentidos; `pnpm test:reaper` hace `ping` y lee el estado del Reaper real.
- [ ] **T3. Importar, tempo y deshacer.** Métodos del puente `import_audio` (comprobaciones, pista nueva, timebase de tiempo), `set_tempo` y `undo` (solo bloques `Copilot: `), todos en bloque de deshacer. Herramientas `import_audio` (ruta validada antes de llamar al puente; `source` relativa en la salida), `set_tempo` y `undo_last`.
  - Hecho cuando: con `FakeDaw`, una ruta fuera del workspace falla sin llamar al DAW y la salida no tiene rutas absolutas; con `pnpm test:reaper`, importar un WAV generado en un directorio temporal del workspace crea un item con su duración y timebase 0, `set_tempo` 170 no cambia la duración del item, y dos `undo_last` dejan el proyecto como estaba; un tercero da `nothing_to_undo`.
- [ ] **T4. Cortar y estirar.** Métodos del puente `slice` y `stretch` con las fórmulas absolutas y sus comprobaciones (fuera de la fuente, tasa fuera de [0,5, 2]). Herramientas `slice_loop` y `time_stretch`.
  - Hecho cuando: con `FakeDaw`, `out_of_range` en los dos casos y `item_not_found` con un id desconocido; con `pnpm test:reaper`, el click de 150 BPM (16 compases, 0,5 s de silencio) cortado en los compases 5-8 y estirado a 170 queda en 5,647 s ±1 ms, y repetir cualquiera de las dos llamadas no cambia el resultado.
- [ ] **T5. Presets y cadena de FX.** Los tres presets en `reaper/presets/`; `loadPresets(dir)` en `libs/tools` (valida cada archivo y que los id coincidan con el nombre); método del puente `apply_fx_chain` (añadir por nombre, parámetro por nombre, valor por bisección, en un bloque de deshacer); herramientas `list_presets` y `apply_fx_chain` (`knobs` fuera de rango o desconocidos rechazados antes de llamar al DAW; valores por defecto aplicados).
  - Hecho cuando: un preset con un `knob` sin definir hace fallar la carga; con `FakeDaw`, `knobs.drive` 95 en `distortion_hard` da `out_of_range` sin llamar al DAW; con `pnpm test:reaper`, `distortion_hard` con `drive` 80 devuelve `Distortion (%)` `80.0`, `Threshold` `-6.00` y `Ceiling` `-0.30` (±0,01), y los tres presets se aplican sin error.
- [ ] **T6. Render asíncrono.** Método del puente `render` (medio en línea, comprobación de la fuente, archivo inexistente, selección de tiempo, comprobación del archivo final, estado `rendering` en la señal de vida). `ReaperDaw.render` y `getJob` con trabajos en memoria y `daw_busy`. Herramientas `render_selection` (nombre generado en `workspace/renders/`) y `get_job_status`.
  - Hecho cuando: con el puente falso, un comando durante un render da `daw_busy` y el trabajo pasa de `rendering` a `done`; con `FakeDaw`, `job_not_found` con un id desconocido y `output.path` relativa; con `pnpm test:reaper`, el flujo de T4 más `distortion_hard` renderiza un WAV de 5,647 s ±20 ms (cabecera del WAV) y un render a un nombre existente da `output_exists` sin diálogo.
- [ ] **T7. Servidor, modos y arranque del puente.** `readConfig` gana `COPILOT_REAPER_IPC`, `COPILOT_REAPER_PATH_STYLE` (`unc` si hay `WSL_DISTRO_NAME`, si no `identity`; inválido hace fallar el arranque) y `COPILOT_PRESETS` (por defecto `reaper/presets`). `main.ts` cablea `ReaperDaw` y los presets (el servidor arranca aunque Reaper esté cerrado). `ALL_TOOLS` con las 10 herramientas. `.mcp.json` en `mentor`. `pnpm reaper:bridge`: carga `reaper/bridge/bridge.lua` en el Reaper abierto con `-nonewinst` y su ruta UNC (o recarga: `quit` y otra vez).
  - Hecho cuando: con el cliente MCP en memoria y fakes, `mentor` lista solo las 5 de lectura y `agent` las 12, cada una con su `readOnlyHint`; con Reaper cerrado o sin puente, `get_project_state` responde `daw_unavailable` en menos de 1 s; `pnpm reaper:bridge` deja el puente respondiendo a `MODE=agent pnpm mcp:call get_project_state '{}'`.
- [ ] **T8. Documentación y estado.** Documento maestro: `DawPort` ajustado (6.4); herramientas, contratos y presets (7); IPC en `.copilot/reaper-ipc`, bloqueo solo del puente, trabajos en memoria, `daw_busy`, `undo_last` limitado a bloques del copiloto y códigos de error (8.1 y 8.2). `CLAUDE.md`: `pnpm reaper:bridge`, `pnpm test:reaper`, variables nuevas y cómo registrar `agent` en ámbito local (`claude mcp add --scope local reaper-copilot -e MODE=agent -- node apps/mcp-server/src/main.ts`). `CHANGELOG.md` y `docs/estado.md`.
  - Hecho cuando: `pnpm check:full` y `pnpm test:reaper` pasan; el documento maestro no contradice lo implementado; `docs/estado.md` tiene 30 líneas o menos.

## 6. Demostración de la fase

Criterio de salida: desde Claude Code, importar, cortar 4 compases, estirar a 170, aplicar un preset y renderizar; el render dura lo esperado (±20 ms) medido con `analyze_audio`.

1. `pnpm check`, `pnpm check:full` y, con Reaper abierto, `pnpm reaper:bridge` y `pnpm test:reaper` en verde.
2. `pnpm mcp:call get_project_state '{}'` (con `mentor`) responde; `MODE=mentor` no lista ninguna herramienta que modifica.
3. El autor registra `agent` en ámbito local y, en una sesión nueva de Claude Code: «Importa `spike-reaper-ops/clicks150.wav` (150 BPM, el compás 1 empieza a los 0,5 s), corta 4 compases desde el 5, estíralos a 170, ponle `distortion_hard` con más drive y renderízalo». Claude encadena las herramientas y consulta el trabajo hasta `done`.
4. `analyze_audio` del render con objetivo 170: `durationSec` 5,647 ±0,020 y `tempo.target.matches: true`. `compare_audio` frente al render sin preset (si se hizo): `dynamics.crestFactorDb` baja.
5. `undo_last` varias veces devuelve el proyecto a su estado inicial; el original en `workspace/` tiene el mismo sha256 que antes.
6. Prueba aparte con un tema real de `workspace/demo/` y su `offsetSec` dado a mano: el render dura lo esperado.
7. `pnpm mcp:traces 15`: una fila por llamada.
8. Pull request a `main`: CI en verde.
