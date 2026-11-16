# F1b-comparacion: plan

Rama: `fase/F1b-comparacion`. Fecha: 2026-11-16.

## 1. Alcance

Segunda mitad de la fase 1 (sección 13 del documento maestro, fila «1b. Comparación y trazas»). Criterio de salida: **comparar dos archivos desde Claude Code; el segundo análisis del mismo archivo sale de la caché.**

**Entra:**
- Corrección del tempo con objetivo, detectada al usar F1a: `targetBpm` solo elige la octava y la salida dice si la medida coincide con el objetivo.
- `compare_audio`, la caché de análisis por sha256 y las trazas de cada llamada a herramienta en SQLite, detrás de `StoragePort`.
- La ejecución de herramientas (validación, trazas y errores) pasa a `libs/tools` para que la reutilice el agente Live.

**No entra:** tareas, criterios, `start_task` y `verify_task` (fase 2); `export-replay` (fase 3); Reaper; `get_job_status`; pico real (*true peak*); límite de tamaño del audio de entrada (pendiente bajo de F1a, sigue anotado).

## 2. Contexto para el implementador

**Entorno.** WSL, Node 24.21, pnpm 12.21 por Corepack (exporta `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`), Python 3.12 con el entorno en `python/analysis/.venv` (`pnpm py:setup`). Si `pnpm check` da un `EPIPE` del demonio de Nx, repítelo. pnpm 12 bloquea scripts de build de dependencias (`allowBuilds` en `pnpm-workspace.yaml`). TypeScript 6.0.

**Cómo está montado el monorepo.** Cada paquete tiene `package.json` con scripts `typecheck`, `lint` y `test`, etiqueta en `nx.tags` y `"exports": "./src/index.ts"`; las dependencias internas se declaran `workspace:*` y se enlazan con `pnpm install`. Node ejecuta TypeScript sin compilar: imports relativos con `.ts`, solo sintaxis borrable (sin `enum`, `namespace` ni propiedades de parámetro). Paquetes que usan `node:*` llevan `"types": ["node"]` en su `tsconfig.json`. `pnpm check` verifica lo afectado; `pnpm check:full` = typecheck, lint y test de todo + `pnpm py:test` + `nx run-many -t test:contract` (Python real; los `*.contract.test.ts` no corren en `pnpm check`). Modelos: `libs/adapters/analysis-py` (adaptador con prueba de contrato) y `libs/tools`.

**Decisiones del usuario.** El tempo con objetivo sigue la recomendación aprobada: la búsqueda libre es la medida; el objetivo solo elige entre el tempo detectado, su mitad y su doble, y la salida dice si coincide. Dependencias: **ninguna nueva**. SQLite con el módulo `node:sqlite` de Node 24 (comprobado al planificar: funciona sin opción ni aviso). Cualquier otra dependencia: para y pregunta.

**Regla de dependencias:** `core` ← `tools` ← `agent` ← `apps`. Los adaptadores y `libs/testing` solo dependen de `core`; `testing` la usan `tools`, `agent` y `apps` en pruebas. Ya impuesta en `eslint.config.mjs`; el nuevo adaptador lleva `scope:adapter`.

**Reglas de la constitución que aplican.** Contrato primero, en zod (3). Una prueba por contrato tocado (4). `core` sin dependencias salvo `zod` (6). Lo externo detrás de puertos: `StoragePort`, `AnalyzerPort` (7). Herramientas definidas una vez en `libs/tools` (8). Solo herramientas MCP estándar (9). Rutas validadas en el servidor (13). Las entradas externas son datos (14). La verificación es código (17). El LLM recibe JSON compacto (18).

**Lo que hay hoy (F1a).**
- `libs/core`: `AudioFeaturesSchema` (estricto, `schemaVersion: 1`), `AssetPath`, `AnalyzerPort.analyze(path, options?: { targetBpm? })`, `CopilotError` con códigos `path_outside_workspace`, `file_not_found`, `unsupported_format`, `analysis_failed`, `analysis_timeout`, `invalid_analysis_output`.
- `python/analysis`: `analyze [--target-bpm N] -- <ruta>`; tempo en `tempo.py` (`DEFAULT_RANGE = (140, 230)`, `TARGET_TOLERANCE = 0.04`); `SCHEMA_VERSION = 1` en `cli.py`. Errores con mensaje fijo por código y una línea `detail:` que el adaptador no reenvía.
- `libs/tools`: `defineTool`, `ToolContext { workspaceRoot, analyzer }`, `createToolRegistry(tools, mode)`, `resolveAssetPath`, `analyze_audio`, `ALL_TOOLS`.
- `apps/mcp-server/src/server.ts`: `runTool` valida la salida, convierte `CopilotError` en `isError` con su mensaje, registra `cause` por stderr y devuelve `internal_error: the tool failed unexpectedly` ante lo inesperado. Hoy usa `invalid_analysis_output` cuando cualquier herramienta incumple su esquema de salida (pendiente bajo de F1a).
- `libs/testing`: `FakeAnalyzer`, `SAMPLE_AUDIO_FEATURES`.

