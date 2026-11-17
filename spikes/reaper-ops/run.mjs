// Spike: end-to-end loop at 170. node run.mjs <sliceMode offset|split> <renderName>
import { call, toUnc } from './client.mjs';
const [mode = 'offset', name = 'loop170', timebase, tempoFirst] = process.argv.slice(2);
const ws = '/home/cristian-pc/proyectos/reaper_copilot/RCA/workspace/spike-reaper-ops';
const must = (r, label) => { if (!r.ok) { console.log(label, JSON.stringify(r)); process.exit(1); } console.log(`${label} (${r.roundTripMs} ms):`, JSON.stringify(r.result)); return r.result; };
const short = (r) => ({ ...r, params: r.params?.map((p) => `${p.i}:${p.name}=${p.text}`) });

must(await call('new_tab'), 'new_tab');
if (tempoFirst) must(await call('set_tempo', { bpm: 170 }), 'set_tempo first');
const imp = must(await call('import_audio', { path: toUnc(`${ws}/clicks150.wav`) }), 'import');
const sl = must(await call('slice', { guid: imp.guid, sourceBpm: 150, offsetSec: 0.5, startBar: 5, bars: 4, beatsPerBar: 4, mode }), 'slice');
const st = must(await call('stretch', { guid: sl.guid, sourceBpm: 150, targetBpm: 170, setProjectTempo: !tempoFirst, ...(timebase ? { timebase: Number(timebase) } : {}) }), 'stretch');
const t = imp.track;
for (const fx of ['ReaEQ (Cockos)', 'JS: Waveshaping Distortion', 'ReaLimit (Cockos)']) {
  const r = await call('fx_add', { track: t, name: fx });
  if (!r.ok) { console.log('fx_add', fx, JSON.stringify(r)); continue; }
  console.log('fx_add', fx, JSON.stringify(short(r.result)));
}
console.log('state', JSON.stringify((await call('get_project_state')).result));
must(await call('render_selection', { guid: st.guid, dir: toUnc(ws), name }, 120000), 'render');
