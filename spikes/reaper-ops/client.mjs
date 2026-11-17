// Spike client: node client.mjs <method> [jsonParams] [timeoutMs]
import { writeFileSync, renameSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inbox = join(here, 'out', 'ipc', 'inbox');
const outbox = join(here, 'out', 'ipc', 'outbox');
mkdirSync(inbox, { recursive: true });
mkdirSync(outbox, { recursive: true });

// Linux -> UNC for paths Reaper must open (Windows Reaper reaches WSL through \\wsl.localhost).
export const toUnc = (p) => `\\\\wsl.localhost\\${process.env.WSL_DISTRO_NAME}${p.replaceAll('/', '\\')}`;

let seq = 0;
export async function call(method, params = {}, timeoutMs = 10000) {
  const id = `${Date.now()}-${process.pid}-${seq++}`;
  const file = join(inbox, `${id}.json`);
  const t0 = performance.now();
  writeFileSync(`${file}.tmp`, JSON.stringify({ id, method, params, schemaVersion: 1 }));
  renameSync(`${file}.tmp`, file);
  const out = join(outbox, `${id}.json`);
  while (performance.now() - t0 < timeoutMs) {
    if (existsSync(out)) {
      const res = JSON.parse(readFileSync(out, 'utf8'));
      unlinkSync(out);
      return { ...res, roundTripMs: Math.round(performance.now() - t0) };
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  if (existsSync(file)) unlinkSync(file);
  return { id, ok: false, error: { code: 'timeout', message: `no response in ${timeoutMs} ms` } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [method, params, timeout] = process.argv.slice(2);
  const res = await call(method, params ? JSON.parse(params) : {}, timeout ? Number(timeout) : 10000);
  console.log(JSON.stringify(res, null, 2));
}