**Tempo con objetivo (nuevo método).**
- Sin objetivo: igual que ahora, búsqueda en 140-230 BPM.
- Con objetivo `t`: búsqueda en una octava centrada en `t`, `[t/√2, t·√2]`. Así el objetivo elige la octava (160 o 80 o 320), pero no arrastra la medida: un tema a 160 con objetivo 190 sigue dando ~160.
- Método de puntuación sin cambios: envolvente de ataques con `hop_length=64` a 22 050 Hz, autocorrelación normalizada sin media, media de la autocorrelación interpolada a 1, 2, 4 y 8 tiempos, pasos de 0,05 BPM.
- Contrato nuevo de `tempo` (**`schemaVersion: 2`**):
  ```json
  "tempo": { "bpm": 159.95, "confidence": 0.508, "alternatives": [79.98, 319.9],
             "target": { "bpm": 190, "deviationBpm": -30.05, "matches": false } }
  ```
  `target` es `null` sin objetivo. `deviationBpm = bpm − target.bpm`, redondeado a 2 decimales. `matches` es `|deviationBpm| ≤ 1` (la tolerancia de BPM de la sección 9.2). El resto del contrato no cambia.

**Comparación** (sección 7: «Diferencias entre dos análisis»). Se calcula en TypeScript con una función pura de `core` a partir de dos `AudioFeatures`. No hay subcomando `compare` en Python. Métricas: la lista cerrada de la sección 9.2, que se define ya en `core` como `FEATURE_METRICS`: `file.durationSec`, `tempo.bpm`, `loudness.integratedLufs`, `loudness.peakDb`, `bands.sub`, `bands.bass`, `bands.lowMid`, `bands.mid`, `bands.highMid`, `bands.high`, `dynamics.crestFactorDb`. `delta = b − a` (como el `basis: delta` de la fase 2: render menos origen), redondeado a 2 decimales.
```json
{
  "a": { "path": "demo/a.mp3", "sha256": "…" },
  "b": { "path": "demo/b.mp3", "sha256": "…" },
  "metrics": { "loudness.integratedLufs": { "a": -4.14, "b": -5.03, "delta": -0.89 }, "…": {} },
  "tempo": { "a": { "confidence": 0.337, "target": null }, "b": { "confidence": 0.508, "target": null } },
  "key": { "a": { "tonic": "F", "mode": "minor", "confidence": 0.42 }, "b": { "tonic": "B", "mode": "minor", "confidence": 0.73 }, "same": false }
}
```
`metrics` lleva exactamente las 11 claves. `path` es la ruta tal como la dio el cliente, nunca la absoluta.

**`StoragePort`** (sección 6.4, concretado para F1b):
```ts
interface AnalysisCacheKey { sha256: string; targetBpm: number | null; revision: string }
interface ToolCallTrace {
  sessionId: string; step: number; tool: string;
  args: unknown; ok: boolean; result: unknown | null; errorCode: string | null;
  durationMs: number; startedAt: string /* ISO 8601 */; cacheHits: number;
}
interface StoragePort {
  getCachedAnalysis(key: AnalysisCacheKey): Promise<AudioFeatures | null>;
  putCachedAnalysis(key: AnalysisCacheKey, features: AudioFeatures): Promise<void>;
  recordToolCall(trace: ToolCallTrace): Promise<void>;
  listToolCalls(options?: { limit?: number }): Promise<ToolCallTrace[]>; // más recientes primero
}
```
La tarea (`taskId`) de la sección 9.3 llega en la fase 2 con `start_task`; aquí no existe.

**Caché.** Clave: sha256 de los bytes del archivo (calculado en Node, por streaming), `targetBpm` (o `null`) y `revision` = `"<schemaVersion>.<ANALYSIS_REVISION>"`. `ANALYSIS_REVISION` es una constante de `libs/core` que se sube a mano cuando cambia el método de análisis de Python. Al leer de la caché, el resultado se valida otra vez con `AudioFeaturesSchema`: si no pasa, es un fallo de caché. Si la caché falla al leer o escribir, se registra por stderr y se analiza igual; nunca rompe la herramienta.

