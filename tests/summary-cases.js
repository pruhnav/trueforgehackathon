import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { groundedResponse } from '../server/agent-responses.js';
import { sourceSearch } from '../server/trueforge.js';
import { importedTask, confirmation } from './review-cases.js';

export const summaryCases = [
  ['Discharge summaries are source-linked, patient-scoped reads with explicit missing dates', (store) => {
    const before = ['task', 'action', 'document', 'task_audit'].map((kind) => store.all(kind));
    const summary = store.dischargeSummary('demo-001');
    assert.equal(summary.sections.find((s) => s.id === 'ready').items.length, 3);
    assert.equal(summary.sections.find((s) => s.id === 'attention').items.length, 1);
    const paperwork = summary.sections.flatMap((s) => s.items).find((i) => i.id === 'demo-001-task-2');
    assert.equal(paperwork.due, null);
    assert.ok(paperwork.gaps.includes('No deadline established'));
    for (const card of summary.sections.flatMap((s) => s.items)) {
      if (card.source) {
        const document = store.scoped('document', card.source.documentId, summary.patientId);
        assert.ok(document.sections.find((s) => s.id === card.source.sectionId).text.includes(card.source.quote));
      }
    }
    assert.equal(store.dischargeSummary('demo-001').version, summary.version);
    const answer = sourceSearch(store, 'demo-001', 'Summarize my discharge instructions');
    assert.equal(answer.agentRole, 'summarizer');
    assert.equal(answer.execution, 'local');
    assert.equal(answer.metrics, null);
    assert.deepEqual(answer.summary, summary);
    assert.deepEqual(['task', 'action', 'document', 'task_audit'].map((kind) => store.all(kind)), before);
    assert.ok(!JSON.stringify(summary).includes('doc-demo-002'));
    assert.throws(() => store.dischargeSummary('missing'), { status: 404 });
  }],
  ['Summaries keep unreviewed and Synthea passages separate from actionable instructions', (store) => {
    const quote = 'Fictional product record: Demo Product 10 mg tablet. Discharge directions are not provided.';
    const doc = store.importDocument('demo-001', 'Fictional product context', quote);
    const summary = store.dischargeSummary('demo-001');
    const card = summary.sections.find((s) => s.id === 'unreviewed').items.find((i) => i.source.documentId === doc.id);
    assert.equal(card.instruction, quote);
    assert.equal(card.due, null);
    assert.equal(card.status, 'unreviewed');
    assert.equal(card.dose, undefined);
    assert.equal(card.route, undefined);
    assert.equal(store.plan('demo-001').tasks.length, 4);
    const pid = store.all('patient').find((p) => p.id.startsWith('synthea-')).id;
    const historical = store.dischargeSummary(pid);
    assert.equal(historical.sections.find((s) => s.id === 'ready').items.length, 0);
    assert.ok(historical.sections.find((s) => s.id === 'historical').items.length > 0);
    assert.equal(historical.guidance.nextTask, null);
    assert.equal(store.all('action').length, 0);
  }],
  ['Summary snapshots follow review/help changes without rewriting original instructions', (store) => {
    const task = importedTask(store);
    const before = store.dischargeSummary(task.patientId).version;
    const quote = 'Bring your **fictional** summary — preserve the A–B label.';
    const doc = store.importDocument(task.patientId, 'Reviewed fictional source', quote);
    const reviewed = store.reviewTask(task.patientId, task.id, confirmation(task, {
      instructionSource: { documentId: doc.id, sectionId: 's1', quote },
      due: '2026-09-20', dateEvidence: { kind: 'human_clarification', explanation: 'A fictional review supplied this date.' },
    }));
    let summary = store.dischargeSummary(task.patientId);
    assert.notEqual(summary.version, before);
    let card = summary.sections.find((s) => s.id === 'ready').items.find((i) => i.id === task.id);
    assert.equal(card.instruction, quote);
    assert.match(card.dateLabel, /human clarification/);
    assert.equal(card.originalSource.quote, task.source.quote);
    const help = store.requestHelp(task.patientId, task.id, true);
    summary = store.dischargeSummary(task.patientId);
    card = summary.sections.find((s) => s.id === 'attention').items.find((i) => i.id === task.id);
    assert.ok(card.gaps.some((g) => g.includes('paused')));
    assert.equal(card.due, null);
    store.respondToHelp(task.patientId, task.id, { requestId: randomUUID(), expectedRevision: help.revision, helpRequestId: help.helpRequestId, decision: 'resolve', response: 'Fictional help response.' });
    store.completeTask(task.patientId, task.id, true);
    assert.ok(store.dischargeSummary(task.patientId).sections.find((s) => s.id === 'completed').items.some((i) => i.id === task.id));
    assert.deepEqual(store.get('task', task.id).source, reviewed.task.source);
  }],
  ['Agent references cannot inject clinical prose, cross patients, or invent action receipts', async (store) => {
    const summary = store.dischargeSummary('demo-001');
    const base = { status: 'grounded', sourceRefs: [{ documentId: 'doc-demo-001', sectionId: 's2' }], taskIds: [], actionIds: [], educationTopic: null };
    const verified = await groundedResponse(store, 'demo-001', JSON.stringify(base), 'questions', summary);
    assert.equal(verified.citations[0].quote, store.get('document', 'doc-demo-001').sections[1].text);
    for (const input of [
      { ...base, answer: 'Invented dose and timing.' },
      { ...base, sourceRefs: [{ documentId: 'doc-demo-002', sectionId: 's1' }] },
      { ...base, sourceRefs: [{ documentId: 'doc-demo-001', sectionId: 'invented' }] },
      { ...base, taskIds: ['demo-002-task-1'] },
      { ...base, actionIds: ['invented-receipt'] },
      { ...base, sourceRefs: [] },
    ]) {
      await assert.rejects(() => groundedResponse(store, 'demo-001', JSON.stringify(input), 'questions', summary), { code: 'UNVERIFIED_AGENT_OUTPUT' });
    }
    const action = store.proposeReminder('demo-001', 'demo-001-task-1');
    await assert.rejects(() => groundedResponse(store, 'demo-001', JSON.stringify({ ...base, actionIds: [action.id] }), 'questions', summary), { code: 'UNVERIFIED_AGENT_OUTPUT' });
    const response = await groundedResponse(store, 'demo-001', JSON.stringify({ ...base, actionIds: [action.id] }), 'reminders', summary);
    assert.match(response.answer, /awaiting your separate approval/);
    assert.equal(store.get('action', action.id).status, 'proposed');
    assert.throws(() => store.execute('demo-001', action.id), { status: 403 });
  }],
];
