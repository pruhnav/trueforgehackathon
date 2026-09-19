import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { confirmation, importedTask } from './review-cases.js';

async function backend(t) {
  const store = new Store(':memory:');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const result = await fetch(`${base}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, data: await result.json() };
  };
  return { store, base, request };
}

test('HTTP import -> proposal -> evidenced review -> separately approved date-only calendar', async (t) => {
  const { base, request } = await backend(t);
  const patient = '/patients/demo-001';
  const quote = 'Discuss the fictional discharge paperwork with the team on February 29, 2028.';
  const imported = await request(`${patient}/documents`, { title: 'Fictional leap-day instruction', text: quote });
  assert.equal(imported.status, 201);
  const source = { documentId: imported.data.id, sectionId: 's1', quote };
  const proposed = await request(`${patient}/tasks/review`, source);
  assert.equal(proposed.status, 200);
  assert.equal(proposed.data.status, 'needs_clarification');
  assert.equal(proposed.data.due, null);
  assert.equal(proposed.data.revision, 1);
  const taskPath = `${patient}/tasks/${proposed.data.id}`;
  const input = confirmation(proposed.data, { due: '2028-02-29', dateEvidence: { kind: 'source', source } });
  const reviewed = await request(`${taskPath}/reviews`, input);
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.task.status, 'pending');
  assert.equal(reviewed.data.task.due, '2028-02-29');
  assert.deepEqual(reviewed.data.task.source, source);
  assert.equal(reviewed.data.audit.actor.authenticated, false);
  assert.equal(reviewed.data.replayed, false);
  const duplicate = await request(`${taskPath}/reviews`, input);
  assert.deepEqual(duplicate.data, { ...reviewed.data, replayed: true });
  assert.equal(duplicate.status, 200);
  const history = await request(`${taskPath}/history`);
  assert.equal(history.status, 200);
  assert.equal(history.data.history.length, 1);
  assert.equal(history.data.history[0].requestId, input.requestId);
  const reminder = await request(`${patient}/reminders`, { taskId: proposed.data.id });
  assert.equal(reminder.status, 200);
  assert.equal(reminder.data.status, 'proposed');
  const actionPath = `${patient}/actions/${reminder.data.id}`;
  assert.equal((await request(`${actionPath}/execute`, {})).status, 403);
  assert.equal((await request(`${actionPath}/approval`, { approve: true })).status, 200);
  assert.equal((await request(`${actionPath}/execute`, { simulateTimeout: true })).status, 504);
  const executed = await request(`${actionPath}/execute`, {});
  assert.equal(executed.status, 200);
  const calendar = await fetch(`${base}/api${actionPath}/calendar`);
  assert.equal(calendar.status, 200);
  const ics = await calendar.text();
  assert.match(ics, /DTSTART;VALUE=DATE:20280229\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20280301\r\n/);
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = timezone;
      const text = await (await fetch(`${base}/api${actionPath}/calendar`)).text();
      assert.match(text, /DTSTART;VALUE=DATE:20280229\r\n/);
      assert.match(text, /DTEND;VALUE=DATE:20280301\r\n/);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
  const current = (await request(`${taskPath}/history`)).data.task;
  await request(`${taskPath}/reviews`, { requestId: randomUUID(), expectedRevision: current.revision, decision: 'reject', note: 'Later synthetic review decision.' });
  const retried = await request(`${actionPath}/execute`, {});
  assert.equal(retried.data.receipt, executed.data.receipt);
  assert.equal((await request(taskPath, { complete: true }, 'PATCH')).status, 400);
  assert.equal((await request(`${patient}/tasks/review`, source)).data.status, 'rejected');
});

test('HTTP review validation provides explicit errors without changing task state', async (t) => {
  const { store, request, base } = await backend(t);
  const task = importedTask(store);
  const route = `/patients/${task.patientId}/tasks/${task.id}/reviews`;
  const input = confirmation(task);
  const foreign = importedTask(store, 'demo-002');
  const cases = [
    [{ ...input, requestId: 'not-a-uuid' }, 400, 'INVALID_REQUEST'],
    [{ ...input, expectedRevision: 0 }, 400, 'INVALID_REQUEST'],
    [{ ...input, decision: 'approve' }, 400, 'INVALID_REQUEST'],
    [{ ...input, note: '   ' }, 400, 'INVALID_REQUEST'],
    [{ ...input, reviewer: 'Dr. Fictional' }, 400, 'INVALID_REQUEST'],
    [{ ...input, status: 'pending' }, 400, 'INVALID_REQUEST'],
    [{ ...input, decision: 'clarify' }, 400, 'INVALID_REQUEST'],
    [{ ...input, due: '2026-02-30', dateEvidence: { kind: 'human_clarification', explanation: 'Synthetic date.' } }, 422, 'INVALID_DATE'],
    [{ ...input, due: '2026-09-26' }, 422, 'DATE_EVIDENCE_REQUIRED'],
    [{ ...input, due: '2026-09-27', dateEvidence: { kind: 'source', source: task.source } }, 422, 'UNSUPPORTED_DATE'],
    [{ ...input, due: '2026-09-26', dateEvidence: { kind: 'human_clarification', explanation: '' } }, 400, 'INVALID_REQUEST'],
    [{ ...input, instructionSource: foreign.source }, 403, 'PATIENT_SCOPE'],
    [{ ...input, instructionSource: { ...task.source, quote: 'This quote was not present in the imported source.' } }, 422, 'INVALID_SOURCE'],
  ];
  for (const [body, status, code] of cases) {
    const result = await request(route, body);
    assert.equal(result.status, status, JSON.stringify(body));
    assert.equal(result.data.code, code);
    assert.equal(typeof result.data.error, 'string');
  }
  assert.equal((await request(`/patients/demo-002/tasks/${task.id}/reviews`, input)).data.code, 'PATIENT_SCOPE');
  assert.equal((await request(`/patients/missing/tasks/${task.id}/reviews`, input)).data.code, 'PATIENT_NOT_FOUND');
  assert.equal((await request(`/patients/demo-002/tasks/${task.id}/history`)).status, 403);
  const blocked = await fetch(`${base}/api${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify(input),
  });
  assert.equal(blocked.status, 403);
  assert.deepEqual(store.get('task', task.id), task);
  assert.equal(store.taskHistory(task.patientId, task.id).history.length, 0);
  const historical = store.all('patient').find((p) => p.id.startsWith('synthea-'));
  const historyTask = store.plan(historical.id).tasks[0];
  assert.equal((await request(`/patients/${historical.id}/tasks/${historyTask.id}/reviews`, confirmation(historyTask))).data.code, 'UNSUPPORTED_SOURCE');
});

