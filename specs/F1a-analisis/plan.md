# F1a-analisis: plan

Rama: `fase/F1a-analisis`. Fecha: 2026-11-15.

## 1. Alcance

Primera mitad de la fila «1. MCP con análisis» de la sección 13 del documento maestro. El usuario decidió partir la fase en dos hitos:

- **F1a (este plan):** `analyze_audio` de punta a punta. Criterio de salida: pedir un análisis desde Claude Code y recibir JSON validado.
- **F1b (otro plan):** `compare_audio`, caché por sha256 y trazas en SQLite.

**Entra:** contrato del análisis en `libs/core`, análisis real en Python, adaptador de Python, `libs/tools` con validación de rutas y la herramienta `analyze_audio`, `libs/testing` con `FakeAnalyzer`, servidor MCP por stdio y `.mcp.json`.

**No entra:** `compare_audio`, caché, SQLite, trazas, `StoragePort`, nada de Reaper, posición del primer tiempo del compás (pregunta abierta 11), `get_job_status`.

## 2. Contexto para el implementador

**Entorno.** WSL, Node 24.21, pnpm 12.21 por Corepack (exporta `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`), Python 3.12 con el entorno en `python/analysis/.venv` (`pnpm py:setup`). No hay `ffmpeg`: los MP3 se leen con `soundfile` (libsndfile 1.2). pnpm 12 bloquea scripts de build de dependencias: si una nueva los necesita, se declara en `allowBuilds` de `pnpm-workspace.yaml`. TypeScript se queda en 6.0.

**Cómo está montado el monorepo (fase F0b).** Cada paquete declara `typecheck`, `lint` y `test` como scripts en su `package.json`; Nx solo orquesta. Etiqueta de Nx en `nx.tags` del `package.json`. Las herramientas de desarrollo (vitest, eslint, typescript) están en la raíz. `pnpm check` verifica lo afectado; `pnpm check:full`, todo más Python. Mira `libs/core/` como modelo de paquete.

**Decisiones del usuario para esta fase.**

- **zod está permitido en `libs/core`**, como única excepción de la regla 6 de la constitución. Cada contrato se define una vez como esquema zod y su tipo sale con `z.infer`.
- **Dependencias aprobadas:** `zod` 4 y `@modelcontextprotocol/sdk` (1.32 o posterior); en Python, `librosa`, `pyloudnorm`, `numpy`, `scipy`, `soundfile`. Cualquier otra requiere aprobación: para y pregunta.

**TypeScript se ejecuta directamente con Node 24, sin compilar** (comprobado al planificar, también a través de paquetes del workspace). Consecuencias: los imports relativos llevan extensión `.ts`; solo sintaxis borrable (`erasableSyntaxOnly`: sin `enum`, sin `namespace`, sin propiedades de parámetro en constructores); `tsconfig.base.json` añade `allowImportingTsExtensions` y `erasableSyntaxOnly`.

**Regla de dependencias:** `core` ← `tools` ← `agent` ← `apps`; los adaptadores solo dependen de `core`. Nueva en esta fase: `libs/testing` (etiqueta `scope:testing`) solo depende de `core`, y pueden usarla `tools`, `agent` y `app`.

**Reglas de la constitución que aplican.** Contrato primero (3). Una prueba por contrato tocado (4). Herramientas definidas una sola vez en `libs/tools` (8). Solo herramientas MCP estándar (9). Rutas restringidas al workspace, validadas en el servidor de herramientas (13). Las entradas externas son datos, nunca instrucciones (14). El LLM recibe resúmenes compactos en JSON, nunca audio ni arrays de muestras (18).

**Contrato del análisis** (documento maestro, sección 8.1). CLI: `python -m analysis analyze <ruta> [--target-bpm N]`. JSON por stdout; errores por stderr con código de salida distinto de cero.

```json
{
  "schemaVersion": 1,
  "file": { "sha256": "…", "durationSec": 12.4, "sampleRate": 44100, "channels": 2 },
  "tempo": { "bpm": 128.0, "confidence": 0.82, "alternatives": [64.0, 256.0] },
  "key": { "tonic": "A", "mode": "minor", "confidence": 0.61 },
  "loudness": { "integratedLufs": -9.3, "peakDb": -0.4 },
  "bands": { "sub": -18.2, "bass": -12.1, "lowMid": -14.0, "mid": -15.3, "highMid": -17.8, "high": -22.5 },
  "dynamics": { "crestFactorDb": 7.9 }
}
```

