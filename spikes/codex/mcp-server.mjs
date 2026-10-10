// Tiny Streamable-HTTP MCP server for the Codex spike.
// Usage: node mcp-server.mjs [port]   (env CONTI_MCP_TOKEN required)
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = Number(process.argv[2] || 47123);
const TOKEN = process.env.CONTI_MCP_TOKEN;
if (!TOKEN) { console.error('CONTI_MCP_TOKEN missing'); process.exit(2); }

// 1x1 red PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

function buildServer() {
  const server = new McpServer({ name: 'conti', version: '0.0.1' });
  server.registerTool(
    'shots_list',
    {
      description: 'List storyboard shots of the current sequence as JSON.',
      inputSchema: { seq: z.string().optional().describe('sequence id, e.g. S41') },
    },
    async ({ seq }) => {
      log('tool shots_list', { seq });
      const shots = [
        { seq: seq ?? 'S41', shot: '0010', size: 'WS', status: 'done' },
        { seq: seq ?? 'S41', shot: '0020', size: 'MS', status: 'todo' },
      ];
      return { content: [{ type: 'text', text: JSON.stringify({ shots }) }] };
    },
  );
  server.registerTool(
    'image_view',
    {
      description: 'Return the rendered image of a shot.',
      inputSchema: { shot: z.string().describe('shot id, e.g. 0010') },
    },
    async ({ shot }) => {
      log('tool image_view', { shot });
      return {
        content: [
          { type: 'text', text: `image for shot ${shot} (1x1 red png)` },
          { type: 'image', data: PNG_B64, mimeType: 'image/png' },
        ],
      };
    },
  );
  return server;
}

function log(...a) { console.error(new Date().toISOString(), ...a); }

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  log(req.method, url.pathname, 'auth=' + (req.headers.authorization ? 'present' : 'none'),
      'x-conti=' + (req.headers['x-conti-test'] ?? 'none'));
  if (url.pathname !== '/mcp') { res.writeHead(404).end(); return; }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    log('401 bad auth:', req.headers.authorization);
    res.writeHead(401, { 'content-type': 'application/json' })
       .end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  // stateless: fresh server+transport per request
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(PORT, '127.0.0.1', () => log(`MCP listening http://127.0.0.1:${PORT}/mcp`));
