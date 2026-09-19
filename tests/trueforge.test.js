import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Store } from '../server/store.js';
import { runAgent } from '../server/trueforge.js';

test('TrueForge adapter sends scoped session spec and preserves real response metrics', async () => {
  const captured = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : null;
    captured.push({ path: req.url, data });
    res.setHeader('Content-Type', 'application/json');
    const responses = {
      '/api/v1/models': { data: [{ name: 'fixture/model' }] },
      '/api/v1/mcp-servers': {
        data: [{ name: 'homeward-demo-001', url: 'http://localhost:8000/mcp/demo-001' }],
      },
      '/api/v1/sessions': { data: { id: 'session-fixture' } },
      '/api/v1/sessions/session-fixture/turns': {
        data: {
          id: 'turn-fixture',
          state: {
            status: 'done',
            required_actions: [],
            output: {
              content: 'Bring your discharge summary and medication list. Source: Paperwork.',
            },
            metrics: { total_tokens: 123, total_cost_in_usd: 0.001 },
          },
        },
      },
    };
    res.end(JSON.stringify(responses[req.url] || {}));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const previous = {
    url: process.env.TRUEFORGE_URL,
    model: process.env.TRUEFORGE_MODEL,
    mcp: process.env.MCP_PUBLIC_URL,
  };
  process.env.TRUEFORGE_URL = `http://127.0.0.1:${server.address().port}`;
  delete process.env.TRUEFORGE_MODEL;
  process.env.MCP_PUBLIC_URL = 'http://localhost:8000/mcp';
  const store = new Store(':memory:');
  try {
    const result = await runAgent(store, 'demo-001', 'What paperwork?');
    assert.equal(result.mode, 'live');
    assert.equal(result.metrics.total_tokens, 123);
    const spec = captured.find((r) => r.path === '/api/v1/sessions').data.agent.spec;
    assert.equal(spec.model.name, 'fixture/model');
    assert.equal(spec.mcp_servers[0].name, 'homeward-demo-001');
    assert.equal(captured.find((r) => r.path.endsWith('/turns')).data.stream, false);
    assert.equal(store.all('trace').at(-1).metrics.total_cost_in_usd, 0.001);
  } finally {
    for (const [key, value] of [
      ['TRUEFORGE_URL', previous.url],
      ['TRUEFORGE_MODEL', previous.model],
      ['MCP_PUBLIC_URL', previous.mcp],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