**Trazas** (sección 9.3: «Cada llamada a herramienta se guarda en SQLite: tarea, paso, argumentos, resultado, duración y marca de tiempo»). Una fila por llamada, también las que fallan (`ok: false`, `errorCode`, `result: null`). Sin rutas absolutas ni `cause`: `args` es la entrada del cliente y `errorCode` el código. `sessionId` es un `crypto.randomUUID()` por arranque del servidor; `step` cuenta desde 1 en cada sesión. Si la traza no se puede escribir, se registra por stderr y la herramienta responde igual.

**Ejecución de herramientas.** `invokeTool(tool, input, ctx)` en `libs/tools`: valida la entrada, ejecuta el handler, valida la salida, guarda la traza y devuelve `{ ok: true, output } | { ok: false, message }`. Los errores siguen las reglas de F1a: `CopilotError` → su `message`, y su `cause` solo al registro; lo inesperado → `internal_error: the tool failed unexpectedly`; una salida que no cumple el esquema también es `internal_error` (es un fallo nuestro, no del análisis). El servidor MCP solo traduce ese resultado a `CallToolResult`.

**SQLite.** Archivo `<repositorio>/.copilot/copilot.db` por defecto (directorio ignorado por git, creado al arrancar), configurable con `COPILOT_DATA_DIR`. Modo WAL y `busy_timeout` de 5 s: pueden abrirlo a la vez el servidor de Claude Code y `pnpm mcp:call`. Tabla de versión del esquema de la base y migración inicial. Tablas `analysis_cache` (clave compuesta, JSON, fecha) y `tool_calls`.

**Verificación y commits** (skill `sdd`, secciones 3 y 4). `pnpm check` en verde antes de cada commit. Un commit por tarea en `fase/F1b-comparacion`, sin push; mensaje en inglés `<tipo>(<ámbito>): <resumen>` con la línea `Co-Authored-By` vigente; archivos añadidos por nombre; la casilla de la tarea se marca en este archivo dentro del mismo commit. No toques `spikes/` ni `specs/spikes/`.

## 3. Qué cambia, por carpeta

| Ruta | Cambio |
|---|---|
| `python/analysis/` | Tempo con objetivo por octava; `tempo.target`; `schemaVersion` 2 |
| `libs/core/` | Esquema de tempo v2, `ANALYSIS_REVISION`, `FEATURE_METRICS`, `FeatureDiffSchema` y `compareFeatures`, `StoragePort` y sus tipos |
| `libs/adapters/storage-sqlite/` | Nuevo: `SqliteStorage` con `node:sqlite` |
| `libs/testing/` | `FakeStorage`; `SAMPLE_AUDIO_FEATURES` en v2 |
| `libs/tools/` | Análisis con caché, `invokeTool` con trazas, `compare_audio`, descripción de `analyze_audio` |
| `apps/mcp-server/` | Usa `invokeTool`; abre SQLite; `COPILOT_DATA_DIR`; script `pnpm mcp:traces` |
| raíz | `.gitignore` (`.copilot/`), scripts de `package.json` |
| `docs/`, `CLAUDE.md` | Documento maestro (6.4, 7, 8.1, 9.2, 9.3, 15), estado e historial |

## 4. Decisiones y riesgos

| Decisión | Alternativa descartada |
|---|---|
| Con objetivo, búsqueda en una octava centrada en él | ±4 % alrededor del objetivo: devuelve lo que se le pide (con 190, un tema a 160 sale a 182,9). Devolver dos estimaciones: más campos y el LLM tendría que elegir |
| `tempo.target` con `deviationBpm` y `matches` (±1 BPM) | Solo la confianza: no avisa de que el objetivo es incorrecto |
| `schemaVersion` sube a 2 | Mantener 1: la caché y los consumidores no distinguirían las dos salidas |
| La comparación es una función pura de `core` sobre dos análisis | `python -m analysis compare` (sección 8.1): no reutiliza la caché y vuelve a cargar librosa |
| `node:sqlite` (Node 24) | `better-sqlite3`: dependencia nativa con script de build |
| Caché en la capa de herramientas (`analyzeWithCache`), no como decorador de `AnalyzerPort` | Decorador: la herramienta no sabría si hubo acierto y no podría anotarlo en la traza |
| `invokeTool` en `libs/tools` | Dejarlo en el servidor MCP: el agente Live tendría que duplicar validación y trazas (regla 8) |
| Base en `<repositorio>/.copilot/` | Dentro de `workspace/`: mezclaría datos internos con el audio del usuario |

