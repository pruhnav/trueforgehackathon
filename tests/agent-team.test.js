import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { agentTeam, connectorName, routeAgent } from '../server/agents.js';
import { agentSpec, forgeStatus, registerPatientTeam, runAgent } from '../server/trueforge.js';

async function fakeForge(t) {
  const state = {
    models: ['fixture/model'], connectors: [], agents: [], captured: [], sessions: 0,
    output: { status: 'grounded', sourceRefs: [{ documentId: 'doc-demo-001', sectionId: 's2' }], taskIds: [], actionIds: [], educationTopic: null },
    onTurn: null, turnStatus: 200,
  };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : null;
    state.captured.push({ path: req.url, method: req.method, data });
    res.setHeader('Content-Type', 'application/json');
    let response;
    if (req.url === '/api/v1/models') response = { data: state.models.map((name) => ({ name })) };
    else if (req.url === '/api/v1/mcp-servers') response = { data: state.connectors };
    else if (req.url === '/api/v1/settings/mcp-servers') {
      state.connectors.push(data.manifest);
      response = { data: data.manifest };
    } else if (req.url === '/api/v1/agents' && req.method === 'GET') response = { data: state.agents };
    else if (req.url === '/api/v1/agents') {
      state.agents.push(data);
      response = { data };
    } else if (req.url === '/api/v1/sessions') response = { data: { id: `session-${++state.sessions}` } };
    else if (req.url.endsWith('/turns')) {
      state.onTurn?.();
      res.statusCode = state.turnStatus;
      response = { data: { id: 'turn-fixture', state: { status: 'done', required_actions: [], output: { content: JSON.stringify(state.output) }, metrics: { total_tokens: 123 } } } };
    } else { res.statusCode = 404; response = {}; }
    res.end(JSON.stringify(response));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const keys = ['TRUEFORGE_URL', 'TRUEFORGE_MODEL', 'TRUEFORGE_TOKEN', 'MCP_PUBLIC_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.TRUEFORGE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.MCP_PUBLIC_URL = 'http://localhost:8000/mcp';
  delete process.env.TRUEFORGE_MODEL;
  delete process.env.TRUEFORGE_TOKEN;
  t.after(async () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await new Promise((resolve) => server.close(resolve));
  });
  return state;
}

