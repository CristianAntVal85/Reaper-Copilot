# F2b-tareas: plan

Rama: `fase/F2b-tareas`, creada desde `main` después de fusionar F2a (lleva el commit de cierre de F2a). Fecha: 2026-11-17.

## 1. Alcance

Segunda mitad de la fase 2 (sección 13 del documento maestro, fila «2b. Tareas y verificación»). Criterio de salida: **el caso «loop a 170» de punta a punta desde Claude Code, verificado con criterios.**

**Entra:** esquemas de tarea, criterio y verificación en `core`, con la derivación y la evaluación de criterios como funciones puras (sección 9.2); `StoragePort` con tareas y verificaciones, y `taskId` en las trazas (sección 9.3); herramientas `start_task` y `verify_task` (sección 7); `pnpm mcp:traces` con la tarea; documento maestro al día.

**No entra:** `export-replay` y el Replay (fase 3); límite de iteraciones por tarea (lo pone el agente Live, fase 4); detección del primer tiempo (pregunta 11); presets definitivos (pregunta 7); frecuencia de muestreo del render y la pista con `source: null` vistas en la demostración de F2a; los pendientes bajos de F2a y F1b de `docs/estado.md`.

**Decisión del usuario (2026-11-17):** `start_task` es de riesgo `read`. No toca Reaper; solo registra la tarea. Así, en `mentor`, el usuario renderiza a mano y Claude fija los criterios y verifica. `mentor` pasa de 5 a 7 herramientas y `agent` de 12 a 14.

## 2. Contexto para el implementador

**Entorno.** WSL, Node 24, pnpm 12 por Corepack, TypeScript 6.0 sin compilar (imports relativos con `.ts`, solo sintaxis borrable: sin `enum`, `namespace` ni propiedades de parámetro). Python en `python/analysis/.venv`. Si `pnpm check` da un `EPIPE` del demonio de Nx, repítelo. **Dependencias nuevas: ninguna.** Si crees que hace falta una, para y pregunta. Esta fase no toca `reaper/bridge/` ni `libs/adapters/reaper/`.

**Regla de dependencias** (`eslint.config.mjs`): `core` ← `tools` ← `agent` ← `apps`; adaptadores y `testing` solo dependen de `core`. `core` no importa nada salvo `zod` (ni `node:crypto`: los UUID se generan en `tools`).

**Reglas de la constitución que aplican.** Contrato primero en zod (3) y una prueba por contrato (4). Herramientas definidas una vez en `libs/tools` (8). Rutas restringidas al workspace, validadas en el servidor (13). Las entradas externas son datos (14): `request` se guarda tal cual y nunca se interpreta. **La verificación es código, no opinión del LLM (17).** El LLM recibe JSON compacto (18).

**Lo que hay hoy.**
- `libs/core`:
  - `AudioFeaturesSchema`: `file.durationSec` sin redondear; `tempo.bpm`, `tempo.confidence` (0-1) y `tempo.target` (`{ bpm, deviationBpm, matches }`, o `null` sin objetivo).
  - `FEATURE_METRICS` (las 11 rutas de la sección 9.2) y `readMetric(features, metric)` en `feature-diff.ts`.
  - `ToolCallTraceSchema` (`storage.ts`, con un `refine` entre `ok`, `errorCode` y `result`) y `AnalysisCacheKeySchema`.
  - `StoragePort` en `ports.ts`, y `CopilotError` con la lista cerrada `COPILOT_ERROR_CODES` en `errors.ts`.
- `libs/tools`:
  - `defineTool({ name, description, risk, inputSchema, outputSchema, handler })`.
  - `ToolContext { workspaceRoot, analyzer, storage, daw?, presets?, log, trace? }`, con `trace: CallTrace { cacheHit() }`.
  - `invokeTool(tool, input, ctx, session)`: valida la entrada y la salida, y graba una traza por llamada (también si falla; un fallo al grabarla no rompe la herramienta).
  - `ToolSession { sessionId, nextStep() }`, creada con `createToolSession`.
  - `resolveAssetPath(workspaceRoot, input)`: comprobación léxica y tras `realpath`; devuelve `AssetPath`.
  - `analyzeWithCache(ctx, assetPath, { targetBpm? })`: devuelve `{ features, cacheHit }` y avisa a `ctx.trace`.
  - `ALL_TOOLS` en `tools.ts` (12 herramientas) y `createToolRegistry(tools, mode)` (en `mentor`, solo las de riesgo `read`).
