import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function importedTask(store, patientId = 'demo-001', quote = 'Contact the fictional discharge team by September 26, 2026 to discuss your paperwork.') {
  const document = store.importDocument(patientId, 'Fictional discharge review test', quote);
  return store.proposeTask(patientId, { documentId: document.id, sectionId: 's1', quote });
}
export function confirmation(task, extra = {}) {
  return {
    requestId: randomUUID(), expectedRevision: task.revision, decision: 'confirm',
    note: 'Local demo review of the synthetic instruction.', due: null, dateEvidence: null,
    ...extra,
  };
}
const dated = (task) => confirmation(task, {
  due: '2026-09-26', dateEvidence: { kind: 'source', source: task.source },
});

// Shared by node:test and npm run eval; no live model or external services involved.
export const reviewCases = [
  ['Review activates an exact instruction with an evidenced date and separate reminder approval', (store) => {
    const original = importedTask(store);
    const result = store.reviewTask(original.patientId, original.id, dated(original));
    assert.equal(result.task.status, 'pending');
    assert.equal(result.task.due, '2026-09-26');
    assert.equal(result.task.revision, 2);
    assert.equal(result.task.instructionRevision, 2);
    assert.deepEqual(result.task.source, original.source);
    assert.equal(result.task.detail, original.detail);
    assert.deepEqual(result.task.instruction, original.source);
    assert.deepEqual(result.audit.previous, original);
    assert.deepEqual(result.audit.resulting, result.task);
    assert.deepEqual(result.audit.actor, { kind: 'local_demo_operator', authenticated: false });
    assert.equal(result.audit.sourceReferences.length, 1);
    const action = store.proposeReminder(original.patientId, original.id);
    assert.equal(action.status, 'proposed');
    assert.throws(() => store.execute(original.patientId, action.id), { status: 403 });
    store.approve(original.patientId, action.id, true);
    assert.equal(store.execute(original.patientId, action.id).status, 'executed');
  }],
  ['Review with no deadline leaves due null and prevents reminders', (store) => {
    const task = importedTask(store, 'demo-001', 'Bring the fictional discharge summary to your next conversation.');
    const result = store.reviewTask(task.patientId, task.id, confirmation(task));
    assert.equal(result.task.due, null);
    assert.equal(result.task.dateEvidence, null);
    assert.throws(() => store.proposeReminder(task.patientId, task.id));
    assert.equal(store.completeTask(task.patientId, task.id, true).status, 'completed');
  }],
  ['Clarify and reject preserve sources and cannot be bypassed by completion or a duplicate proposal', (store) => {
    const task = importedTask(store);
    const clarified = store.reviewTask(task.patientId, task.id, {
      requestId: randomUUID(), expectedRevision: 1, decision: 'clarify', note: 'Keep awaiting clarification.',
    });
    assert.equal(clarified.task.status, 'needs_clarification');
    const rejected = store.reviewTask(task.patientId, task.id, {
      requestId: randomUUID(), expectedRevision: 2, decision: 'reject', note: 'Background only.',
    });
    assert.equal(rejected.task.status, 'rejected');
    assert.equal(rejected.task.due, null);
    assert.deepEqual(rejected.task.source, task.source);
    assert.equal(rejected.task.detail, task.detail);
    assert.throws(() => store.completeTask(task.patientId, task.id, true));
    assert.throws(() => store.completeTask(task.patientId, task.id, false));
    assert.throws(() => store.proposeReminder(task.patientId, task.id));
    assert.throws(() => store.requestHelp(task.patientId, task.id, true));
    assert.equal(store.proposeTask(task.patientId, task.source).status, 'rejected');
    assert.equal(store.taskHistory(task.patientId, task.id).history.length, 2);
    assert.equal(store.reviewTask(task.patientId, task.id, confirmation(rejected.task)).task.status, 'pending');
  }],
  ['Synthea history requires a separate exact instruction; a review note cannot authorize it', (store) => {
    const patient = store.all('patient').find((p) => p.id.startsWith('synthea-'));
    const task = store.plan(patient.id).tasks[0];
    assert.throws(() => store.reviewTask(patient.id, task.id, confirmation(task)), { code: 'UNSUPPORTED_SOURCE' });
    assert.throws(() => store.reviewTask(patient.id, task.id, confirmation(task, {
      due: '2026-09-26', dateEvidence: { kind: 'human_clarification', explanation: 'A date alone does not supply instructions.' },
    })), { code: 'UNSUPPORTED_SOURCE' });
    const instruction = importedTask(store, patient.id, 'Bring your fictional historical record to the care-team review.');
    const reviewed = store.reviewTask(patient.id, task.id, confirmation(task, { instructionSource: instruction.source }));
    assert.deepEqual(reviewed.task.source, task.source);
    assert.equal(reviewed.task.detail, task.detail);
    assert.deepEqual(reviewed.task.instruction, instruction.source);
    assert.equal(reviewed.task.due, null);
    assert.equal(reviewed.audit.sourceReferences.length, 2);
    assert.equal(reviewed.task.clinicianApprovedVersion, undefined);
  }],
  ['Invalid calendar dates and unsupported date evidence never mutate the task', (store) => {
    const task = importedTask(store);
    for (const due of ['2026-02-30', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01', '2026-09-26T00:00:00Z', '09/26/2026']) {
      assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, {
        due, dateEvidence: { kind: 'human_clarification', explanation: 'Synthetic date test.' },
      })), { code: 'INVALID_DATE' }, due);
    }
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, { due: '2026-09-26' })), { code: 'DATE_EVIDENCE_REQUIRED' });
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, { dateEvidence: { kind: 'source', source: task.source } })), { code: 'DATE_EVIDENCE_REQUIRED' });
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, {
      due: '2026-09-27', dateEvidence: { kind: 'source', source: task.source },
    })), { code: 'UNSUPPORTED_DATE' });
    assert.deepEqual(store.get('task', task.id), task);
    assert.equal(store.taskHistory(task.patientId, task.id).history.length, 0);
    const clarified = store.reviewTask(task.patientId, task.id, confirmation(task, {
      due: '2028-02-29', dateEvidence: { kind: 'human_clarification', explanation: 'Fictional team supplied this leap-day deadline.' },
    }));
    assert.equal(clarified.task.due, '2028-02-29');
    assert.equal(clarified.task.dateEvidence.kind, 'human_clarification');
    assert.deepEqual(clarified.task.source, task.source);
  }],
  ['Review commands reject foreign tasks, foreign evidence, fabricated quotes, and reviewer impersonation', (store) => {
    const task = importedTask(store);
    const foreign = importedTask(store, 'demo-002');
    assert.throws(() => store.reviewTask('demo-002', task.id, confirmation(task)), { code: 'PATIENT_SCOPE' });
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, { instructionSource: foreign.source })), { code: 'PATIENT_SCOPE' });
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, {
      due: '2026-09-26', dateEvidence: { kind: 'source', source: foreign.source },
    })), { code: 'PATIENT_SCOPE' });
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, {
      instructionSource: { ...task.source, quote: 'An invented patient instruction that is not in the source.' },
    })), { code: 'INVALID_SOURCE' });
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task, { reviewer: 'Authenticated clinician' })));
    assert.equal(store.get('task', task.id).revision, 1);
  }],
  ['Review retries replay one receipt; stale revisions and reused keys cannot overwrite newer decisions', (store) => {
    const task = importedTask(store);
    const input = confirmation(task);
    const first = store.reviewTask(task.patientId, task.id, input);
    const retry = store.reviewTask(task.patientId, task.id, JSON.parse(JSON.stringify(input)));
    assert.deepEqual(retry, { ...first, replayed: true });
    assert.equal(store.taskHistory(task.patientId, task.id).history.length, 1);
    assert.throws(() => store.reviewTask(task.patientId, task.id, { ...input, note: 'Changed payload.' }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task)), { code: 'REVISION_CONFLICT', details: { currentRevision: 2 } });
    const rejected = store.reviewTask(task.patientId, task.id, {
      requestId: randomUUID(), expectedRevision: 2, decision: 'reject', note: 'Later human decision.',
    });
    assert.deepEqual(store.reviewTask(task.patientId, task.id, input), { ...first, replayed: true });
    assert.deepEqual(store.get('task', task.id), rejected.task);
    assert.equal(store.taskHistory(task.patientId, task.id).history.length, 2);
  }],
  ['A new reviewed instruction invalidates old reminders even when status and date are unchanged', (store) => {
    const task = importedTask(store);
    const initial = store.reviewTask(task.patientId, task.id, dated(task)).task;
    const old = store.proposeReminder(task.patientId, task.id);
    store.approve(task.patientId, old.id, true);
    const separate = importedTask(store, task.patientId, 'Bring your fictional paperwork to the team on September 26, 2026.');
    store.reviewTask(task.patientId, task.id, confirmation(initial, {
      instructionSource: separate.source, due: '2026-09-26', dateEvidence: { kind: 'source', source: separate.source },
    }));
    assert.throws(() => store.execute(task.patientId, old.id), { code: 'STALE_REMINDER' });
    assert.equal(store.plan(task.patientId).actions.find((a) => a.id === old.id).stale, true);
    const fresh = store.proposeReminder(task.patientId, task.id);
    assert.notEqual(fresh.id, old.id);
    assert.equal(fresh.status, 'proposed');
    assert.throws(() => store.execute(task.patientId, fresh.id), { status: 403 });
    store.approve(task.patientId, fresh.id, true);
    assert.throws(() => store.execute(task.patientId, fresh.id, true), { status: 504 });
    const saved = store.get('action', fresh.id);
    store.completeTask(task.patientId, task.id, true);
    assert.deepEqual(store.execute(task.patientId, fresh.id), saved);
    assert.equal(store.all('trace').filter((t) => t.event === 'reminder.created').length, 1);
  }],
  ['Responding to and resolving help never approves an unverified task', (store) => {
    const task = importedTask(store);
    const opened = store.requestHelp(task.patientId, task.id, true);
    assert.deepEqual(store.requestHelp(task.patientId, task.id, true), opened);
    assert.equal(store.taskHistory(task.patientId, task.id).history.length, 1);
    assert.throws(() => store.reviewTask(task.patientId, task.id, confirmation(task)), { code: 'REVISION_CONFLICT' });
    const responded = store.respondToHelp(task.patientId, task.id, {
      requestId: randomUUID(), expectedRevision: opened.revision, helpRequestId: opened.helpRequestId,
      decision: 'respond', response: 'Your synthetic question is recorded for local review.',
    });
    assert.equal(responded.task.helpRequestedAt, opened.helpRequestedAt);
    const input = {
      requestId: randomUUID(), expectedRevision: responded.task.revision,
      helpRequestId: opened.helpRequestId, decision: 'resolve', response: 'Local help conversation completed; instruction still needs clarification.',
    };
    const resolved = store.respondToHelp(task.patientId, task.id, input);
    assert.deepEqual(store.respondToHelp(task.patientId, task.id, input), { ...resolved, replayed: true });
    assert.equal(resolved.task.status, 'needs_clarification');
    assert.equal(resolved.task.due, null);
    assert.equal(resolved.task.helpRequestedAt, null);
    assert.equal(resolved.task.helpRequestId, null);
    assert.equal(resolved.task.instructionRevision, task.instructionRevision);
    assert.throws(() => store.completeTask(task.patientId, task.id, true));
    assert.throws(() => store.proposeReminder(task.patientId, task.id));
    const reopened = store.requestHelp(task.patientId, task.id, true);
    assert.notEqual(reopened.helpRequestId, opened.helpRequestId);
    assert.throws(() => store.respondToHelp(task.patientId, task.id, { ...input, requestId: randomUUID(), expectedRevision: reopened.revision }), { code: 'STATE_CONFLICT' });
    const history = store.taskHistory(task.patientId, task.id).history;
    assert.deepEqual(history.map((h) => h.event), ['help_requested', 'help_response', 'help_resolved', 'help_requested']);
  }],
];