Riesgos:
- **Fragmentos cortos sin el margen del ±4 %.** En el spike, los fragmentos de 4 compases pasaban de 16 a 17 de 18 con la ventana estrecha; con la octava se pierde ese caso (un 4/3 del tempo). La duración sigue siendo la comprobación principal en la fase 2, y el umbral de `unmeasured` (pregunta abierta 10) se revisa allí.
- **`ANALYSIS_REVISION` se sube a mano.** Si se olvida, la caché devuelve análisis antiguos. Se mitiga con la nota en `CLAUDE.md` y borrando `.copilot/`.
- **Dos procesos sobre la misma base.** WAL y `busy_timeout`; las escrituras son pequeñas.
- **`node:sqlite` aún es experimental en Node 24.** Si emite avisos, van por stderr y no rompen el protocolo; queda detrás de `StoragePort`.

## 5. Tareas

- [x] **T1. Tempo con objetivo por octava y contrato v2.** Python: con objetivo, búsqueda en `[t/√2, t·√2]`; `tempo.target` (`bpm`, `deviationBpm`, `matches`) o `null`; `schemaVersion` 2. `libs/core`: esquema de tempo v2 y `ANALYSIS_REVISION`. `libs/testing`: `SAMPLE_AUDIO_FEATURES` en v2. Descripción de `analyze_audio`: el objetivo elige la octava y `tempo.target.matches` dice si coincide; ya no «evita errores de mitad o doble» arrastrando la medida.
  - Hecho cuando: con clics generados a 160 BPM, objetivo 190 da 160 ±0,5 con `matches: false` y `deviationBpm` ≈ −30, objetivo 160 da `matches: true` y objetivo 80 da 80 ±0,25; siguen pasando las pruebas de 150, 174 y 200 con y sin objetivo; el esquema acepta `target: null` y el objeto, y rechaza `schemaVersion` 1, `target` sin `matches` y `deviationBpm` no finito; `test:contract` pasa.
- [x] **T2. Comparación y `StoragePort` en `core`.** `FEATURE_METRICS`, `FeatureDiffSchema`, `compareFeatures(a, b, labels)`, `StoragePort`, `AnalysisCacheKey` y `ToolCallTrace` (con sus esquemas zod).
  - Hecho cuando: las pruebas comprueban `delta = b − a` redondeado en las 11 métricas, que `metrics` tiene exactamente esas claves, `key.same` en los dos casos, que un análisis contra sí mismo da todos los `delta` a 0 y que el resultado pasa `FeatureDiffSchema`.
- [x] **T3. Adaptador `storage-sqlite` y `FakeStorage`.** Paquete `@reaper-copilot/adapter-storage-sqlite` (`scope:adapter`) con `SqliteStorage` sobre `node:sqlite`: crea el directorio y la base, WAL, `busy_timeout`, migración inicial con tabla de versión, consultas preparadas. `FakeStorage` en `libs/testing` (en memoria, con registro de llamadas y fallo configurable).
  - Hecho cuando: con un archivo temporal, guardar y leer un análisis devuelve lo mismo; claves que difieren solo en `targetBpm` o `revision` no se pisan; `listToolCalls` devuelve las más recientes primero y respeta `limit`; abrir dos veces la misma base y reabrirla conserva los datos; las mismas pruebas de comportamiento pasan contra `FakeStorage`.
- [x] **T4. Análisis con caché.** `analyzeWithCache(ctx, assetPath, options)` en `libs/tools`: sha256 del archivo por streaming, clave con `revision`, lectura validada con el esquema, escritura tras analizar; devuelve `{ features, cacheHit }`. Fallos de caché registrados con `ctx.log` y nunca propagados. `ToolContext` gana `storage` y `log`. `analyze_audio` lo usa.
  - Hecho cuando: con `FakeAnalyzer` y `FakeStorage`, la segunda llamada sobre el mismo archivo no llama al analizador; cambiar un byte del archivo, el `targetBpm` o `ANALYSIS_REVISION` vuelve a analizar; un JSON de caché que no cumple el esquema vuelve a analizar; una caché que lanza al leer o escribir no rompe el análisis.
