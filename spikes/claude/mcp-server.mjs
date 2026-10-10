// Tiny Streamable-HTTP MCP server with bearer auth. Tools: shots_list, image_view, slow_wait.
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { deflateSync } from 'node:zlib';

// --- minimal PNG encoder (solid color, w x h, RGB) ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function solidPng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const log = [];
const ts = () => new Date().toISOString().slice(11, 23);

function buildServer() {
  const server = new McpServer({ name: 'conti', version: '0.0.1' });
  server.registerTool('shots_list', {
    description: 'List shots of the current sequence as JSON.',
    inputSchema: { seq: z.string().optional().describe('sequence id') },
  }, async ({ seq }) => {
    log.push({ t: ts(), tool: 'shots_list', seq });
    const shots = [{ id: '0010', size: 'WS' }, { id: '0020', size: 'MS' }, { id: '0030', size: 'CU' }];
    return { content: [{ type: 'text', text: JSON.stringify({ seq: seq ?? 'S01', shots }) }] };
  });
  server.registerTool('image_view', {
    description: 'Return the image of a shot (PNG).',
    inputSchema: { shot: z.string().optional() },
  }, async ({ shot }) => {
    log.push({ t: ts(), tool: 'image_view', shot });
    const png = solidPng(16, 16, [220, 30, 30]); // solid RED
    return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
  });
  server.registerTool('slow_wait', {
    description: 'Sleep for N seconds then return a marker string.',
    inputSchema: { seconds: z.number().int().min(0).max(600) },
  }, async ({ seconds }) => {
    log.push({ t: ts(), tool: 'slow_wait', seconds, phase: 'start' });
    await new Promise((r) => setTimeout(r, seconds * 1000));
    log.push({ t: ts(), tool: 'slow_wait', seconds, phase: 'end' });
    return { content: [{ type: 'text', text: `WAITED-${seconds}` }] };
  });
  return server;
}

export async function start({ port = 0, token = 'x' } = {}) {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.all('/mcp', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${token}`) {
      log.push({ t: ts(), http: 'unauthorized', auth });
      return res.status(401).json({ error: 'unauthorized' });
    }
    log.push({ t: ts(), http: req.method, method: req.body?.method, id: req.body?.id });
    // stateless: fresh server+transport per request
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { if (!res.writableFinished) log.push({ t: ts(), http: 'client-closed-early', method: req.body?.method }); transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const srv = await new Promise((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
  return { port: srv.address().port, close: () => srv.close() };
}

if (process.argv[1] && process.argv[1].endsWith('mcp-server.mjs')) {
  const { port } = await start({ port: Number(process.env.PORT || 0) });
  console.log('listening on', port);
}
