import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

test('HTTP and existing patient-bound MCP plan share fresh guidance without model calls', async () => {
  const store = new Store(':memory:');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = (input, options) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(base + '/')) {
      externalCalls++;
      throw new Error('External/model service unavailable in this deterministic test.');
    }
    return originalFetch(input, options);
  };
  async function chat(patientId, mode, message = 'What is my next step?') {
    const response = await fetch(`${base}/api/patients/${patientId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, message }),
    });
    return { status: response.status, result: await response.json() };
  }
  try {
    const plan = await (await fetch(`${base}/api/patients/demo-001/plan`)).json();
    for (const mode of ['source-search', 'live']) {
      const { status, result } = await chat('demo-001', mode);
      assert.equal(status, 200);
      assert.equal(result.mode, 'source-search');
      assert.equal(result.answerType, 'plan_guidance');
      assert.equal(result.metrics, null);
      assert.equal(result.sessionId, undefined);
      assert.deepEqual(result.guidance, plan.guidance);
    }
    const client = new Client({ name: 'guidance-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/demo-001`)));
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 7);
    assert.equal(tools.find((t) => t.name === 'get_discharge_plan').annotations.readOnlyHint, true);
    const toolResult = await client.callTool({ name: 'get_discharge_plan', arguments: {} });
    assert.deepEqual(JSON.parse(toolResult.content[0].text).guidance, plan.guidance);
    const attemptedOverride = await client.callTool({ name: 'get_discharge_plan', arguments: { patientId: 'demo-002' } });
    if (!attemptedOverride.isError) {
      const scoped = JSON.parse(attemptedOverride.content[0].text);
      assert.equal(scoped.patient.id, 'demo-001');
      assert.equal(scoped.guidance.nextTask.taskId, 'demo-001-task-3');
    }
    const other = new Client({ name: 'guidance-other-patient-test', version: '1.0.0' });
    clients.push(other);
    await other.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/demo-003`)));
    const otherPlan = JSON.parse((await other.callTool({ name: 'get_discharge_plan', arguments: {} })).content[0].text);
    assert.equal(otherPlan.guidance.nextTask.taskId, 'demo-003-task-1');
    assert.ok(!JSON.stringify(otherPlan.guidance).includes('demo-001'));

    const completed = await fetch(`${base}/api/patients/demo-001/tasks/demo-001-task-3`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true }),
    });
    assert.equal(completed.status, 200);
    const fresh = await chat('demo-001', 'live');
    assert.equal(fresh.result.guidance.nextTask.taskId, 'demo-001-task-1');
    const freshToolPlan = JSON.parse((await client.callTool({ name: 'get_discharge_plan', arguments: {} })).content[0].text);
    assert.deepEqual(freshToolPlan.guidance, fresh.result.guidance);
    assert.equal((await chat('missing', 'source-search')).status, 404);
    assert.equal((await chat('demo-001', 'source-search', 'What paperwork should I bring?')).result.answerType, 'source_passages');
    assert.equal(externalCalls, 0);
    assert.equal(store.all('action').length, 0);
    assert.ok(!store.all('trace').some((t) => t.event === 'agent.started'));
    // A clinical question must not be mistaken for deterministic plan navigation.
    assert.equal((await chat('demo-001', 'live', 'What is my next dose?')).status, 503);
    assert.equal(externalCalls, 1);
  } finally {
    for (const client of clients) await client.close();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
