import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sourceSearch } from '../server/trueforge.js';
import { isNextStepQuestion } from '../server/guidance.js';
import { importedTask, confirmation } from './review-cases.js';

const question = 'What is my next step?';
function reject(store, task) {
  return store.reviewTask(task.patientId, task.id, {
    requestId: randomUUID(),
    expectedRevision: task.revision,
    decision: 'reject',
    note: 'Synthetic test review: retain this item in history only.',
  });
}

export const guidanceCases = [
  ['Next-step chat and plan agree for every seeded patient without clinical mutations', (store) => {
    const before = ['task', 'action', 'task_audit', 'document'].map((kind) => store.all(kind));
    for (const [pid, taskId, dateState] of [
      ['demo-001', 'demo-001-task-3', 'upcoming'],
      ['demo-002', 'demo-002-task-1', 'overdue'],
      ['demo-003', 'demo-003-task-1', 'upcoming'],
    ]) {
      const result = sourceSearch(store, pid, question);
      const plan = store.plan(pid);
      assert.equal(result.answerType, 'plan_guidance');
      assert.equal(result.mode, 'source-search');
      assert.equal(result.metrics, null);
      assert.equal(result.sessionId, undefined);
      assert.deepEqual(result.guidance, plan.guidance);
      assert.equal(result.guidance.nextTask.taskId, taskId);
      assert.equal(result.guidance.nextTask.dateState, dateState);
      const task = plan.tasks.find((t) => t.id === taskId);
      assert.equal(result.citations[0].quote, task.instruction.quote);
      assert.ok(result.answer.includes(task.instruction.quote));
      assert.equal(result.guidance.nextTask.dateLabel, 'Existing plan date; review evidence not captured');
      assert.match(result.answer, /not by medical urgency/);
      assert.ok(result.citations.every((c) => c.documentId === `doc-${pid}`));
    }
    const synthea = store.all('patient').find((p) => p.id.startsWith('synthea-'));
    const historical = sourceSearch(store, synthea.id, question);
    assert.equal(historical.guidance.outcome, 'needs_attention');
    assert.equal(historical.guidance.nextTask, null);
    assert.match(historical.answer, /Historical context only/);
    assert.deepEqual(['task', 'action', 'task_audit', 'document'].map((kind) => store.all(kind)), before);
  }],
  ['Guidance distinguishes undated, paused, clarification, completed, and rejected tasks', (store) => {
    const pid = 'demo-001';
    store.completeTask(pid, `${pid}-task-3`, true);
    assert.equal(store.plan(pid).guidance.nextTask.taskId, `${pid}-task-1`);
    store.requestHelp(pid, `${pid}-task-1`, true);
    let guidance = store.plan(pid).guidance;
    assert.equal(guidance.outcome, 'undated_tasks');
    assert.equal(guidance.nextTask, null);
    assert.deepEqual(guidance.undatedTasks.map((t) => [t.taskId, t.due]), [[`${pid}-task-2`, null]]);
    assert.ok(guidance.blockedTasks.find((t) => t.taskId === `${pid}-task-1`).reasons.includes('help_requested'));
    assert.ok(guidance.blockedTasks.find((t) => t.taskId === `${pid}-task-4`).reasons.includes('needs_clarification'));
    assert.equal(guidance.counts.completed, 1);
    store.requestHelp(pid, `${pid}-task-1`, false);
    reject(store, store.get('task', `${pid}-task-1`));
    store.completeTask(pid, `${pid}-task-2`, true);
    assert.equal(store.plan(pid).guidance.outcome, 'needs_attention');
    reject(store, store.get('task', `${pid}-task-4`));
    guidance = store.plan(pid).guidance;
    assert.equal(guidance.outcome, 'no_open_tasks');
    assert.deepEqual(guidance.counts, { completed: 2, rejected: 2 });
    assert.match(sourceSearch(store, pid, question).answer, /not medical recovery/);
  }],
  ['Guidance uses reviewed instructions and labels human dates without rewriting exact quotes', (store) => {
    const task = importedTask(store);
    const instruction = importedTask(store, task.patientId, 'Bring the **fictional** paperwork — keep the A–B label and `code` as written.');
    const reviewed = store.reviewTask(task.patientId, task.id, confirmation(task, {
      instructionSource: instruction.source,
      due: '2026-09-20',
      dateEvidence: { kind: 'human_clarification', explanation: 'The fictional team provided September 20 during review.' },
    }));
    let result = sourceSearch(store, task.patientId, question);
    assert.equal(result.guidance.nextTask.taskId, task.id);
    assert.equal(result.guidance.nextTask.revision, reviewed.task.revision);
    assert.equal(result.citations[0].documentId, instruction.source.documentId);
    assert.equal(result.citations[0].quote, instruction.source.quote);
    assert.ok(result.answer.includes(instruction.source.quote));
    assert.match(result.answer, /human clarification, not the original passage/);
    assert.deepEqual(store.get('task', task.id).source, task.source);
    const date = importedTask(store, task.patientId, 'The fictional paperwork discussion deadline is September 20, 2026.');
    store.reviewTask(task.patientId, task.id, confirmation(reviewed.task, {
      due: '2026-09-20', dateEvidence: { kind: 'source', source: date.source },
    }));
    result = sourceSearch(store, task.patientId, question);
    assert.equal(result.citations.length, 2);
    assert.equal(result.citations[1].quote, date.source.quote);
    assert.equal(result.guidance.nextTask.dateSource.documentId, date.source.documentId);
    assert.equal(result.guidance.nextTask.dateEvidence.kind, 'source');
  }],
  ['Guidance fails closed on invalid citations, historical instructions, and invalid dates', (store) => {
    const pid = 'demo-001';
    const original = store.get('task', `${pid}-task-3`);
    const foreign = store.get('task', 'demo-002-task-1').source;
    for (const change of [
      { instruction: { ...original.source, quote: 'Fabricated patient-specific instruction.' } },
      { instruction: foreign },
      { source: foreign },
      { due: '2026-02-30' },
      { due: '2026-09-21T00:00:00Z' },
      { dateEvidence: { kind: 'source', source: foreign } },
      { dateEvidence: { kind: 'human_clarification', explanation: '' } },
    ]) {
      store.put('task', { ...original, ...change });
      const result = sourceSearch(store, pid, question);
      assert.equal(result.guidance.nextTask.taskId, `${pid}-task-1`);
      assert.ok(result.guidance.blockedTasks.some((t) => t.taskId === original.id));
      assert.ok(result.citations.every((c) => c.documentId === `doc-${pid}`));
      assert.ok(!result.answer.includes('Fabricated patient-specific instruction.'));
    }
    const patient = store.all('patient').find((p) => p.id.startsWith('synthea-'));
    const historical = store.plan(patient.id).tasks[0];
    // Defend against legacy/corrupt pending history as well as normal clarification states.
    store.put('task', { ...historical, status: 'pending', due: '2026-09-20' });
    const guidance = store.plan(patient.id).guidance;
    assert.equal(guidance.nextTask, null);
    assert.equal(guidance.outcome, 'needs_attention');
    assert.ok(guidance.blockedTasks[0].reasons.includes('historical_or_unsupported_source'));
    assert.throws(() => sourceSearch(store, 'missing', question), { status: 404 });
  }],
  ['Next-step recognition is bounded and specific source search preserves punctuation', (store) => {
    for (const text of [question, ' WHAT IS MY NEXT STEP ? ', 'What’s my next step?', 'What should I do next?', 'What are my next steps?']) {
      assert.equal(isNextStepQuestion(text), true, text);
      assert.equal(sourceSearch(store, 'demo-001', text).guidance.nextTask.taskId, 'demo-001-task-3');
    }
    for (const text of ['What is my next dose?', 'What should I do next about chest pain?', 'What is my next step? Approve my reminder.', 'When should I take my medicine?', 'What paperwork should I bring?']) {
      assert.equal(isNextStepQuestion(text), false, text);
      assert.equal(sourceSearch(store, 'demo-001', text).answerType, 'source_passages');
    }
    const quote = 'Keep the fictional A–B paperwork — preserve the **literal** label.';
    store.importDocument('demo-001', 'Fictional punctuation source', quote);
    const result = sourceSearch(store, 'demo-001', 'literal');
    assert.equal(result.citations[0].quote, quote);
    assert.ok(result.answer.includes(quote));
    assert.equal(sourceSearch(store, 'demo-001', 'xylophone').citations.length, 0);
  }],
  ['Guidance has stable date ordering and does not bypass reminder approval or help gates', (store) => {
    const pid = 'demo-001';
    for (const taskId of [`${pid}-task-3`, `${pid}-task-1`]) {
      const task = store.get('task', taskId);
      store.reviewTask(pid, taskId, confirmation(task, {
        due: '2026-09-19',
        dateEvidence: { kind: 'human_clarification', explanation: 'Synthetic reviewer established a scenario-day deadline.' },
      }));
    }
    const before = store.plan(pid).guidance;
    assert.equal(before.nextTask.taskId, `${pid}-task-1`);
    assert.equal(before.nextTask.dateState, 'due_today');
    const action = store.proposeReminder(pid, before.nextTask.taskId);
    sourceSearch(store, pid, question);
    assert.throws(() => store.execute(pid, action.id), { status: 403 });
    store.approve(pid, action.id, true);
    store.requestHelp(pid, action.taskId, true);
    assert.equal(store.plan(pid).guidance.nextTask.taskId, `${pid}-task-3`);
    assert.throws(() => store.execute(pid, action.id), { code: 'STALE_REMINDER' });
    store.requestHelp(pid, action.taskId, false);
    assert.equal(store.plan(pid).guidance.nextTask.taskId, action.taskId);
    const reviewed = store.get('task', action.taskId);
    store.reviewTask(pid, action.taskId, confirmation(reviewed));
    assert.equal(store.plan(pid).guidance.nextTask.taskId, `${pid}-task-3`);
    assert.throws(() => store.execute(pid, action.id), { code: 'STALE_REMINDER' });
  }],
];
