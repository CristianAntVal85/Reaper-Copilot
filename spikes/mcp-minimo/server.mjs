// Spike: minimal MCP stdio server. Throwaway code. stdout is the protocol: log to stderr only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const MODE = process.env.MODE === 'mentor' ? 'mentor' : 'agent';
const server = new McpServer({ name: 'reaper-copilot-spike', version: '0.0.1' });

const analyzeOut = { file: z.string(), tempo: z.object({ bpm: z.number(), confidence: z.number() }), mode: z.string() };

server.registerTool(
  'spike_analyze',
  {
    title: 'Analyze audio (spike)',
    description: 'Read-only. Returns a fake compact analysis for an audio file path inside the workspace.',
    inputSchema: { path: z.string().min(1), targetBpm: z.number().min(60).max(320).optional() },
    outputSchema: analyzeOut,
    annotations: { readOnlyHint: true },
  },
  async ({ path, targetBpm }) => {
    if (path.includes('..')) {
      return { isError: true, content: [{ type: 'text', text: 'path_outside_workspace: ".." is not allowed' }] };
    }
    const result = { file: path, tempo: { bpm: targetBpm ?? 170, confidence: 0.5 }, mode: MODE };
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  },
);

if (MODE === 'agent') {
  server.registerTool(
    'spike_set_tempo',
    {
      title: 'Set tempo (spike)',
      description: 'Modifies the project (fake): sets the project tempo in BPM. Not available in mentor mode.',
      inputSchema: { bpm: z.number().min(60).max(320) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ bpm }) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, tempo: bpm }) }] }),
  );
}

console.error(`[spike] starting in ${MODE} mode, pid ${process.pid}`);
await server.connect(new StdioServerTransport());
