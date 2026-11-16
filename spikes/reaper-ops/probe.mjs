// Spike: toggle bypass of each FX on track 0 and render; report peak of each render.
import { call, toUnc } from './client.mjs';
import { execFileSync } from 'node:child_process';
const ws = '/home/cristian-pc/proyectos/reaper_copilot/RCA/workspace/spike-reaper-ops';
const bypassIdx = { 0: 16, 1: 1, 2: 3 };
const st = (await call('get_project_state')).result;
console.log('fx', st.tracks[0].fx, 'item', JSON.stringify(st.tracks[0].items[0]));
for (const f of [0, 1, 2]) {
  const p = (await call('fx_params', { track: 0, fx: f })).result.params;
  console.log(`fx${f}`, p.map((x) => `${x.i}:${x.name}=${x.text}`).join(' | '));
}
const peak = (name) => execFileSync('../../python/analysis/.venv/bin/python', ['-c', `import soundfile as sf,numpy as np;y,_=sf.read('${ws}/${name}.wav');print(round(float(20*np.log10(max(np.abs(y).max(),1e-6))),2))`]).toString().trim();
let n = 0;
for (const on of [[1,1,1],[0,1,1],[1,0,1],[1,1,0],[0,0,0]]) {
  for (const f of [0, 1, 2]) await call('fx_set', { track: 0, fx: f, param: bypassIdx[f], value: on[f] ? 0 : 1 });
  const name = `probe-${Date.now()}-${n++}`;
  await call('render_selection', { guid: st.tracks[0].items[0].guid, dir: toUnc(ws), name }, 30000);
  console.log('active eq,dist,lim =', on.join(','), 'peak dB', peak(name));
}
