import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { evaluateLive } from '../scripts/evaluate-live.js';
import { assess } from '../scripts/evaluations/assess.js';
import { scenarios } from '../scripts/evaluations/scenarios.js';

test('evaluation requires a bounded authorization and rejects unknown scenarios', async () => {
  await assert.rejects(evaluateLive({ live: true }), /authorization/);
  await assert.rejects(evaluateLive({ only: 'typo' }), /Unknown scenario/);
});
test('assessor does not pass answer quality, catches tool attempts and unauthorized writes', () => {
  const scenario = scenarios[0];
  const before = { task: [], action: [] };
  const calls = [{ name: 'get_discharge_plan', response: { result: {} } }];
  const response = { answer: 'Unreviewed answer', sessionId: 'test' };
  assert.equal(
    assess(scenario, before, before, calls, response, 200).verdict,
    'needs-human-review',
  );
  assert.equal(
    assess(scenario, before, before, [...calls, { name: 'approve', response: {} }], response, 200)
      .failures[0].category,
    'model-behavior',
  );
  assert.equal(
    assess(scenario, before, { task: ['changed'], action: [] }, calls, response, 200).failures[0]
      .category,
    'backend-control',
  );
});
test('isolated harness records a real MCP exchange with a simulated runtime; never a live-model claim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'homeward-harness-'));
  const previous = process.env.TRUEFORGE_URL;
  const app = express();
  app.use(express.json());
  let connector,
    turns = 0;
  app.get('/api/v1/models', (_req, res) => res.json({ data: ['fake/evaluation-contract-only'] }));
  app.get('/api/v1/mcp-servers', (_req, res) => res.json({ data: [] }));
  app.post('/api/v1/settings/mcp-servers', (req, res) => {
    connector = req.body.manifest;
    res.json({ data: connector });
  });
  app.post('/api/v1/sessions', (_req, res) => res.json({ data: { id: 'fake-session' } }));
  app.post('/api/v1/sessions/fake-session/turns', async (_req, res) => {
    turns++;
    const client = new Client({ name: 'evaluation-contract', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(connector.url)));
      await client.callTool({ name: 'get_discharge_plan', arguments: {} });
      res.json({
        data: {
          id: 'fake-turn',
          state: {
            status: 'done',
            output: {
              content: 'Bring your discharge summary and medication list (Discharge summary, s2).',
            },
            metrics: { input_tokens: 10 },
          },
        },
      });
    } finally {
      await client.close();
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env.TRUEFORGE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const report = await evaluateLive({
      live: true,
      maxRequests: 1,
      budget: 'test-only simulated runtime',
      only: 'paperwork',
      output: join(dir, 'report.json'),
    });
    assert.equal(report.infrastructureFailure, undefined);
    const row = report.results[0];
    assert.equal(row.verdict, 'needs-human-review', JSON.stringify(row.failures));
    assert.equal(row.sessionId, 'fake-session');
    assert.equal(row.toolCalls.length, 1);
    assert.equal(row.toolCalls[0].response.result.isError, undefined);
    assert.ok(row.toolCalls[0].response.result.content[0].text.includes(row.patientId));
    assert.ok(connector.name.startsWith('homeward-eval-'));
    assert.equal(turns, 1);
    assert.deepEqual(row.before, row.after);
    assert.deepEqual(row.metrics, { input_tokens: 10 });
    // Preflight checks readiness and the injected outage, but cannot create a model turn.
    const preflight = await evaluateLive({ output: join(dir, 'preflight.json') });
    assert.equal(turns, 1);
    assert.equal(preflight.summary.pass, 1);
    assert.equal(preflight.summary['not-run'], 10);
  } finally {
    if (previous === undefined) delete process.env.TRUEFORGE_URL;
    else process.env.TRUEFORGE_URL = previous;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
