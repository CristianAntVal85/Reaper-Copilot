# Spike: reaper-bridge-windows

Fecha: 2026-11-14. Código desechable en `spikes/reaper-bridge-windows/`. Continúa `reaper-bridge-wsl.md`, que concluyó que la interfaz de Reaper por WSLg no es usable.

## Pregunta

¿Puede el mismo puente funcionar en Reaper nativo de Windows con el cliente en WSL? ¿Dónde debe vivir el directorio de IPC y qué traducción de rutas hace falta?

## Entorno

Reaper 7.86 x64 en `C:\Program Files\REAPER (x64)`, lanzado desde WSL (Ubuntu 24.04, distribución `Ubuntu-24.04`). Cliente Node 24 en WSL.

## Qué se probó y qué pasó

| Prueba | Resultado |
|---|---|
| Mismo `bridge.lua` en Windows | Funciona. Solo hubo que tratar el separador de rutas y que `os.rename` no sobrescribe en Windows |
| `reaper.exe -nonewinst bridge.lua` con Reaper abierto | **Carga el script en la instancia abierta** (en Linux no lo hacía) |
| IPC en `C:\` (cliente por `/mnt/c/...`) | 30 pings: mínimo 22, mediana 35, máximo 45 ms, 0 fallos |
| IPC dentro de WSL (Reaper por `\\wsl.localhost\Ubuntu-24.04\...`) | 200 pings: mínimo 16, mediana 32, p95 37, máximo 63 ms, 0 fallos |
| `set_tempo` 170 con bloque de deshacer, luego `undo` | 170 y vuelta a 120, en ambas variantes |
| `import_audio` con ruta de Windows (`C:\...`) | Pista `tone600`, proyecto de 600 s |
| `import_audio` con ruta UNC de un archivo en WSL | Pista `tone30`, correcto |
| `import_audio` con ruta de Linux sin traducir (`/mnt/c/...`) | **Devuelve `inserted: 1` pero crea un item vacío** (longitud 0). Falla en silencio |
| Render a `C:\` | WAV estéreo de 24 bits y 600,0 s en 8,7 s |
| Render a WSL por UNC | Mismo WAV en 10,4 s |
| `ping` durante el render | Respondido al acabar (8,8 s y 10,6 s): el puente se bloquea igual que en Linux |
| Originales | md5 sin cambios tras importar y renderizar |

Otros detalles:

- `reaper.GetOS()` devuelve `"Win64"`; la ruta de recursos es `C:\Users\<usuario>\AppData\Roaming\REAPER`.
- Reaper crea una carpeta `peaks/` junto a los audios importados y los renders.
- Arrancar una instancia nueva con el script como argumento tardó entre 15 y 25 s en tener el puente listo, y una vez no llegó a estarlo en 60 s. No se investigó la causa (posible diálogo de inicio tras cerrar la instancia anterior a la fuerza). Con `-nonewinst` sobre un Reaper ya abierto la carga es inmediata.

## Qué se decide

Aprobado por el autor el 2026-11-14 y recogido en el documento maestro v2.3:

1. **En el PC de desarrollo, Reaper corre nativo en Windows.** Claude Code, el servidor MCP, Node y Python siguen en WSL. El portátil servidor sigue con Reaper para Linux.
2. **El repositorio, el workspace y el directorio de IPC se quedan en WSL.** Reaper los alcanza por `\\wsl.localhost\<distribución>\...` con la misma latencia que en `C:\`. No hace falta mover nada a `/mnt/c`.
3. **El adaptador de Reaper traduce rutas** en los dos sentidos: de Linux a UNC en todo lo que envía y de UNC a Linux en lo que recibe. En el servidor Linux la traducción es la identidad. Es configuración del adaptador, no del núcleo.
4. **El puente no se fía del valor de retorno de `InsertMedia`:** comprueba que el archivo existe antes de importar y que el item creado tiene longitud mayor que cero.
5. **Nombres únicos en `inbox/` y `outbox/`:** en Windows el renombrado no sobrescribe.
6. **En desarrollo el puente se carga con `-nonewinst`** sobre el Reaper que el autor ya tiene abierto.
7. Se mantiene lo decidido en el spike de WSL: render síncrono en el puente, trabajo asíncrono en el adaptador, señal de vida que avise de que está renderizando.

Cambió el documento maestro (secciones 8.2, 10, 14.1 y 15.1) y `CLAUDE.md` (sección Entorno).

## Confirmación del autor (2026-11-14)

Con WASAPI como sistema de audio, la pista suena bien y la latencia y la interfaz son buenas para trabajar.

## Qué queda abierto

- El tiempo y la fiabilidad de arrancar una instancia nueva con el script, si alguna vez hace falta en Windows.
- Excluir `peaks/` del workspace o redirigirlo en las preferencias de Reaper.
- `pnpm test:reaper` en desarrollo: contra el Reaper de Windows, contra el de WSL (que sigue funcionando sin interfaz), o ambos.
- No se probó: `slice`, `stretch`, cadenas de efectos ni el render por selección de tiempo.
