# Spike: reaper-ops

Fecha: 2026-11-16. Código desechable en `spikes/reaper-ops/`: `bridge.lua`, `client.mjs`, `run.mjs` (flujo completo), `fx.mjs`, `probe.mjs` y `make_clicks.py` (audio de prueba). Continúa `reaper-bridge-windows.md`, que dejó sin probar el corte, el estirado, las cadenas de FX y el render por selección.

## Pregunta

¿Cómo se cortan 4 compases, se estiran al tempo objetivo, se aplica una cadena de FX de serie con parámetros y se renderiza solo la selección desde el puente (Reaper de Windows, workspace en WSL por UNC), de forma que el render cumpla los criterios de la sección 9.2 medido con `analyze_audio`?

## Entorno

Reaper 7.86 x64 en Windows, puente cargado con `reaper.exe -nonewinst '\\wsl.localhost\Ubuntu-24.04\...\bridge.lua'` desde WSL. Cliente Node 24 en WSL. Audio de prueba: `workspace/spike-reaper-ops/clicks150.wav`, click a 150 BPM, 16 compases de 4/4, 0,5 s de silencio inicial, primer tiempo acentuado (1500 Hz frente a 800 Hz) y un zumbido de 55 Hz. Objetivo: compases 5 a 8, a 170 BPM. Esperado: 4 × 4 × 60 / 170 = 5,647 s.

## Qué se probó y qué pasó

| Prueba | Resultado |
|---|---|
| Corte por desplazamiento de la toma (`D_STARTOFFS` += inicio, `D_LENGTH` = compases, `D_POSITION` = 0) | `startOffs` 6,9 (0,5 + 4 × 1,6), longitud 6,4 s. Un solo item, sin borrar nada |
| Corte por `SplitMediaItem` en el inicio y el final, borrando los extremos | Mismo resultado, pero el primer click sale a 0,49 de amplitud frente a 1,0: Reaper aplica un fundido al dividir |
| Estirado: `D_PLAYRATE` × 170/150, `B_PPITCH` = 1, `D_LENGTH` / tasa, y después `SetCurrentBPM(170)` | **Mal:** tasa 1,606 y longitud 3,986 s. El item tiene timebase de tiempos (`C_BEATATTACHMODE` = -1, valor del proyecto) y el cambio de tempo lo vuelve a estirar × 170/120 |
| Lo mismo con `C_BEATATTACHMODE` = 0 (tiempo) antes de cambiar el tempo | Tasa 1,1333, longitud 5,647059 s |
| Lo mismo fijando el tempo 170 antes de importar | Tasa 1,1333, longitud 5,647059 s |
| Render de la selección de tiempo (`RENDER_BOUNDSFLAG` 2, selección = límites del item, acción 42230) a `workspace/` por UNC | WAV de 24 bits, 44,1 kHz, estéreo, en 0,6-0,7 s |
| `analyze_audio` del render, objetivo 170 | `durationSec` 5,647052 (6 µs del esperado), `tempo.bpm` 170,01, `confidence` 0,702, `matches: true` |
| Inicio del corte y tono | Primer ataque en t = 0 a 1496 Hz (el primer tiempo acentuado); ataques cada 0,353 s (60/170); 800 y 1500 Hz conservados |
| Plugins de serie (`EnumInstalledFX`, 193 instalados) | `VST: ReaEQ (Cockos)`, `VST: ReaComp (Cockos)`, `VST: ReaLimit (Cockos)`, `JS: Waveshaping Distortion` (`loser/waveShapingDstr`), `JS: Saturation`, `JS: Event Horizon Clipper`, `JS: Master Limiter`, entre otros. `TrackFX_AddByName` con el nombre sin prefijo los encuentra |
| Parámetros (`TrackFX_GetParamName`, `GetFormattedParamValue`) | ReaEQ: 19 (`Freq-Low Shelf`, `Gain-Low Shelf`, …, `Freq-High Pass 5`, `Global Gain`, `Bypass`, `Wet`, `Delta`). Waveshaping: `Distortion (%)` 0-100. ReaLimit: `Threshold`, `Ceiling`, `Release` |
| `TrackFX_SetParam(ReaLimit, Threshold, -6)` | **Mal:** queda en -60,00. Los VST de Cockos reciben el valor normalizado (0 a 1); los JS, en unidades reales (Distortion 80 queda en 80) |
| Fijar por valor mostrado: bisección de 40 pasos sobre `TrackFX_FormatParamValueNormalized`, después `SetParamNormalized` | Threshold -6 → `-6.00` (rango -60..12), Ceiling -0,3 → `-0.31`, HP 30 Hz → `30.0` (escala logarítmica, 20..24000), Gain 3 → `3.0`, Distortion 50 → `50.0`. Un valor fuera de rango (-200) se rechaza con el rango real |
| Render con distorsión al 80 % y ReaLimit a -6 dB, comparado con el render limpio (`compare_audio`) | `crestFactorDb` 21,13 → 2,63 (Δ -18,5); `integratedLufs` -20,24 → -3,57 (Δ +16,67); duración igual; tempo 169,96, `matches: true` |
| Deshacer (`Undo_DoUndo2`), 7 veces tras importar, cortar, estirar (con el tempo) y 3 FX | 6 bloques revertidos, en orden, hasta el proyecto vacío; el séptimo devuelve 0 |
| Importar una ruta inexistente o una ruta de Linux sin traducir | `reaper.file_exists` la rechaza antes de `InsertMedia` (`file_not_found`) |
| Render a un nombre que ya existe | **Diálogo modal** «File already exists» (Increment filenames, Overwrite files, Cancel). El puente se bloquea hasta que alguien pulsa |
| Render tras cambiar de ventana a Reaper y volver | **Silencio** (-120 LUFS): la fuente queda fuera de línea (`GetMediaSourceLength` 0). La preferencia `offlineinact` («Set media offline when application is not active») vale 1. La acción 40439 (poner en línea) lo arregla |

