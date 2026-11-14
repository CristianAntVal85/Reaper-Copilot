# Spike: reaper-bridge-wsl

Fecha: 2026-11-14. Código desechable en `spikes/reaper-bridge-wsl/` (`bridge.lua`, `client.mjs`, `render-test.mjs`).

## Pregunta

¿Puede un Reaper para Linux dentro de WSL ejecutar `bridge.lua` y responder a peticiones por archivos (`inbox/` → `outbox/`)? De paso: ¿sigue corriendo `reaper.defer` durante un render? ¿Hay salida de audio?

## Entorno

Reaper 7.85 linux-x86_64 en `~/opt/REAPER`, Ubuntu 24.04 en WSL2 con WSLg, Node 24.21, Python 3.12.

## Qué se probó y qué pasó

| Prueba | Resultado |
|---|---|
| `ping` por archivos | Funciona. Ida y vuelta de 6 a 33 ms en 13 llamadas |
| Frecuencia del bucle `reaper.defer` | Unos 30 ciclos por segundo (600 en 20 s) |
| `get_project_state` | `{"project":"","lengthSec":0,"tempo":120,"tracks":[]}` |
| Método fuera de la lista | `{"ok":false,"error":{"code":"unknown_method","message":"nope"}}` |
| `set_tempo` 170 en bloque de deshacer, luego `undo` | Tempo 170; tras deshacer, 120 (`"undone":1`) |
| `import_audio` de un WAV de 600 s | Pista `tone600` con 1 item; el md5 del original no cambia (Reaper lo referencia, no lo copia) |
| `render` del proyecto (acción 42230) | WAV estéreo de 24 bits y 600,0 s. Tardó 17,2 s |
| `ping` enviado durante el render | Respondido a los 17,15 s: **el puente no atiende nada mientras renderiza** (`maxGapSec` 17,22) |
| Arranque con el script como argumento | `reaper -newinst -new -nosplash bridge.lua`: puente listo en unos 0,3 s |
| `reaper -nonewinst bridge.lua` con un Reaper ya abierto | **No reenvía el script**: arranca una segunda instancia |
| Estado del audio (`Audio_IsRunning`, `GetAudioDeviceInfo`) | Sin dispositivo: `audioRunning: 0`, todo vacío |

Detalles que salieron al escribir el puente:

- `reaper.EnumerateFiles` guarda en caché el listado: hay que llamarla con índice `-1` en cada ciclo para ver archivos nuevos.
- El Lua de Reaper no trae JSON: el puente lleva su propio codificador y decodificador (unas 100 líneas).
- `reaper.GetOS()` devuelve `"Other"` en Linux.
- El render no necesita dispositivo de audio.
- Dos instancias de Reaper pueden correr a la vez; si ambas cargan el puente sobre el mismo `inbox/`, compiten por las peticiones.

## Qué se decide

1. **El IPC por archivos es viable** tal como lo describe la sección 8.2 del documento maestro. La latencia la marca el ciclo de `defer` (unos 33 ms como máximo), irrelevante para este uso.
2. **El render es síncrono dentro del puente.** El trabajo asíncrono (`jobId`, `get_job_status`) vive en el adaptador de TypeScript, que espera la respuesta en `outbox/` y contesta el estado sin preguntar a Reaper. Mientras hay un render, el adaptador no envía otros comandos.
3. **La señal de vida no puede ser solo un latido:** se congela durante el render. El puente debe dejar escrito que está renderizando antes de empezar.
4. **El puente se carga al arrancar Reaper**, pasando el script como argumento o desde `Scripts/__startup.lua`. No se puede inyectar en una instancia ya abierta por línea de comandos.
5. **El archivo de bloqueo es necesario** y debe identificar la instancia de Reaper, no solo al cliente.
6. JSON se mantiene como formato, con el códec dentro de `bridge.lua`.

Los puntos 2, 3 y 4 están recogidos en la sección 8.2 del documento maestro v2.3.

## Uso interactivo en WSLg (prueba manual del autor, 2026-11-14)

Con `libpulse0` ya instalado, el autor intentó usar la interfaz de Reaper por WSLg (pantalla de 3440x1440):

- Los menús desplegables se abren en una posición que no corresponde.
- El puntero va desfasado respecto a donde se hace clic.
- No consiguió hacer sonar una pista.
- Al cerrar, la ventana se queda colgada.

Conclusión: **Reaper en WSL sirve para automatizar (puente, render, pruebas), pero no para trabajar con la interfaz.** El objetivo del autor de producir con él queda sin cubrir en este entorno.

## Qué queda abierto

- **Dónde corre el Reaper que usa el autor.** Opciones: (a) Reaper nativo en Windows con el puente y el directorio de IPC en una ruta visible desde ambos lados (`/mnt/c/...`), lo que obliga a traducir rutas en el adaptador; (b) intentar arreglar WSLg (escalado en `.wslgconfig`), sin garantía y con la latencia de audio de WSLg igualmente. Resuelto: opción (a), ver `reaper-bridge-windows.md`.
- Velocidad de render: 600 s de un tono sin efectos tardaron 17,2 s (unas 35 veces tiempo real). Medir con una cadena de efectos real.
- Qué forma de arranque usar en desarrollo: argumento en un lanzador propio o `__startup.lua` (este último afecta a todo uso de Reaper).
- No se probó: la variante de render por selección de tiempo, `slice` ni `stretch`.