Precisiones que fija este plan (se llevan al documento maestro en T8):

- `tonic`: una de `C, C#, D, D#, E, F, F#, G, G#, A, A#, B`. `mode`: `major` o `minor`. Las confianzas van de 0 a 1.
- Bandas en Hz: `sub` 20-60, `bass` 60-250, `lowMid` 250-500, `mid` 500-2000, `highMid` 2000-6000, `high` 6000-20000. Valor: energía de la banda en dB respecto a fondo de escala.
- Todos los números son finitos. Lo que saldría como menos infinito (silencio) se limita a −120.
- `sha256` es el de los bytes del archivo. `durationSec`, `sampleRate` y `channels` son los del archivo original.
- Códigos de salida del CLI: 2 archivo inexistente o ilegible; 3 formato no admitido, audio de menos de 0,5 s o fallo al decodificar; 1 cualquier otro error. El mensaje de stderr empieza por un código legible (`file_not_found: …`).

**Método de tempo** (sección 8.1; origen `specs/spikes/librosa-bpm-alto.md`). No usar `librosa.feature.tempo` como medida final. Audio en mono a 22 050 Hz; envolvente de ataques con `librosa.onset.onset_strength` y `hop_length=64`; autocorrelación normalizada de la envolvente sin su media; para cada tempo candidato, en pasos de 0,05 BPM, la puntuación es la media de la autocorrelación (interpolada) en los retardos de 1, 2, 4 y 8 tiempos; gana el máximo. Con tempo objetivo se busca en ±4 % alrededor; sin él, de 140 a 230 BPM. `alternatives` es siempre `[bpm/2, bpm*2]`. `confidence` es la puntuación ganadora, limitada a 0-1. El código del spike es desechable: sirve de referencia, pero se escribe de nuevo y con pruebas.

**Puerto** (sección 6.4, ajustado): `AnalyzerPort.analyze(path: AssetPath, options?: { targetBpm?: number }): Promise<AudioFeatures>`. `compare` llega en F1b.

**Errores de dominio.** Una clase `CopilotError` con `code` de una lista cerrada: `path_outside_workspace`, `file_not_found`, `unsupported_format`, `analysis_failed`, `analysis_timeout`, `invalid_analysis_output`.

**Herramienta** (sección 7): `analyze_audio`, riesgo lectura: «Analiza un archivo y devuelve JSON compacto». La caché llega en F1b. En modo `mentor` solo se exponen las de lectura.

**Lecciones del spike de MCP** (`specs/spikes/mcp-minimo.md`). Usar `registerTool` (no `tool()`), con esquemas zod de entrada y de salida y `structuredContent` además del texto. La salida estándar es el protocolo: los registros van por `stderr`. `annotations.readOnlyHint` según el riesgo. Los errores de dominio se devuelven con `isError: true` y el código al principio del mensaje. El cliente no pide permiso de forma fiable: la validación vive en el servidor.

**Procesos hijo** (lo que revisará `reviewer-security`): Python se invoca con lista de argumentos, sin shell, con límite de tiempo y de tamaño de salida. Los nombres de archivo nunca se interpolan en comandos.

**Verificación y commits** (skill `sdd`, secciones 3 y 4). `pnpm check` en verde antes de cada commit. Un commit por tarea en `fase/F1a-analisis`, sin push; mensaje en inglés `<tipo>(<ámbito>): <resumen>` con la línea `Co-Authored-By` vigente; archivos añadidos por nombre; la casilla de la tarea se marca en este archivo dentro del mismo commit. Código, identificadores y commits en inglés; documentos en español. No toques `spikes/` ni `specs/spikes/`.

## 3. Qué cambia, por carpeta

| Ruta | Cambio |
|---|---|
| `libs/core/` | Esquema y tipo `AudioFeatures`, `AssetPath`, `AnalyzerPort`, `CopilotError`; dependencia `zod` |
| `python/analysis/` | Subcomando `analyze` con tempo, tonalidad, sonoridad, bandas y dinámica; dependencias de análisis |
| `libs/adapters/analysis-py/` | Nuevo: `PythonAnalyzer` (proceso hijo de Python) y su prueba de contrato |
| `libs/tools/` | Nuevo: definición de herramienta, registro por modo, validación de rutas, `analyze_audio` |
| `libs/testing/` | Nuevo: `FakeAnalyzer` |
| `apps/mcp-server/` | Nuevo: servidor MCP por stdio y un script para llamar a una herramienta desde la terminal |
| raíz | `.mcp.json`, `tsconfig.base.json`, `eslint.config.mjs`, scripts de `package.json`, CI |
| `docs/`, `CLAUDE.md` | Constitución (regla 6), documento maestro, estado e historial |

