import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { importedTask, confirmation } from './review-cases.js';

test('review/help audit, retry receipts, and revisions survive reopening SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'homeward-review-'));
  const path = join(directory, 'review.sqlite');
  let store;
  try {
    store = new Store(path);
    const task = importedTask(store);
    const input = confirmation(task);
    const review = store.reviewTask(task.patientId, task.id, input);
    const opened = store.requestHelp(task.patientId, task.id, true);
    const response = { requestId: randomUUID(), expectedRevision: opened.revision, helpRequestId: opened.helpRequestId, decision: 'resolve', response: 'Synthetic local response retained.' };
    const resolved = store.respondToHelp(task.patientId, task.id, response);
    store.close();
    store = new Store(path);
    assert.deepEqual(store.get('task', task.id), resolved.task);
    assert.deepEqual(store.reviewTask(task.patientId, task.id, input), { ...review, replayed: true });
    assert.deepEqual(store.respondToHelp(task.patientId, task.id, response), { ...resolved, replayed: true });
    assert.equal(store.taskHistory(task.patientId, task.id).history.length, 3);
    assert.throws(() => store.taskHistory('demo-002', task.id), { code: 'PATIENT_SCOPE' });
  } finally {
    store?.close();
    rmSync(directory, { recursive: true });
  }
});

test('legacy upgrade preserves local records and receipts but requires reapproval for unbound actions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'homeward-upgrade-'));
  const path = join(directory, 'legacy.sqlite');
  let store;
  try {
    store = new Store(path);
    const pid = 'demo-001';
    const task = importedTask(store);
    const legacyTask = { ...task, helpRequestedAt: '2026-09-19T12:00:00Z' };
    for (const field of ['revision', 'instructionRevision', 'instruction', 'dateEvidence', 'lastReviewId', 'helpRequestId', 'lastHelpAuditId']) delete legacyTask[field];
    store.put('task', legacyTask);
    const approved = store.proposeReminder(pid, `${pid}-task-1`);
    store.approve(pid, approved.id, true);
    const executed = store.proposeReminder(pid, `${pid}-task-3`);
    store.approve(pid, executed.id, true);
    const receipt = store.execute(pid, executed.id).receipt;
    for (const action of store.all('action')) {
      delete action.taskFingerprint;
      delete action.taskInstructionRevision;
      store.put('action', action);
    }
    const datedTask = store.get('task', `${pid}-task-1`);
    for (const field of ['revision', 'instructionRevision', 'instruction', 'dateEvidence', 'lastReviewId', 'helpRequestId', 'lastHelpAuditId']) delete datedTask[field];
    store.put('task', datedTask);
    store.close();
    store = new Store(path);
    const upgraded = store.get('task', task.id);
    assert.equal(upgraded.revision, 1);
    assert.equal(upgraded.helpRequestedAt, legacyTask.helpRequestedAt);
    assert.match(upgraded.helpRequestId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(upgraded.source, legacyTask.source);
    assert.equal(upgraded.status, legacyTask.status);
    assert.equal(store.get('task', datedTask.id).dateEvidence.kind, 'legacy');
    assert.equal(store.get('task', datedTask.id).due, datedTask.due);
    assert.equal(store.plan(pid).actions.find((a) => a.id === approved.id).stale, true);
    assert.throws(() => store.execute(pid, approved.id), { code: 'STALE_REMINDER' });
    const fresh = store.proposeReminder(pid, datedTask.id);
    assert.notEqual(fresh.id, approved.id);
    assert.equal(fresh.status, 'proposed');
    assert.equal(store.execute(pid, executed.id).receipt, receipt);
    assert.equal(store.all('task_audit').length, 0);
    const records = store.all('task');
    store.close();
    store = new Store(path);
    assert.deepEqual(store.all('task'), records);
    assert.equal(store.get('document', task.source.documentId).sections[0].text, task.source.quote);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true });
  }
});

test('task mutation, audit, trace, and command receipt roll back together on storage failure', () => {
  const store = new Store(':memory:');
  try {
    const task = importedTask(store);
    for (const kind of ['task_audit', 'trace', 'task_command']) {
      const input = confirmation(task);
      const traces = store.all('trace');
      store.db.exec(`CREATE TRIGGER reject_write BEFORE INSERT ON records WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;`);
      assert.throws(() => store.reviewTask(task.patientId, task.id, input), /test storage failure/);
      assert.deepEqual(store.get('task', task.id), task);
      assert.equal(store.all('task_audit').length, 0);
      assert.equal(store.all('task_command').length, 0);
      assert.deepEqual(store.all('trace'), traces);
      store.db.exec('DROP TRIGGER reject_write');
    }
    const opened = store.requestHelp(task.patientId, task.id, true);
    store.db.exec("CREATE TRIGGER reject_write BEFORE INSERT ON records WHEN NEW.kind='task_audit' BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;");
    assert.throws(() => store.respondToHelp(task.patientId, task.id, { requestId: randomUUID(), expectedRevision: opened.revision, helpRequestId: opened.helpRequestId, decision: 'resolve', response: 'Must roll back.' }), /test storage failure/);
    assert.deepEqual(store.get('task', task.id), opened);
    store.db.exec('DROP TRIGGER reject_write');
  } finally {
    store.close();
  }
});