- `libs/adapters/storage-sqlite`: `SqliteStorage`. Las migraciones están en `MIGRATIONS` (solo se añaden al final y cada una corre una vez en una transacción). Las lecturas se validan con los esquemas de `core`.
- `libs/testing`: `FakeStorage` (en memoria; valida lo que guarda, devuelve copias, registra las llamadas y tiene fallos configurables por método), `FakeAnalyzer`, `FakeDaw` y `SAMPLE_AUDIO_FEATURES`. El conjunto de pruebas compartido del almacenamiento (`storage-behaviour.ts`) está duplicado en `libs/testing` y en `libs/adapters/storage-sqlite`: cambia los dos.
- `apps/mcp-server`:
  - `server.ts` registra cada herramienta en el SDK. Solo pasa `outputSchema` si es un `z.ZodObject`: con una unión, el SDK fallaba.
  - `server.test.ts` usa un cliente MCP en memoria y prueba el número de herramientas por modo.
  - `scripts/mcp-traces.ts` imprime las trazas.

**Contrato: criterios (sección 9.2, con lo decidido aquí).**
- **Entrada de `start_task`:**
  ```json
  {
    "request": "Loop de 4 compases a 170 BPM, más distorsionado",
    "source": "samples/break.wav",
    "target": { "bpm": 170, "bars": 4, "beatsPerBar": 4 },
    "criteria": [
      { "id": "louder", "metric": "loudness.integratedLufs", "basis": "absolute", "min": -9, "max": -6 },
      { "id": "more-distortion", "metric": "dynamics.crestFactorDb", "basis": "delta", "max": -3 }
    ]
  }
  ```
- **Criterio:** `{ id, metric, basis, min?, max? }`.
  - `metric`: una de `FEATURE_METRICS`.
  - `basis`: `absolute` compara el valor del render; `delta` compara render menos origen.
  - `min` y `max`: inclusivos. Hace falta al menos uno, y si están los dos, `min ≤ max`.
- **Reglas que aplica el servidor:**
  1. **Ids:** únicos, con el patrón `^[a-z0-9][a-z0-9-]{0,39}$`. Los ids `duration` y `tempo` están reservados para los criterios derivados.
  2. **Criterios fijos:** se fijan en `start_task`. `verify_task` no los acepta: su entrada es estricta y un campo `criteria` da `invalid_input`.
  3. **Un `delta` excluye el cero:** su intervalo no puede contener 0 (`min > 0` o `max < 0`).
  4. **Criterios derivados de `target`**, que el LLM no puede quitar:
     - Con `bpm` y `bars`: `duration` (`file.durationSec`, `absolute`), igual a `bars × beatsPerBar × 60 / bpm` con ±0,020 s y límites redondeados a 3 decimales. 4 compases a 170 dan 5,627 a 5,667.
     - Con `bpm`: `tempo` (`tempo.bpm`, `absolute`, `bpm ± 1`). Se evalúa con `tempo.target.matches` del render analizado con `targetBpm = target.bpm`.
- **`target`:** objeto estricto con `bpm?` (60-320), `bars?` (entero de 1 a 64) y `beatsPerBar?` (entero de 1 a 12, 4 por defecto). `bars` sin `bpm` se rechaza.
- **Recuento:** de 0 a 16 criterios propios, y al menos uno contando los derivados. Una tarea solo con `target: { bpm, bars }` es válida.
- **`request`:** de 1 a 2000 caracteres. **`source`:** ruta del workspace, validada con `resolveAssetPath` en `start_task` y guardada tal como la dio el cliente (relativa, nunca absoluta).
- **Evaluación** (función pura en `core`):
  - El render se analiza con `targetBpm = target.bpm` si lo hay. El origen solo se analiza si hay algún criterio `delta`, y entonces sin `targetBpm`.
  - **Valores:** en un criterio `absolute`, `measured` es el valor del render. En uno `delta`, `measured = render − origen` redondeado a 2 decimales, con `sourceValue` y `renderValue`.
  - **Estado:** `pass` si `measured` cumple los límites y `fail` si no. Es `unmeasured` en dos casos: un criterio sobre `tempo.bpm` cuando la confianza del tempo de algún audio usado es menor que 0,10, o el derivado `tempo` con esa misma confianza baja en el render.
  - **`pass` global:** ningún criterio en `fail` y, si existe el derivado `duration`, en `pass`.