- [ ] **T5. `invokeTool` con trazas.** En `libs/tools`: validación de entrada y salida, errores según la sección 2, una traza por llamada (`sessionId`, `step`, `cacheHits`, duración, `startedAt`) y fallo de traza sin romper la respuesta. El servidor MCP pasa a usarlo; la salida fuera de esquema pasa a `internal_error`.
  - Hecho cuando: las pruebas de `invokeTool` con fakes cubren éxito, entrada inválida, `CopilotError` (sin `cause` en la traza ni en la respuesta), error inesperado, salida fuera de esquema y fallo al escribir la traza; los `step` crecen de uno en uno; las pruebas del servidor de F1a siguen pasando con el nuevo código de salida fuera de esquema.
- [ ] **T6. Herramienta `compare_audio`.** Riesgo lectura. Entrada `{ a: { path, targetBpm? }, b: { path, targetBpm? } }`; valida las dos rutas antes de analizar; analiza con caché; salida `FeatureDiff`. Descripción breve: cuándo usarla (comparar una versión con otra o con una referencia), que `delta` es `b − a` y que las rutas son relativas al workspace. Se añade a `ALL_TOOLS`.
  - Hecho cuando: con fakes, una ruta fuera del workspace en `a` o en `b` falla con `path_outside_workspace` sin llamar al analizador; cada `targetBpm` llega a su análisis; la segunda comparación de los mismos archivos no llama al analizador y su traza tiene `cacheHits: 2`; la salida cumple el esquema y no contiene rutas absolutas.
- [ ] **T7. Servidor con SQLite y `mcp:traces`.** `COPILOT_DATA_DIR` (por defecto `<repositorio>/.copilot`, en `.gitignore`), `SqliteStorage` en `main.ts`, `sessionId` por arranque, registros por stderr. Script `pnpm mcp:traces [n]` que imprime las últimas `n` trazas (herramienta, `ok`, código, duración, `cacheHits`).
  - Hecho cuando: una prueba con el cliente MCP en memoria y fakes lista `analyze_audio` y `compare_audio` como de solo lectura y deja una traza por llamada; con Python real, dos `pnpm mcp:call analyze_audio` seguidos sobre un WAV del workspace: el segundo tarda menos de 0,5 s y `pnpm mcp:traces 2` muestra `cacheHits` 0 y 1; `.copilot/` no aparece en `git status`.
- [ ] **T8. Documentación y estado.** Documento maestro: tempo con objetivo, `tempo.target`, `schemaVersion` 2 y nota de que `peakDb` es el pico de muestra del audio decodificado y puede pasar de 0 dBFS en formatos con pérdida (8.1); sin `compare` en Python (8.1) ni en `AnalyzerPort`, y `StoragePort` concretado (6.4); `compare_audio` (7); el criterio de tempo de la fase 2 usa el objetivo para elegir la octava (9.2, regla 4); trazas sin tarea hasta la fase 2 (9.3); riesgo de fragmentos cortos (15.1) y pregunta 10. `CLAUDE.md`: `COPILOT_DATA_DIR`, `pnpm mcp:traces` y cuándo subir `ANALYSIS_REVISION`. `CHANGELOG.md` y `docs/estado.md`.
  - Hecho cuando: `pnpm check:full` pasa; el documento maestro no contradice lo implementado; `docs/estado.md` tiene 30 líneas o menos.

## 6. Demostración de la fase

Criterio de salida: comparar dos archivos desde Claude Code; el segundo análisis del mismo archivo sale de la caché.

1. `pnpm check` y `pnpm check:full` en verde.
2. Borrar `.copilot/`. `pnpm mcp:call analyze_audio '{"path":"demo/<Break Your Face>.mp3","targetBpm":190}'`: tempo ~210 con `target.matches: false` y `deviationBpm` ≈ +20. Repetirlo: mismo JSON en menos de 0,5 s.
3. Los seis temas de `spikes/librosa-bpm-alto/ground-truth.csv` con su BPM como objetivo: los seis dentro de ±1 BPM y con `matches: true`.
4. `pnpm mcp:call compare_audio` con «Break Your Face» como `a` e «It Will Be OK» como `b`: 11 métricas con su `delta` y `key.same: false`, sin rutas absolutas.
5. `pnpm mcp:traces 5`: una fila por llamada, con `cacheHits` que refleja los aciertos de la caché.
6. El autor, en una sesión nueva de Claude Code: «compara `<a>` con `<b>`» recibe la comparación; repetirlo sale de la caché (visible en `pnpm mcp:traces`).
7. Pull request a `main`: CI en verde.