test('separate SQLite connections cannot commit reviews from the same displayed revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'homeward-concurrent-'));
  let first, second;
  try {
    const path = join(directory, 'concurrent.sqlite');
    first = new Store(path);
    second = new Store(path);
    const task = importedTask(first);
    const original = confirmation(task);
    first.reviewTask(task.patientId, task.id, original);
    assert.throws(() => second.reviewTask(task.patientId, task.id, confirmation(task)), { code: 'REVISION_CONFLICT' });
    assert.equal(second.reviewTask(task.patientId, task.id, original).replayed, true);
    assert.equal(second.taskHistory(task.patientId, task.id).history.length, 1);
  } finally {
    first?.close();
    second?.close();
    rmSync(directory, { recursive: true });
  }
});

test('reminder fingerprints catch instruction/source/date changes and completion round trips', () => {
  const store = new Store(':memory:');
  try {
    const pid = 'demo-001', tid = `${pid}-task-1`;
    const original = store.get('task', tid);
    for (const change of [
      { detail: 'Changed synthetic instruction.' },
      { source: { ...original.source, quote: original.source.quote.slice(0, -1) } },
      { due: '2026-09-27' },
    ]) {
      store.put('task', original);
      const action = store.proposeReminder(pid, tid);
      if (action.status === 'proposed') store.approve(pid, action.id, true);
      store.put('task', { ...original, ...change });
      assert.throws(() => store.execute(pid, action.id), { code: 'STALE_REMINDER' });
    }
    store.put('task', original);
    const old = store.proposeReminder(pid, tid);
    store.completeTask(pid, tid, true);
    store.completeTask(pid, tid, false);
    assert.throws(() => store.execute(pid, old.id), { code: 'STALE_REMINDER' });
    const newer = store.proposeReminder(pid, tid);
    const task = store.get('task', tid);
    store.reviewTask(pid, tid, confirmation(task));
    assert.throws(() => store.approve(pid, newer.id, true), { code: 'STALE_REMINDER' });
    store.approve(pid, newer.id, false);
    assert.equal(store.get('action', newer.id).status, 'rejected');
  } finally {
    store.close();
  }
});

test('unsupported document trust and mutated source passages fail closed', () => {
  const store = new Store(':memory:');
  try {
    const task = importedTask(store);
    const doc = store.get('document', task.source.documentId);
    for (const change of [{ kind: 'unknown' }, { trustClass: 'synthetic_record' }, { trustClass: 'general_education' }]) {
      store.put('document', { ...doc, ...change });
      assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task)), { code: 'UNSUPPORTED_SOURCE' });
    }
    store.put('document', doc);
    store.reviewTask(task.patientId, task.id, confirmation(task, { due: '2026-09-26', dateEvidence: { kind: 'source', source: task.source } }));
    const action = store.proposeReminder(task.patientId, task.id);
    store.approve(task.patientId, action.id, true);
    store.put('document', { ...doc, sections: [{ ...doc.sections[0], text: 'A different synthetic source passage.' }] });
    assert.throws(() => store.execute(task.patientId, action.id), { code: 'STALE_REMINDER' });
    assert.equal(store.plan(task.patientId).actions[0].stale, true);
  } finally {
    store.close();
  }
});

test('help resolution resumes only an unchanged approved reminder and logs no response text', () => {
  const store = new Store(':memory:');
  try {
    const pid = 'demo-001', tid = `${pid}-task-1`;
    const action = store.proposeReminder(pid, tid);
    store.approve(pid, action.id, true);
    const opened = store.requestHelp(pid, tid, true);
    assert.throws(() => store.execute(pid, action.id), { code: 'STALE_REMINDER' });
    const response = 'Synthetic local response: the question is resolved without changing instructions.';
    store.respondToHelp(pid, tid, {
      requestId: randomUUID(), expectedRevision: opened.revision,
      helpRequestId: opened.helpRequestId, decision: 'resolve', response,
    });
    assert.equal(store.execute(pid, action.id).status, 'executed');
    assert.ok(!JSON.stringify(store.all('trace')).includes(response));
    const again = store.requestHelp(pid, tid, true);
    store.requestHelp(pid, tid, false);
    const latest = store.taskHistory(pid, tid).history.at(-1);
    assert.equal(latest.event, 'help_withdrawn');
    assert.equal(latest.helpRequestId, again.helpRequestId);
    assert.equal(latest.actor.kind, 'local_demo_patient');
    assert.equal(latest.response, null);
  } finally {
    store.close();
  }
});

test('source date formats are explicit and relative dates require human clarification', () => {
  const store = new Store(':memory:');
  try {
    for (const display of ['2026-09-26', 'Sep 26, 2026', 'September 26, 2026']) {
      const task = importedTask(store, 'demo-001', `Discuss the fictional discharge summary on ${display}.`);
      const reviewed = store.reviewTask(task.patientId, task.id, confirmation(task, {
        due: '2026-09-26', dateEvidence: { kind: 'source', source: task.source },
      }));
      assert.equal(reviewed.task.due, '2026-09-26');
    }
    const relative = importedTask(store, 'demo-001', 'Contact the fictional discharge team within seven days.');
    assert.throws(() => store.reviewTask(relative.patientId, relative.id, confirmation(relative, {
      due: '2026-09-26', dateEvidence: { kind: 'source', source: relative.source },
    })), { code: 'UNSUPPORTED_DATE' });
    const completed = store.completeTask('demo-001', 'demo-001-task-2', true);
    assert.throws(() => store.reviewTask(completed.patientId, completed.id, confirmation(completed)), { code: 'STATE_CONFLICT' });
  } finally {
    store.close();
  }
});