- **Salida de `verify_task`:**
  ```json
  {
    "taskId": "…", "attempt": 1, "render": { "path": "renders/x.wav", "sha256": "…" }, "pass": false,
    "results": [
      { "id": "duration", "derived": true, "metric": "file.durationSec", "basis": "absolute", "status": "pass",
        "measured": 5.646, "min": 5.627, "max": 5.667, "sourceValue": null, "renderValue": null },
      { "id": "more-distortion", "derived": false, "metric": "dynamics.crestFactorDb", "basis": "delta", "status": "fail",
        "measured": -1.8, "min": null, "max": -3, "sourceValue": 9.7, "renderValue": 7.9 }
    ]
  }
  ```
  Todos los campos están siempre presentes (`null` cuando no aplican) y la salida es un objeto, no una unión.

**Trazas (sección 9.3).** Una fila por llamada, también las que fallan, sin rutas absolutas ni causas de error. Desde esta fase llevan `taskId: string | null`. Las llamadas anteriores al primer `start_task` de la sesión llevan `null`. Un fallo al grabar la traza solo se registra. Las filas antiguas se leen con `taskId: null`.

**Verificación y commits** (skill `sdd`, secciones 3 y 4).
- **Antes de cada commit:** `pnpm check` en verde.
- **Commits:** uno por tarea en `fase/F2b-tareas`, sin push. Mensaje en inglés con el formato `<tipo>(<ámbito>): <resumen>` y la línea `Co-Authored-By` vigente. Añade los archivos por nombre y marca la casilla de la tarea en este archivo, en el mismo commit.
- **Fuera de alcance:** no toques `spikes/` ni `specs/spikes/`.

## 3. Qué cambia, por carpeta

| Ruta | Cambio |
|---|---|
| `libs/core/` | `task.ts`: `CriterionSchema`, `TaskTargetSchema`, `StartTaskInputSchema`, `TaskSchema`, `CriterionResultSchema`, `VerificationSchema`, `deriveCriteria`, `evaluateCriteria`; `ToolCallTrace.taskId`; `StoragePort` con tareas; código `task_not_found` |
| `libs/adapters/storage-sqlite/` | Migración 2: tablas `tasks` y `task_verifications`, columna `tool_calls.task_id`; métodos nuevos |
| `libs/testing/` | `FakeStorage` con tareas; conjunto compartido de almacenamiento ampliado |
| `libs/tools/` | `start_task`, `verify_task`; `ToolSession` con tarea activa; `CallTrace.taskStarted` y `forTask`; `invokeTool` graba `taskId`; `ALL_TOOLS` con 14 |
| `apps/mcp-server/` | Pruebas por MCP de 7 y 14 herramientas y del flujo de tarea; `mcp-traces.ts` imprime la tarea |
| `docs/` | Documento maestro (6.4, 7, 8.1, 9.2, 9.3, 13) a v2.10; `CHANGELOG.md` y `estado.md` |

## 4. Decisiones y riesgos

| Decisión | Alternativa descartada |
|---|---|
| `start_task` de riesgo `read`: está en `mentor` (decisión del usuario) | Solo en `agent`, como decía la sección 7: en `mentor`, `verify_task` no tendría tarea que verificar |
| Tareas y verificaciones en SQLite, a través de `StoragePort` | En memoria del servidor: el Replay (fase 3) las necesita y una verificación debe sobrevivir a un reinicio |
| Tarea activa por sesión: `start_task` la fija y las llamadas siguientes llevan su `taskId` en la traza; `verify_task` lleva el de su entrada | Pasar `taskId` a cada herramienta: cambia 12 contratos y el LLM puede olvidarlo |
| Derivación y evaluación de criterios como funciones puras en `core` | Lógica dentro de la herramienta: la reutilizará el agente Live y así se prueba sin fakes |
| Reglas de criterios en el esquema zod (`superRefine` con mensajes claros) | Código de error de dominio propio: el SDK ya devuelve los mensajes de zod al cliente y el contrato queda en un solo sitio |
| Al menos un criterio contando los derivados | Al menos uno propio (lectura literal de la regla 1): obligaría a inventar un criterio en el caso básico «loop a 170» |
| `verify_task` acepta cualquier ruta del workspace, no solo `renders/` | Solo `renders/`: en `mentor` el usuario renderiza a mano donde quiera |
| El origen se analiza solo si hay algún `delta`, y sin `targetBpm` | Analizarlo siempre: unos 4 s de más en cada verificación sin `delta` |
| Salida de `verify_task` con todos los campos y `null` | Campos opcionales o una unión por `basis`: la unión no pasa por el SDK (visto en F2a) y el Replay lee mejor una forma fija |
| `attempt` = verificaciones previas de la tarea + 1, con `UNIQUE(task_id, attempt)` | Contador en memoria: se pierde al reiniciar |