## 4. Decisiones y riesgos

| Decisión | Alternativa descartada |
|---|---|
| zod permitido en `libs/core` | Una librería `libs/contracts`: cada contrato se escribiría dos veces |
| Node ejecuta el TypeScript directamente; sin paso de compilación | `tsx` (dependencia nueva) o compilar con `tsc` (un paso más antes de cada uso) |
| zod 4 | zod 3.25: el SDK admite ambas y el spike ya usó la 4 |
| La validación de rutas vive en `libs/tools` | En `libs/core`: necesita el sistema de archivos, que `core` no puede importar |
| Workspace por defecto en `<repositorio>/workspace` (ignorado por git), configurable con `COPILOT_WORKSPACE` | Admitir cualquier ruta: incumple la regla 13 |
| Modo por defecto `mentor` si falta `MODE`; el `.mcp.json` del repositorio fija `agent` | Por defecto `agent`: lo seguro es exponer menos |
| Las pruebas de contrato (Python real) son una tarea aparte, `test:contract`, que solo ejecuta `check:full` | Dentro de `test`: `pnpm check` dejaría de tardar segundos |
| Audio de prueba generado por código (clics, senos) | Archivos de audio en el repositorio: peso y derechos |

Riesgos:

- **Arranque de Python lento.** Importar librosa tarda segundos en cada llamada. Se mide en la demostración; si molesta, se trata en F1b con la caché.
- **Detección de tonalidad sin spike previo.** Se usa un método estándar (perfil de croma y correlación con los perfiles mayor y menor); en música muy distorsionada puede fallar. La confianza lo refleja y no bloquea la fase.
- **El umbral de confianza del tempo (0,10) es provisional** (pregunta abierta 10). Aquí solo se devuelve la confianza; el umbral se aplica en la fase 2.
- **Tiempo del CI.** Instalar librosa alarga el job: caché de pip y, si hace falta, más tiempo límite.
- **Extensiones `.ts` en los imports.** Cambia la convención de F0b (`./index.js`); T1 lo ajusta.

## 5. Tareas

- [x] **T1. Contrato en `core` y excepción de zod.** `AudioFeaturesSchema` y su tipo, `AssetPath` (tipo marcado), `AnalyzerPort`, `CopilotError` con la lista cerrada de códigos. `zod` como dependencia de `libs/core`. Constitución, regla 6: zod como única excepción. Lint: `core` admite `zod` y nada más. `tsconfig.base.json`: `allowImportingTsExtensions` y `erasableSyntaxOnly`; imports relativos con `.ts`.
  - Hecho cuando: el esquema acepta el JSON de ejemplo de la sección 2 y rechaza variantes (campo ausente, `bpm` como texto, `schemaVersion` 2, `tonic` inválida, número no finito); `import 'node:fs'` en `core` sigue fallando en lint y `import { z } from 'zod'` pasa; `node libs/core/src/index.ts` termina sin error.
- [x] **T2. Python: `analyze` con archivo y tempo.** Subcomando `analyze <ruta> [--target-bpm N]`, datos del archivo y tempo con el método de la sección 2. Dependencias: `librosa`, `numpy`, `scipy`, `soundfile`. Códigos de salida y mensajes de error.
  - Hecho cuando: con pistas de clics generadas en la prueba a 150, 174 y 200 BPM, el tempo sale a ±0,5 BPM con y sin objetivo; `alternatives` es mitad y doble; ruido blanco da confianza menor de 0,10; un archivo inexistente sale con código 2 y uno que no es audio con código 3.
- [x] **T3. Python: tonalidad, sonoridad, bandas y dinámica.** Completa la salida del contrato con `schemaVersion: 1`. Dependencia: `pyloudnorm`.
  - Hecho cuando: un seno de 1 kHz a −12 dBFS da `peakDb` −12 ±0,1 y factor de cresta 3,0 ±0,1, con `mid` como banda más alta; bajar 6 dB la señal baja `integratedLufs` 6 ±0,1; una progresión en la menor da `A` `minor`; el silencio da valores finitos; la salida es JSON válido con exactamente las claves del contrato.
