import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';

test('help requests preserve review gates and block stale reminder execution', () => {
  const store = new Store(':memory:');
  try {
    const pid = 'demo-001',
      tid = `${pid}-task-1`;
    const action = store.proposeReminder(pid, tid);
    store.approve(pid, action.id, true);
    store.requestHelp(pid, tid, true);
    assert.ok(store.plan(pid).tasks.find((t) => t.id === tid).helpRequestedAt);
    assert.throws(() => store.completeTask(pid, tid, true));
    assert.throws(() => store.proposeReminder(pid, tid));
    assert.throws(() => store.execute(pid, action.id));
    assert.throws(() => store.requestHelp('demo-002', tid, false));
    store.requestHelp(pid, tid, false);
    assert.equal(store.execute(pid, action.id).status, 'executed');
    const review = `${pid}-task-4`;
    store.requestHelp(pid, review, true);
    store.requestHelp(pid, review, false);
    assert.throws(() => store.completeTask(pid, review, true));
    assert.equal(store.get('task', review).status, 'needs_clarification');
  } finally {
    store.close();
  }
});

test('Synthea snapshot is isolated, traceable, historical, and cannot schedule unverified directions', () => {
  const store = new Store(':memory:');
  try {
    const patient = store.all('patient').find((p) => p.id.startsWith('synthea-'));
    const plan = store.plan(patient.id);
    const doc = plan.documents[0];
    assert.equal(doc.kind, 'synthea');
    assert.match(doc.provenance.archiveSha256, /^[a-f0-9]{64}$/);
    for (const s of doc.sections) {
      assert.ok(s.provenance.row >= 2);
      assert.equal(s.provenance.sourcePatientId, patient.id.slice(8));
      if (s.id !== 's1') {
        const fields = s.provenance.fields;
        assert.ok(fields.START.slice(0, 10) <= patient.dischargedAt);
        assert.ok(!fields.STOP || fields.STOP.slice(0, 10) > patient.dischargedAt);
      }
    }
    assert.throws(() => store.proposeReminder(patient.id, plan.tasks[0].id));
    assert.throws(() => store.completeTask(patient.id, plan.tasks[0].id, true));
    store.requestHelp(patient.id, plan.tasks[0].id, true);
    store.seedSynthea();
    assert.ok(store.plan(patient.id).tasks[0].helpRequestedAt);
    assert.equal(store.plan('demo-001').documents.length, 1);
    store.reset();
    assert.equal(store.plan(patient.id).tasks[0].helpRequestedAt, undefined);
  } finally {
    store.close();
  }
});