Riesgos:
- **El LLM puede elegir criterios fáciles.** Los criterios derivados y la regla del `delta` sin cero lo limitan. La traza guarda los criterios y el Replay los enseña.
- **`unmeasured` en el tempo de fragmentos cortos** (pregunta 10): no bloquea el `pass` global, porque la duración manda.
- **`readOnlyHint: true` en `start_task`**, aunque escribe en SQLite. Solo registra la tarea y no cambia el proyecto del usuario. Se documenta en la sección 7.
- **Migración de una base con datos reales:** la columna nueva admite `NULL`. Hay una prueba que abre una base con la versión 1 y filas, y la migra.

## 5. Tareas

- [x] **T1. Contratos de tarea y evaluación en `core`.** `task.ts` con los esquemas de la sección 2, `deriveCriteria(target)` y `evaluateCriteria(criteria, render, source | null)` (devuelve `{ pass, results }`), y el código `task_not_found` en `COPILOT_ERROR_CODES`.
  - Hecho cuando: hay pruebas de cada regla (ids repetidos y reservados, `delta` con un intervalo que contiene 0, ni `min` ni `max`, `min > max`, `bars` sin `bpm`, ningún criterio en total, más de 16, métrica fuera de la lista). `deriveCriteria({ bpm: 170, bars: 4 })` da `duration` entre 5,627 y 5,667, y `tempo` entre 169 y 171. La evaluación da `pass`, `fail` y `unmeasured` (confianza 0,05) en los casos esperados. `measured` de un `delta` es `render − origen` con 2 decimales. Un `pass` global exige `duration` en `pass`.
- [x] **T2. Almacenamiento de tareas y `taskId` en las trazas.** `ToolCallTraceSchema` gana `taskId`. `StoragePort` gana `createTask(task)`, `getTask(taskId): Task | null`, `recordVerification(verification)` y `listVerifications(taskId)` (en orden de `attempt`). Hay que añadirlo en `SqliteStorage` (migración 2), en `FakeStorage` y en los dos conjuntos compartidos.
  - Hecho cuando: el conjunto compartido pasa con las dos implementaciones (crear y leer una tarea, una tarea desconocida da `null`, dos verificaciones salen en orden, un `attempt` repetido se rechaza). Una base con la versión 1 y trazas migra y las lee con `taskId: null`. Una tarea o una verificación fuera de su esquema se rechaza al guardar.
- [ ] **T3. Tarea activa en la sesión.** `ToolSession` gana la tarea activa. `CallTrace` gana `taskStarted(taskId)`, que atribuye la llamada a la tarea y, si la llamada sale bien, la deja activa en la sesión, y `forTask(taskId)`, que solo atribuye. `invokeTool` graba `taskId`: el atribuido en la llamada o, si no hay, el de la tarea activa.
  - Hecho cuando: con una herramienta de prueba que llama a `taskStarted`, las trazas posteriores llevan su `taskId` y las anteriores `null`. Si esa herramienta falla, no cambia la tarea activa. `forTask` atribuye la llamada sin cambiar la tarea activa.
- [ ] **T4. `start_task`.** Riesgo `read`. Valida `source` con `resolveAssetPath` antes de guardar nada, genera el `taskId` con `randomUUID()`, guarda la tarea con los criterios derivados incluidos (`derived: true`) y llama a `taskStarted`. Salida: `{ taskId, criteria }`, con todos los criterios que se van a evaluar. La descripción explica la regla del `delta`, los criterios derivados, que no se pueden cambiar después y que el siguiente paso es `verify_task` con la ruta del render.
  - Hecho cuando: con `FakeStorage`, un `source` fuera del workspace da `path_outside_workspace` y no guarda nada. La salida no tiene rutas absolutas. Una tarea con `target: { bpm: 170, bars: 4 }` y sin criterios propios guarda `duration` y `tempo`. Un fallo al guardar da `internal_error`.
