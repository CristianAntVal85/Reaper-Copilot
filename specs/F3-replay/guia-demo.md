# F3-replay: guía de la demostración

Guía paso a paso para el autor, sin conocimientos previos de Reaper ni de producción. Objetivo: tres ejecuciones reales con audio propio, exportadas y publicadas en el Replay.

## Idea clave

En modo `agent`, Claude maneja Reaper con las herramientas del copiloto. Tú haces cinco cosas:
1. Das el audio.
2. Pides con palabras normales lo que quieres.
3. Apruebas las acciones.
4. Lees el resultado.
5. Exportas la ejecución.

La web enseña exactamente eso: lo que pediste, lo que hizo Claude y lo que se midió.

## Vocabulario

| Palabra | Qué es |
|---|---|
| BPM | Velocidad de la música, en golpes por minuto |
| Compás (bar) | Grupo de 4 golpes; «4 compases» son 16 golpes |
| Loop | Trozo corto pensado para repetirse |
| Render | Exportar a un archivo lo que suena en Reaper: es el «después» |
| Preset | Cadena de efectos ya preparada: `distortion_hard` (distorsión), `limiter_loud` (más volumen), `eq_lowcut` (quita los graves más profundos) |

## Paso 0. Preparación

1. **Audio propio** en WAV o MP3, con un ritmo claro y constante. Se publicará en internet (constitución, regla 16). Si lo exportaste tú desde un programa de música, el primer golpe suele estar en el segundo 0.
2. **Copia el audio al workspace.** En el Explorador de Windows, abre `\\wsl.localhost\Ubuntu-24.04\home\cristian-pc\proyectos\reaper_copilot\RCA\workspace`, crea una carpeta `mio` y copia ahí el audio. Usa nombres sin espacios ni tildes, por ejemplo `tema1.wav`. El motivo: el copiloto solo puede tocar archivos dentro de `workspace/`.
3. **Reaper limpio.** Abre Reaper y elige File → New project; si pregunta si quieres guardar, di «No». El motivo: el render graba todo lo que suena en ese tramo.
4. **Puente.** En la terminal, ejecuta `cd ~/proyectos/reaper_copilot/RCA` y después `pnpm reaper:bridge`. El puente es lo que permite al copiloto enviar órdenes a Reaper.
5. **Comprueba el modo.** Abre una sesión nueva de Claude Code en esa carpeta y escribe `/mcp`: deben aparecer 14 herramientas, que corresponden al modo `agent`. Si salen 7, estás en `mentor`. Para cambiar a `agent`, ejecuta `claude mcp add --scope local reaper-copilot -e MODE=agent -- node apps/mcp-server/src/main.ts` y abre una sesión nueva.

## Tarea 1: loop al tempo elegido

1. **Mide el audio.** Pide: «Analiza `mio/tema1.wav` y dime su BPM, su tonalidad y lo fuerte que suena». Necesitas saber el BPM real.
2. **Pide el loop.** Usa esta frase y cambia X por el BPM medido e Y por el que quieras:
   > Haz un loop de 4 compases desde el compás 5 de `mio/tema1.wav` (su BPM es X, el compás 1 empieza en el segundo 0), cámbialo a Y BPM y verifícalo con criterios. Dime el taskId al final.

   Elige una Y cercana a X, con un cambio de como mucho un 30 %. La palabra «verifícalo» hace que Claude use `start_task` y `verify_task`.
3. **Aprueba cada herramienta** cuando Claude Code te pida permiso.
4. **Lee la tabla de criterios** que te devuelve.
5. **Apunta el taskId.**
6. **Limpia Reaper:** File → New project, y «No» a guardar.

## Tarea 2: más fuerte, con dos intentos

Pide:
> Con `mio/tema1.wav`, haz un loop de 4 compases desde el compás 9 (BPM X, compás 1 en el segundo 0), sin cambiar el tempo. Hazlo más fuerte con el preset `limiter_loud`. Fija un criterio exigente de sonoridad para que el primer intento probablemente no lo cumpla. Si falla, ajusta los parámetros, renderiza otra vez y vuelve a verificar. Dime el taskId.

Así en la web se ve el intento 1 con «fail» y el intento 2 con «pass». Apunta el taskId y limpia Reaper.

## Tarea 3: quitar graves profundos

Pide:
> Con `mio/tema1.wav` (u otro tema tuyo), haz un loop de 4 compases desde el compás 5 (BPM X, compás 1 en el segundo 0) y quítale los graves más profundos con `eq_lowcut`. Verifica que la banda de graves profundos baja respecto al original. Dime el taskId.

En el espectro de la web, la línea «After» debe caer por la izquierda. Apunta el taskId y limpia Reaper.

## Exportar y revisar

1. **Exporta cada tarea.** Ejecuta, una vez por tarea, `pnpm replay:export <taskId> --title "Loop at 170 BPM"`, con un título corto en inglés. Fíjate en los tamaños: si avisa de más de 15 MB, coméntalo.
2. **Revisa la web en local.** Ejecuta `pnpm --filter @reaper-copilot/web start` y abre http://localhost:4200. Comprueba que salen las tres ejecuciones, que suenan los reproductores, que la forma de onda avanza y que el espectro tiene dos líneas. Para parar, pulsa Ctrl+C.
3. **Pasa los tres taskId a Claude** en la sesión del repositorio, para el commit y la pull request.

## Si algo falla

- **La duración da `fail`.** Normalmente es que el compás 1 no empieza donde se dijo. Indícale a Claude: «el compás 1 empieza en el segundo N». Para encontrar N, importa el tema en Reaper: el primer pico grande de la forma de onda es el primer golpe, y la regla superior marca el tiempo.
- **El tempo sale `unmeasured`.** El audio no tiene un ritmo claro. Prueba con otro tema con más batería.
- **Sale `daw_unavailable`.** Reaper está cerrado o falta el puente. Ejecuta otra vez `pnpm reaper:bridge`.
- **Si no entiendes algo,** pregunta en la sesión: «¿qué acabas de hacer y por qué?».

## Cierre de la fase (después de la demostración)

1. Claude borra las dos ejecuciones de prueba del click (`08d8af85…` y `3c038123…`, sin commit) y hace el commit de las tres ejecuciones reales.
2. Push de `fase/F3-replay`, pull request a `main`, CI en verde y fusión.
3. **El autor activa Pages:** en GitHub, Settings → Pages → Source: GitHub Actions. El workflow publica en `https://cristianantval85.github.io/Reaper-Copilot/`.
4. Se comprueba la URL pública: tres ejecuciones con el audio reproduciéndose.
5. Cierre en `docs/CHANGELOG.md` y `docs/estado.md`, en la rama de la fase siguiente.
