import { call } from './client.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
await call('stats');
const t0 = performance.now();
let done = false;
const render = call('render', { dir: out, name: 'render-test' }, 180000).then((r) => { done = true; return r; });
const pings = [];
await new Promise((r) => setTimeout(r, 100));
while (!done) {
  const s = Math.round(performance.now() - t0);
  const p = await call('ping', {}, 60000);
  pings.push({ sentAtMs: s, ok: p.ok, roundTripMs: p.roundTripMs });
  await new Promise((r) => setTimeout(r, 200));
}
const r = await render;
console.log('render:', JSON.stringify(r));
console.log('pings during render:', JSON.stringify(pings));
console.log('stats:', JSON.stringify((await call('stats')).result));
