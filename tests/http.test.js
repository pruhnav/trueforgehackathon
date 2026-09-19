import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

test('HTTP API and real MCP client exercise the approval boundary', async () => {
  const store = new Store(':memory:');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: 'homeward-integration-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 7);
    assert.ok(
      !tools.tools.some((t) => /approv/.test(t.name) && t.name !== 'execute_approved_reminder'),
    );
    const result = await client.callTool({ name: 'get_discharge_plan', arguments: {} });
    const plan = JSON.parse(result.content[0].text);
    assert.equal(plan.patient.id, 'demo-001');
    const foreign = await client.callTool({
      name: 'propose_reminder',
      arguments: { taskId: 'demo-002-task-1' },
    });
    assert.equal(foreign.isError, true);
    const proposal = await client.callTool({
      name: 'propose_reminder',
      arguments: { taskId: 'demo-001-task-1' },
    });
    const action = JSON.parse(proposal.content[0].text);
    const blocked = await client.callTool({
      name: 'execute_approved_reminder',
      arguments: { actionId: action.id },
    });
    assert.equal(blocked.isError, true);
    const approve = await fetch(`${base}/api/patients/demo-001/actions/${action.id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve: true }),
    });
    assert.equal(approve.status, 200);
    const executed = await client.callTool({
      name: 'execute_approved_reminder',
      arguments: { actionId: action.id },
    });
    assert.equal(JSON.parse(executed.content[0].text).status, 'executed');
    const calendar = await fetch(`${base}/api/patients/demo-001/actions/${action.id}/calendar`);
    const ics = await calendar.text();
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /DTSTART;VALUE=DATE:20260926/);
    assert.match(ics, /DTEND;VALUE=DATE:20260927/);
    const origin = await fetch(`${base}/api/demo/reset`, {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example' },
    });
    assert.equal(origin.status, 403);
    const invalid = await fetch(`${base}/api/patients/demo-001/tasks/demo-001-task-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complete: 'yes' }),
    });
    assert.equal(invalid.status, 400);
    const unknown = await fetch(`${base}/api/patients/missing/plan`);
    assert.equal(unknown.status, 404);
    // A minimal valid text PDF exercises the actual parser and import endpoint.
    const stream =
      'BT /F1 12 Tf 40 200 Td (Bring your discharge summary to the follow-up visit.) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, i) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const imported = await fetch(`${base}/api/patients/demo-001/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'PDF test', pdf: Buffer.from(pdf).toString('base64') }),
    });
    assert.equal(imported.status, 201);
    assert.match(JSON.stringify(await imported.json()), /Bring your discharge summary/);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
