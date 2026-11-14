# Spike: mcp-minimo

Fecha: 2026-11-14. Código desechable en `spikes/mcp-minimo/` (`server.mjs`, `test-client.mjs`).

## Pregunta

¿Un servidor MCP mínimo por stdio, con herramientas definidas con zod, se ve y se usa desde Claude Code en la terminal y en la extensión de VS Code, incluido el permiso de uso? De paso: que el modo `mentor` oculte lo que modifica y cómo llegan los errores de validación.

## Entorno

Node 24.21, `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7, Claude Code 2.1.323. Instalado con npm: `pnpm` solo existe a través de Corepack y pide descargarse en el primer uso.

## Qué se probó y qué pasó

### Con un cliente de prueba (SDK, por stdio)

| Prueba | Resultado |
|---|---|
| Conexión | 172 ms desde que arranca el proceso |
| Listado en modo `agent` | `spike_analyze (readOnly)` y `spike_set_tempo` |
| Listado en modo `mentor` | Solo `spike_analyze`. Llamar a `spike_set_tempo` devuelve `MCP error -32602: Tool spike_set_tempo not found` |
| Esquema que ve el cliente | El zod se convierte en JSON Schema con sus límites: `{"bpm":{"type":"number","minimum":60,"maximum":320}}` |
| Llamada válida | Devuelve el JSON como texto y también como `structuredContent` (con `outputSchema` declarado) |
| Error del handler (ruta con `..`) | `isError: true` con el mensaje propio: `path_outside_workspace: ".." is not allowed` |
| Argumentos fuera de rango (`targetBpm: 999`) | El SDK lo rechaza antes del handler: `isError: true`, `Input validation error: ... Too big: expected number to be <=320 at targetBpm` |

- El SDK acepta zod 3.25 o 4 (`peerDependencies: "^3.25 || ^4.0"`). El spike usó zod 4 sin problemas.
- `registerTool` es la API vigente; `tool()` está marcada como obsoleta.
- La salida estándar es el protocolo: cualquier `console.log` del servidor lo rompe. Los registros van por `stderr`.

### En Claude Code

- `.mcp.json` en la raíz del repositorio registra el servidor con ámbito de proyecto.
- `claude mcp list` lo detecta y lo deja en `⏸ Pending approval (run claude to approve)`: un servidor de proyecto no arranca hasta que el usuario lo aprueba en una sesión interactiva.
- Prueba manual del autor, tras aprobar el servidor, en la terminal y en la extensión de VS Code, con el mismo resultado en ambas:
  - `spike_analyze` con `samples/a.wav` devolvió `{"file":"samples/a.wav","tempo":{"bpm":170,"confidence":0.5},"mode":"agent"}`.
  - `spike_set_tempo` con 170 devolvió `{"ok":true,"tempo":170}`.
  - **No se pidió permiso para ninguna de las dos**, tampoco para la que modifica. La sesión del autor usa un modo de permisos automático; no se probó con el modo por defecto.
- El `.mcp.json` usado, ya retirado de la raíz para no dejar una herramienta falsa en cada sesión:
  ```json
  { "mcpServers": { "reaper-copilot-spike": { "command": "node", "args": ["spikes/mcp-minimo/server.mjs"], "env": { "MODE": "agent" } } } }
  ```

## Qué se decide


1. `@modelcontextprotocol/sdk` con `registerTool`, esquemas zod de entrada y de salida, y `structuredContent` además del texto.
2. El modo `mentor` se implementa no registrando las herramientas que modifican; no hace falta comprobarlo en cada handler.
3. La validación de argumentos la hace el SDK con el esquema zod; los errores de dominio se devuelven con `isError: true` y un código legible al principio del mensaje.
4. Cada herramienta lleva `annotations.readOnlyHint` acorde con su columna de riesgo (sección 7 del documento maestro).
5. El documento maestro pide zod 3.25+; se puede fijar zod 4.
6. **No se puede contar con el aviso de permiso del cliente.** Confirma la sección 12.1: las restricciones viven en el servidor. Lo que protege al usuario es la validación del servidor, los bloques de deshacer y el modo `mentor`.
7. La ruta relativa en `.mcp.json` funciona en la terminal y en VS Code.

## Qué queda abierto

- Si una regla `ask` en `.claude/settings.json` para las herramientas que modifican fuerza el aviso también en modo automático. Decidir en la fase 2 si se quiere.
- El flujo de permisos con el modo por defecto de Claude Code, que es el que verá un tercero.
- Cómo fijar `MODE` por usuario sin editar el `.mcp.json` compartido.
- `pnpm` frente a `npm` en la fase 0b: Corepack necesita una descarga la primera vez.
