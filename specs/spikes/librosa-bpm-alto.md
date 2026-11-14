# Spike: librosa-bpm-alto

Fecha: 2026-11-14. Código desechable en `spikes/librosa-bpm-alto/` (`bpm_test.py`, `refine.py`; salidas en `results.json` y `refine.json`).

## Pregunta

¿Detecta librosa el BPM correcto en hardstyle y hardcore de 160 a 210 BPM, o cae en la mitad o el doble? ¿Lo arregla usar el tempo objetivo como pista? ¿Qué tolerancia es realista para los criterios de la sección 9.2?

## Entorno y material

librosa 1.0.1, numpy 2.5.4, scipy 1.18.1, libsndfile 1.2.2 (lee MP3 sin ffmpeg), Python 3.12. Seis temas comerciales en MP3 (`.mp3/`, fuera de git) con el BPM declarado por el autor en `ground-truth.csv` (el de «You Can't Stop Me» se corrigió de 180 a 200 tras la primera pasada; las cifras de esta nota son las de la segunda). Audio cargado en mono a 22 050 Hz. De cada tema: el tema completo y seis fragmentos (4 y 16 compases, al 25, 50 y 75 % de la duración).

## Qué se probó y qué pasó

### 1. `librosa.feature.tempo` tal cual

Tema completo. «Fina» es `hop_length=128`; «por defecto» es 512.

| Tema | Real | Sin pista, por defecto | Con pista, por defecto | Con pista, fina |
|---|---|---|---|---|
| Uncharted | 160 | 161,50 | 161,50 | 159,01 |
| Voice Of The Underground | 180 | 89,10 (mitad) | 184,57 | 181,33 |
| KCKPRN | 190 | 95,70 (mitad) | 184,57 | 191,41 |
| Break Your Face | 210 | 103,36 (mitad) | 215,33 | 210,94 |
| You Can't Stop Me | 200 | 99,38 (mitad) | 198,77 | 198,77 |
| It Will Be OK | 160 | 161,50 | 161,50 | 161,50 |

- **Sin pista cae a la mitad** en los cuatro temas de 180 a 210. Solo acierta los de 160.
- **Con la resolución por defecto los valores están cuantizados:** a estos tempos solo puede devolver 161,50, 172,27, 184,57, 198,77 o 215,33. Un tema a 190 sale como 184,57.
- **Con resolución fina y pista acierta el tempo aproximado**, pero el error sigue entre 1 y 1,5 BPM. En fragmentos de 4 compases: 16 de 18 en el tempo correcto, solo 6 de 18 dentro de ±1 BPM.
- Usar un rango propio del género (140-230) como distribución previa da lo mismo que la pista.

### 2. Refinado por búsqueda fina

Sobre la autocorrelación de la envolvente de ataques (`hop_length=64`), se puntúa cada tempo candidato en pasos de 0,05 BPM sumando la autocorrelación a 1, 2, 4 y 8 tiempos, y se elige el máximo. La puntuación (0 a 1) sirve de confianza.

| Tema | Real | Búsqueda 140-230, tema completo | Puntuación |
|---|---|---|---|
| Uncharted | 160 | 159,95 | 0,36 |
| Voice Of The Underground | 180 | 179,95 | 0,70 |
| KCKPRN | 190 | 189,90 | 0,40 |
| Break Your Face | 210 | 209,90 | 0,34 |
| You Can't Stop Me | 200 | 199,75 | 0,49 |
| It Will Be OK | 160 | 159,95 | 0,51 |

- **Los seis temas a 0,25 BPM o menos del valor real, sin pista** (cinco de ellos a 0,1 o menos).
- En la primera pasada «You Can't Stop Me» estaba declarado a 180 y salía a 199,75 con todos los métodos; buscando solo alrededor de 180 la puntuación era 0,09. El autor comprobó que el tema es de 200: la medida detectó el error del dato.
- Fragmentos (18 por tamaño):

| Fragmento | Búsqueda 140-230 | Búsqueda con pista (±4 %) |
|---|---|---|
| 4 compases | 16 de 18 dentro de ±0,5 BPM | 17 de 18 dentro de ±0,5 BPM |
| 16 compases | 18 de 18 | 18 de 18 |

- Los dos fallos sin pista en 4 compases son de «Uncharted» y dan unos 213 (4/3 del real). El único fallo con pista tiene puntuación 0,04.
- Puntuaciones de los aciertos con pista en 4 compases: de 0,11 a 0,64. El margen sobre el fallo (0,04) es estrecho.

### 3. Tiempos

- Cargar un MP3 completo: de 0,25 a 0,7 s.
- Refinado: de 0,6 a 1,7 s por tema completo; 0,15 s como máximo por fragmento.
- `librosa.feature.tempo` con resolución fina: de 4 a 6 s por tema completo; menos de 0,8 s por fragmento.

## Qué se decide

Aprobado por el autor el 2026-11-14 y recogido en el documento maestro v2.4 (sección 8.1):

1. **No usar `librosa.feature.tempo` como medida final.** El análisis de tempo es: envolvente de ataques con `hop_length=64` y búsqueda fina sobre la autocorrelación. Con librosa como base, sin dependencias nuevas.
2. **Con tempo objetivo, se busca en ±4 % alrededor.** Sin él, en el rango del género (140-230), y las alternativas mitad y doble se devuelven igualmente.
3. **`tempo.confidence` es la puntuación de la búsqueda.** Por debajo de 0,10 el resultado del criterio de BPM es `unmeasured`. Umbral provisional y ajustado: sale de 36 fragmentos, con un acierto en 0,11 y el fallo en 0,04.
4. **La tolerancia de ±1 BPM del criterio derivado es alcanzable** con el refinado; con `librosa.feature.tempo` no lo sería. Se mantiene ±1.
5. **Fragmentos de 4 compases sin pista no son del todo fiables** (16 de 18): el criterio de duración sigue siendo la comprobación principal del tempo, como ya dice la sección 9.2.

Cambió el documento maestro: sección 8.1 y preguntas abiertas 10 y 11.

## Qué queda abierto

- **Posición del primer tiempo.** El script la calcula, pero no se validó contra nada. Hace falta para `slice_loop` y los MP3 no sirven para medirla (el codificador añade un desfase). Necesita material en WAV con el primer tiempo conocido.
- El material son temas enteros masterizados. No se probó con loops sueltos, breaks sin bombo ni audio ya estirado por Reaper.
- Cambios de tempo dentro de un tema: no se probaron.
- Herramientas de Python: el sistema no traía `venv` ni `pip`; hubo que instalar `python3.12-venv`. La fase 0b debe fijar cómo se crea el entorno (y si se usa `uv`).
