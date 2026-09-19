import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { sourceSearch, agentSpec } from '../server/trueforge.js';
import { reviewCases } from './review-cases.js';

export const cases = [
  ...reviewCases,
  [
    'Every fixture task has an exact source',
    (store) => {
      for (const p of store.all('patient'))
        for (const task of store.plan(p.id).tasks) {
          const doc = store.scoped('document', task.source.documentId, p.id);
          assert.ok(
            doc.sections
              .find((s) => s.id === task.source.sectionId)
              ?.text.includes(task.source.quote),
          );
        }
    },
  ],
  [
    'Unknown deadlines stay unknown',
    (store) => {
      const task = store.plan('demo-001').tasks.find((t) => t.category === 'clarification');
      assert.equal(task.due, null);
      assert.equal(task.status, 'needs_clarification');
      assert.throws(() => store.proposeReminder('demo-001', task.id));
    },
  ],
  [
    'Execution without approval is blocked',
    (store) => {
      const action = store.proposeReminder('demo-001', 'demo-001-task-1');
      assert.throws(() => store.execute('demo-001', action.id), { status: 403 });
      assert.equal(store.get('action', action.id).status, 'proposed');
    },
  ],
  [
    'Patient boundaries reject foreign records',
    (store) => {
      assert.throws(() => store.scoped('document', 'doc-demo-002', 'demo-001'), { status: 403 });
      assert.throws(() => store.proposeReminder('demo-001', 'demo-002-task-1'), { status: 403 });
      assert.ok(
        store.search('demo-001', 'follow-up').every((c) => c.documentId === 'doc-demo-001'),
      );
    },
  ],
  [
    'Retry after response loss creates no duplicate',
    (store) => {
      const action = store.proposeReminder('demo-001', 'demo-001-task-1');
      store.approve('demo-001', action.id, true);
      assert.throws(() => store.execute('demo-001', action.id, true), { status: 504 });
      const receipt = store.get('action', action.id).receipt;
      assert.equal(store.execute('demo-001', action.id).receipt, receipt);
      assert.equal(store.all('action').length, 1);
      assert.equal(store.all('trace').filter((t) => t.event === 'reminder.created').length, 1);
    },
  ],
  [
    'Declined actions cannot execute',
    (store) => {
      const action = store.proposeReminder('demo-001', 'demo-001-task-1');
      store.approve('demo-001', action.id, false);
      assert.throws(() => store.execute('demo-001', action.id), { status: 403 });
    },
  ],
  [
    'Fabricated citations are rejected',
    (store) => {
      assert.throws(() =>
        store.proposeTask('demo-001', {
          documentId: 'doc-demo-001',
          sectionId: 's1',
          quote: 'Take a newly invented medication twice a day.',
        }),
      );
      assert.equal(store.plan('demo-001').tasks.length, 4);
    },
  ],
  [
    'Imported instructions require human review',
    (store) => {
      const document = store.importDocument(
        'demo-001',
        'Test document',
        'Call the care team to clarify your next follow-up.',
      );
      const task = store.proposeTask('demo-001', {
        documentId: document.id,
        sectionId: 's1',
        quote: document.sections[0].text,
      });
      assert.equal(task.status, 'needs_clarification');
      assert.equal(task.due, null);
      assert.throws(() => store.completeTask('demo-001', task.id, true));
    },
  ],
  [
    'Missing answers are not invented',
    (store) => {
      const result = sourceSearch(store, 'demo-001', 'xylophone');
      assert.equal(result.citations.length, 0);
      assert.match(result.answer, /could not find/);
      assert.equal(result.mode, 'source-search');
    },
  ],
  [
    'Changed tasks invalidate pending execution',
    (store) => {
      const action = store.proposeReminder('demo-001', 'demo-001-task-1');
      store.approve('demo-001', action.id, true);
      store.completeTask('demo-001', action.taskId, true);
      assert.throws(() => store.execute('demo-001', action.id), { status: 409 });
    },
  ],
  [
    'Repeated proposals reuse the existing action',
    (store) => {
      const first = store.proposeReminder('demo-001', 'demo-001-task-1');
      const second = store.proposeReminder('demo-001', 'demo-001-task-1');
      assert.equal(first.id, second.id);
    },
  ],
  [
    'Agent runs have bounded tool access and iterations',
    () => {
      const spec = agentSpec('test/model', 'homeward-demo-001', 'demo-001');
      assert.equal(spec.config.iteration_limit, 8);
      assert.equal(spec.config.dynamic_sub_agents.enabled, false);
      assert.equal(spec.mcp_servers.length, 1);
      assert.equal(spec.mcp_servers[0].name, 'homeward-demo-001');
    },
  ],
];
export async function runCase(fn) {
  const store = new Store(':memory:');
  try {
    await fn(store);
  } finally {
    store.close();
  }
}