test('four specialist roles have bounded native specs and server-enforced MCP permissions', async () => {
  const store = new Store(':memory:');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  try {
    const team = await (await fetch(`${base}/api/agent-team`)).json();
    assert.equal(team.roles.length, 4);
    assert.equal(team.routing, 'one_specialist_per_live_request');
    assert.equal(routeAgent('Summarize my discharge instructions'), 'summarizer');
    assert.equal(routeAgent('What paperwork should I bring?'), 'questions');
    assert.equal(routeAgent('Set a reminder for my follow-up'), 'reminders');
    assert.equal(routeAgent('Add this instruction as a task'), 'coordinator');
    for (const role of agentTeam) {
      const client = new Client({ name: `test-${role.id}`, version: '1.0.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/demo-001/${role.id}`)));
      const tools = (await client.listTools()).tools;
      assert.deepEqual(tools.map((t) => t.name).sort(), [...role.tools].sort());
      if (['summarizer', 'questions'].includes(role.id)) assert.ok(tools.every((t) => t.annotations.readOnlyHint));
      const spec = agentSpec('openai/configured-model', connectorName('demo-001', role.id), 'demo-001', role.id);
      assert.deepEqual(spec.mcp_servers[0].enable_tools, role.tools);
      assert.equal(spec.response_format.type, 'json_schema');
      assert.equal(spec.config.dynamic_sub_agents.enabled, false);
      assert.ok(!role.tools.some((name) => ['approve', 'review_task', 'send_message', 'book_appointment'].includes(name)));
      assert.ok(connectorName('synthea-d537941e-1fb7-9868-939a-a26252da8be1', role.id).length <= 64);
      if (role.id === 'summarizer') {
        const result = await client.callTool({ name: 'get_discharge_summary', arguments: {} });
        const summary = JSON.parse(result.content[0].text);
        const http = await (await fetch(`${base}/api/patients/demo-001/summary`)).json();
        assert.deepEqual(summary, http);
        assert.ok(!JSON.stringify(summary).includes('doc-demo-002'));
        let blocked = false;
        try {
          const forbidden = await client.callTool({ name: 'propose_reminder', arguments: { taskId: 'demo-001-task-1' } });
          blocked = !!forbidden.isError;
        } catch (error) { blocked = /not found|unknown tool/i.test(error.message); }
        assert.equal(blocked, true);
      }
    }
    assert.equal(store.all('action').length, 0);
    assert.equal((await fetch(`${base}/api/patients/missing/summary`)).status, 404);
    const chat = await fetch(`${base}/api/patients/demo-001/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'source-search', message: 'Summarize my discharge instructions', intent: 'summary' }) });
    const summaryResponse = await chat.json();
    assert.equal(summaryResponse.answerType, 'discharge_summary');
    assert.equal(summaryResponse.execution, 'local');
    assert.equal(summaryResponse.sessionId, undefined);
  } finally {
    for (const client of clients) await client.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('provider-independent model selection, registration, and native summarizer response', async (t) => {
  const fake = await fakeForge(t);
  fake.models = ['fixture/model', 'openai/configured-model'];
  process.env.TRUEFORGE_MODEL = 'openai/configured-model';
  assert.equal((await forgeStatus()).selectedModel, 'openai/configured-model');
  const registered = await registerPatientTeam('demo-001', 'openai/configured-model');
  assert.equal(registered.length, 4);
  assert.ok(registered.every((r) => r.created));
  const saved = structuredClone(fake.agents);
  assert.ok((await registerPatientTeam('demo-001', 'fixture/model')).every((r) => !r.created));
  assert.deepEqual(fake.agents, saved);
  assert.ok(!fake.captured.some((r) => r.method === 'PUT' || r.method === 'DELETE'));
  const store = new Store(':memory:');
  try {
    const response = await runAgent(store, 'demo-001', 'Summarize my discharge instructions');
    assert.equal(response.agentRole, 'summarizer');
    assert.equal(response.execution, 'trueforge');
    assert.equal(response.metrics.total_tokens, 123);
    assert.equal(response.summary.patientId, 'demo-001');
    const session = fake.captured.find((r) => r.path === '/api/v1/sessions').data;
    assert.equal(session.agent.spec.model.name, 'openai/configured-model');
    assert.equal(session.agent.spec.mcp_servers[0].name, 'homeward-demo-001-summary');
    assert.equal(session.metadata.agent_role, 'summarizer');
    assert.equal(store.all('action').length, 0);
    process.env.TRUEFORGE_MODEL = 'openai/not-configured';
    const status = await forgeStatus();
    assert.equal(status.ready, false);
    assert.equal(status.configurationIssue, 'model_not_available');
    await assert.rejects(() => runAgent(store, 'demo-001', 'What paperwork?'), { status: 503 });
  } finally { store.close(); }
});

test('summary remains available without a model and after a provider failure', async (t) => {
  const fake = await fakeForge(t);
  const store = new Store(':memory:');
  try {
    fake.models = [];
    const local = await runAgent(store, 'demo-001', 'Summarize my discharge instructions');
    assert.equal(local.execution, 'local_fallback');
    assert.equal(local.sessionId, undefined);
    assert.equal(local.metrics, null);
    assert.equal(fake.sessions, 0);
    fake.models = ['fixture/model'];
    fake.turnStatus = 502;
    const failed = await runAgent(store, 'demo-001', 'Summarize my discharge instructions');
    assert.equal(failed.execution, 'local_fallback');
    assert.equal(failed.summary.patientId, 'demo-001');
    assert.ok(store.all('trace').some((entry) => entry.event === 'agent.failed'));
  } finally { store.close(); }
});

test('unverifiable model output and changed clinical snapshots use fresh safe fallbacks', async (t) => {
  const fake = await fakeForge(t);
  const store = new Store(':memory:');
  try {
    fake.output = { ...fake.output, answer: 'Invented clinical directions must never be displayed.' };
    const invalid = await runAgent(store, 'demo-001', 'What paperwork should I bring?');
    assert.equal(invalid.execution, 'local_fallback');
    assert.ok(!invalid.answer.includes('Invented clinical directions'));
    assert.ok(!JSON.stringify(store.all('trace')).includes('Invented clinical directions'));
    delete fake.output.answer;
    fake.output.sourceRefs = [{ documentId: 'doc-demo-002', sectionId: 's1' }];
    const foreign = await runAgent(store, 'demo-001', 'What paperwork should I bring?');
    assert.equal(foreign.execution, 'local_fallback');
    assert.ok(foreign.citations.every((c) => c.documentId === 'doc-demo-001'));
    fake.output.sourceRefs = [{ documentId: 'doc-demo-001', sectionId: 's2' }];
    fake.onTurn = () => store.completeTask('demo-001', 'demo-001-task-2', true);
    const changed = await runAgent(store, 'demo-001', 'Summarize my discharge instructions');
    assert.equal(changed.execution, 'local_fallback');
    assert.match(changed.notice, /plan changed/);
    assert.ok(changed.summary.sections.find((s) => s.id === 'completed').items.some((i) => i.id === 'demo-001-task-2'));
  } finally { store.close(); }
});
