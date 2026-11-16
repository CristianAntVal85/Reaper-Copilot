// Spike: set FX params on track 0 of the current project and render. node fx.mjs <name> <dist%> <limitThresholdDb>
import { call, toUnc } from './client.mjs';
const [name, dist, thr] = process.argv.slice(2);
const ws = '/home/cristian-pc/proyectos/reaper_copilot/RCA/workspace/spike-reaper-ops';
console.log('dist', JSON.stringify((await call('fx_set', { track: 0, fx: 1, param: 0, value: Number(dist) })).result));
console.log('limit', JSON.stringify((await call('fx_set', { track: 0, fx: 2, param: 0, value: Number(thr) })).result));
const st = (await call('get_project_state')).result;
const r = await call('render_selection', { guid: st.tracks[0].items[0].guid, dir: toUnc(ws), name }, 30000);
console.log('render', JSON.stringify(r));
