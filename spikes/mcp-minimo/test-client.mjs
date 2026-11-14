import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function run(mode) {
  const transport = new StdioClientTransport({ command: 'node', args: ['server.mjs'], env: { ...process.env, MODE: mode }, stderr: 'ignore' });
  const client = new Client({ name: 'spike-client', version: '0.0.1' });
  const t0 = performance.now();
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`\n[${mode}] connected in ${Math.round(performance.now() - t0)} ms; tools:`, tools.map((t) => `${t.name}${t.annotations?.readOnlyHint ? ' (readOnly)' : ''}`));
  if (mode === 'agent') console.log('inputSchema of spike_set_tempo:', JSON.stringify(tools.find((t) => t.name === 'spike_set_tempo').inputSchema));
  const show = async (label, req) => {
    try {
      const r = await client.callTool(req);
      console.log(`${label}:`, JSON.stringify({ isError: r.isError ?? false, text: r.content?.[0]?.text, structured: r.structuredContent }));
    } catch (e) {
      console.log(`${label}: THROWN ${e.code ?? ''} ${String(e.message).slice(0, 200)}`);
    }
  };
  await show('valid call', { name: 'spike_analyze', arguments: { path: 'samples/a.wav', targetBpm: 190 } });
  await show('handler error', { name: 'spike_analyze', arguments: { path: '../etc/passwd' } });
  await show('invalid args', { name: 'spike_analyze', arguments: { path: 'a.wav', targetBpm: 999 } });
  await show('set_tempo', { name: 'spike_set_tempo', arguments: { bpm: 170 } });
  await client.close();
}
await run('agent');
await run('mentor');