- [ ] **T5. `verify_task`.** Riesgo `read`. La entrada es estricta, `{ taskId, path }`. Hace lo siguiente:
  1. Valida `path`.
  2. Lee la tarea (`task_not_found` si no existe) y llama a `forTask`.
  3. Analiza el render y, si hay algún `delta`, el origen, con `analyzeWithCache`.
  4. Evalúa los criterios.
  5. Guarda la verificación con su `attempt` y devuelve la salida de la sección 2.
  - Hecho cuando: con `FakeAnalyzer` y `FakeStorage`, la segunda verificación de una tarea da `attempt: 2` y las dos quedan guardadas. Un campo `criteria` en la entrada da `invalid_input`. Un `taskId` desconocido da `task_not_found`. Sin ningún `delta`, el analizador no recibe el origen. `render.path` es relativa.
- [ ] **T6. Servidor y trazas.** `ALL_TOOLS` con 14 herramientas. Las pruebas del servidor esperan 7 en `mentor` y 14 en `agent`, con su `readOnlyHint` y ambas con `outputSchema` anunciado. `mcp-traces.ts` imprime `task=<8 primeros caracteres o ->`.
  - Hecho cuando: con el cliente MCP en memoria y fakes, en `mentor`, `analyze_audio`, `start_task` y `verify_task` dan `pass` y las trazas llevan `taskId` desde `start_task`. Un `start_task` con un `delta` que incluye 0 devuelve un error que nombra la regla.
- [ ] **T7. Documentación.** Documento maestro v2.10:
  - **6.4:** `StoragePort` con tareas y `taskId` en `ToolCallTrace`.
  - **7:** `start_task` de lectura, `verify_task` con `{ taskId, path }`, y `mentor` con 7 herramientas y `agent` con 14.
  - **8.1:** `task_not_found`.
  - **9.2:** las decisiones de la sección 4 de este plan (ids reservados, recuento con derivados, `target`, análisis del origen, forma de la salida).
  - **9.3:** `taskId` y tarea activa.

  Además, `CLAUDE.md` si cambia algún comando, `CHANGELOG.md` y `docs/estado.md`.
  - Hecho cuando: `pnpm check:full` pasa; el documento maestro no contradice lo implementado; `docs/estado.md` tiene 30 líneas o menos.

## 6. Demostración de la fase

Criterio de salida: el caso «loop a 170» de punta a punta desde Claude Code, verificado con criterios.

1. `pnpm check` y `pnpm check:full` en verde. Con Reaper abierto, `pnpm reaper:bridge` y `pnpm test:reaper` siguen en verde.
2. En una sesión nueva en `agent` (`/mcp`: 14 herramientas), pide: «Haz un loop de 4 compases a 170 BPM desde el compás 5 de `spike-reaper-ops/clicks150.wav` (150 BPM, el compás 1 empieza a los 0,5 s), más distorsionado, y verifícalo». Claude encadena `start_task` (con `target` y un criterio `delta` de `dynamics.crestFactorDb`), las herramientas de Reaper, `render_selection`, `get_job_status` y `verify_task`. Resultado: `pass: true`, con `duration` en `pass` y `tempo` en `pass` o `unmeasured`.
3. **Iteración:** con un criterio inalcanzable a la primera (por ejemplo, `crestFactorDb` en `delta` con `max` muy negativo), `verify_task` da `fail`. Claude ajusta (`undo_last` y más `drive`) y vuelve a verificar con `attempt: 2`. Si intenta pasar criterios a `verify_task`, recibe un error.
4. **Reglas:** `start_task` con un `delta` que incluye 0, o con un criterio llamado `duration`, se rechaza con un mensaje que nombra la regla.
5. **Mentor:** en una sesión con `mentor` (`/mcp`: 7 herramientas), el autor renderiza a mano en Reaper un tramo dentro de `workspace/`. Claude crea la tarea y la verifica sin herramientas que modifiquen.
6. `pnpm mcp:traces 20`: las llamadas desde `start_task` llevan su tarea y las anteriores `-`.
7. Pull request a `main`: CI en verde.