Otros detalles:

- Reaper crea `peaks/` junto al audio importado (`workspace/spike-reaper-ops/peaks/clicks150.wav.reapeaks`).
- `get_config_var_string("offlineinact")` lee preferencias sin SWS; `SNM_GetIntConfigVar` no existe sin SWS.
- Un `quit` seguido de `-nonewinst` recarga el puente en un segundo, sin diálogos.
- Cada ida y vuelta de un comando que modifica tarda de 20 a 70 ms.

## Qué se decide

Propuesta, pendiente de aprobación del autor con el plan de F2a:

1. **Corte por desplazamiento de la toma, no por división.** Un solo item, sin fundidos ni borrados. Parámetros explícitos: `sourceBpm`, `offsetSec` (por defecto 0), `startBar` (desde 1), `bars` y `beatsPerBar` (por defecto 4). Cierra la pregunta abierta 11 por ahora.
2. **Estirado por tasa de reproducción con el tono conservado** (`D_PLAYRATE`, `B_PPITCH`), y **el puente pone el item en timebase de tiempo** (`C_BEATATTACHMODE` = 0) en cuanto lo importa. Así un cambio de tempo del proyecto nunca vuelve a estirar los items. `set_tempo` y `time_stretch` quedan independientes.
3. **Presets por valor mostrado.** Los parámetros de un preset se expresan en las unidades que muestra Reaper (dB, Hz, %) y por nombre de parámetro. El puente los fija con la bisección sobre `TrackFX_FormatParamValueNormalized` y devuelve el texto final. El rango permitido de cada preset es más estrecho que el del plugin.
4. **Render: nombre único por trabajo y el puente se niega si el archivo existe** (error, no diálogo). Formato WAV, selección de tiempo igual a los límites del item, mezcla del master, sin cola.
5. **Antes de renderizar, el puente pone en línea todo el medio** (acción 40439) y comprueba que la fuente tiene longitud mayor que cero; si no, error. Además se documenta que conviene desactivar la preferencia «Set media offline when application is not active».
6. **El puente comprueba el resultado de cada operación** (longitud del item, tasa, existencia del render), como ya hacía con `InsertMedia`.
7. La duración del render es la comprobación del tempo más fiable (6 µs de error en este caso), como ya dice la sección 9.2.

## Qué queda abierto

- Con audio real (temas de la demostración): el corte supone que el primer tiempo está en `offsetSec`; con un MP3 que empieza en silencio o a mitad de compás, el LLM o el autor tienen que dar el desplazamiento.
- El modo de estirado (`I_PITCHMODE` -1, el del proyecto, élastique por defecto): no se comparó con otros modos ni con material tonal.
- La cola de render (`RENDER_TAILFLAG`) quedó a 0; con reverb o delay se cortaría la cola.
- `peaks/` dentro del workspace: excluirla o redirigirla en las preferencias de Reaper.
- Durante la prueba se abrieron varias pestañas de proyecto (`new_tab`, acción 40859). En F2a falta decidir si el copiloto trabaja en la pestaña activa o en una propia.