test('concurrent HTTP decisions require reload and changed instructions require new reminder approval', async (t) => {
  const { store, request } = await backend(t);
  const task = importedTask(store);
  const patient = `/patients/${task.patientId}`;
  const route = `${patient}/tasks/${task.id}/reviews`;
  const inputs = [confirmation(task), confirmation(task)];
  const results = await Promise.all(inputs.map((body) => request(route, body)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const winner = results.findIndex((r) => r.status === 200);
  const loser = results[1 - winner];
  assert.equal(loser.data.code, 'REVISION_CONFLICT');
  assert.equal(loser.data.currentRevision, 2);
  assert.equal((await request(route, inputs[winner])).data.replayed, true);
  assert.equal((await request(route, { ...inputs[winner], note: 'Different retry payload.' })).data.code, 'IDEMPOTENCY_CONFLICT');
  const dated = await request(route, confirmation(results[winner].data.task, { due: '2026-09-26', dateEvidence: { kind: 'source', source: task.source } }));
  const old = await request(`${patient}/reminders`, { taskId: task.id });
  assert.equal((await request(`${patient}/actions/${old.data.id}/approval`, { approve: true })).status, 200);
  const newInstruction = importedTask(store, task.patientId, 'Prepare the fictional record for a discussion on September 26, 2026.');
  const changed = await request(route, confirmation(dated.data.task, {
    instructionSource: newInstruction.source, due: '2026-09-26', dateEvidence: { kind: 'source', source: newInstruction.source },
  }));
  assert.equal(changed.status, 200);
  assert.equal((await request(`${patient}/actions/${old.data.id}/execute`, {})).data.code, 'STALE_REMINDER');
  const plan = await request(`${patient}/plan`);
  assert.equal(plan.data.actions.find((a) => a.id === old.data.id).stale, true);
  const fresh = await request(`${patient}/reminders`, { taskId: task.id });
  assert.notEqual(fresh.data.id, old.data.id);
  assert.equal(fresh.data.status, 'proposed');
  assert.equal((await request(`${patient}/actions/${fresh.data.id}/execute`, {})).status, 403);
});

test('HTTP help response/resolution retain history and review gates; MCP exposes neither operation', async (t) => {
  const { store, request, base } = await backend(t);
  const task = importedTask(store);
  const taskPath = `/patients/${task.patientId}/tasks/${task.id}`;
  const opened = await request(`${taskPath}/help`, { requested: true });
  assert.equal(opened.status, 200);
  const body = {
    requestId: randomUUID(), expectedRevision: opened.data.revision, helpRequestId: opened.data.helpRequestId,
    decision: 'respond', response: 'The fictional local care team has recorded the question.',
  };
  const responded = await request(`${taskPath}/help/responses`, body);
  assert.equal(responded.status, 200);
  assert.equal(responded.data.task.helpRequestedAt, opened.data.helpRequestedAt);
  assert.equal((await request(`${taskPath}/help/responses`, { ...body, requestId: randomUUID() })).data.code, 'REVISION_CONFLICT');
  const resolve = { ...body, requestId: randomUUID(), expectedRevision: responded.data.task.revision, decision: 'resolve', response: 'The conversation ended; the instruction still requires review.' };
  const resolved = await request(`${taskPath}/help/responses`, resolve);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.task.status, 'needs_clarification');
  assert.equal(resolved.data.task.due, null);
  assert.equal(resolved.data.task.helpRequestedAt, null);
  assert.equal((await request(`${taskPath}/help/responses`, resolve)).data.replayed, true);
  assert.equal((await request(taskPath, { complete: true }, 'PATCH')).status, 400);
  assert.equal((await request(`/patients/${task.patientId}/reminders`, { taskId: task.id })).status, 400);
  const history = await request(`${taskPath}/history`);
  assert.deepEqual(history.data.history.map((h) => h.event), ['help_requested', 'help_response', 'help_resolved']);
  assert.equal(history.data.history[2].response, resolve.response);
  assert.equal(history.data.history[2].actor.authenticated, false);
  const confirmed = await request(`${taskPath}/reviews`, confirmation(resolved.data.task));
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.task.due, null);
  assert.equal((await request(`/patients/${task.patientId}/reminders`, { taskId: task.id })).status, 400);
  const client = new Client({ name: 'review-boundary-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/demo-001`)));
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(tools, [
      'execute_approved_reminder', 'get_discharge_plan', 'lookup_patient_education',
      'propose_cited_task', 'propose_reminder', 'search_discharge_instructions',
    ]);
  } finally {
    await client.close();
  }
});