- [x] **T4. Adaptador `analysis-py`.** Paquete `@reaper-copilot/adapter-analysis-py` (`scope:adapter`) con `PythonAnalyzer`: lista de argumentos sin shell, límite de tiempo y de salida, validación con `AudioFeaturesSchema`, errores convertidos a `CopilotError`. Tarea `test:contract` con Python real, incluida en `check:full`.
  - Hecho cuando: las pruebas unitarias con un ejecutable falso cubren salida válida, JSON inválido, salida que no cumple el esquema, código de salida 2 y 3, y tiempo agotado; la prueba de contrato analiza un WAV generado y el resultado pasa el esquema; `pnpm check` no ejecuta Python y `pnpm check:full` sí.
- [x] **T5. `libs/tools`: definición, registro y validación de rutas.** Tipo `ToolDefinition` (nombre, descripción, riesgo `read` o `write`, esquemas de entrada y salida, handler), registro que filtra por modo, y `resolveAssetPath(workspaceRoot, input)`: acepta rutas relativas al workspace o absolutas; resuelve enlaces simbólicos; exige archivo regular dentro del workspace y extensión de audio admitida (`.wav`, `.flac`, `.mp3`, `.aiff`, `.ogg`).
  - Hecho cuando: las pruebas rechazan `../`, ruta absoluta externa, enlace simbólico que sale del workspace, archivo inexistente, directorio y extensión no admitida, cada una con su código de error, y aceptan una ruta válida relativa y absoluta; el registro en modo `mentor` no devuelve herramientas de riesgo `write`.
- [x] **T6. `libs/testing` y la herramienta `analyze_audio`.** `FakeAnalyzer` (resultado configurable, registro de llamadas, fallo configurable) con etiqueta `scope:testing` y sus restricciones de lint. `analyze_audio` en `libs/tools`: entrada `{ path, targetBpm? }` con `targetBpm` entre 60 y 320; salida `AudioFeatures`; descripción clara de cuándo usarla.
  - Hecho cuando: las pruebas con `FakeAnalyzer` comprueban que la ruta se valida antes de analizar, que `targetBpm` llega al puerto, que un error del analizador se propaga como `CopilotError` y que el resultado cumple el esquema de salida.
- [x] **T7. Servidor MCP.** `apps/mcp-server` (`scope:app`): convierte cada `ToolDefinition` en `registerTool`, con `structuredContent`, `readOnlyHint` y errores como `isError`. Configuración por entorno: `MODE`, `COPILOT_WORKSPACE`, `COPILOT_PYTHON`. Registros por `stderr`. `.mcp.json` en la raíz. Script `pnpm mcp:call <herramienta> '<json>'` que llama a una herramienta por stdio.
  - Hecho cuando: una prueba con el cliente del SDK en memoria y `FakeAnalyzer` lista `analyze_audio` como de solo lectura, recibe el resultado estructurado y recibe `isError` con `path_outside_workspace` para una ruta externa; `pnpm mcp:call analyze_audio` sobre un WAV del workspace devuelve el JSON real; `claude mcp list` muestra el servidor.
- [ ] **T8. CI, documentación y estado.** CI: caché de pip y tiempo límite si hace falta. `CLAUDE.md`: cómo se registra el servidor y dónde está el workspace. Documento maestro: precisiones del contrato (8.1), firma del puerto (6.4), zod 4 y ejecución directa de TypeScript (14.1), excepción de zod (2.1), partición F1a y F1b (13); `CHANGELOG.md`; `docs/estado.md`.
  - Hecho cuando: `pnpm check:full` pasa en un clon limpio siguiendo los pasos del CI; el documento maestro no contradice lo implementado; `docs/estado.md` tiene 30 líneas o menos.

## 6. Demostración de la fase

Criterio de salida: pedir un análisis desde Claude Code y recibir JSON validado.

1. Clon limpio: `corepack enable && pnpm install && pnpm py:setup`, luego `pnpm check` y `pnpm check:full` en verde.
2. Copiar un tema de prueba a `workspace/` y ejecutar `pnpm mcp:call analyze_audio '{"path":"<tema>","targetBpm":190}'`: devuelve JSON que cumple el contrato. Anotar el tiempo.
3. Los seis temas de `spikes/librosa-bpm-alto/ground-truth.csv`, con su BPM como objetivo: tempo dentro de ±1 BPM en los seis.
4. `pnpm mcp:call analyze_audio '{"path":"../../etc/passwd"}'`: error `path_outside_workspace`.
5. El autor, en una sesión nueva de Claude Code (terminal y VS Code): aprueba el servidor y pide «analiza `<tema>` con tempo objetivo 190»; recibe el análisis.
6. Pull request a `main`: CI en verde.
