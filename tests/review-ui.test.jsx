import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { once } from 'node:events';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

test('Care-team UI: help handoff, source review, conflicts, safe retries, rejection and stale reminders', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:8000',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { render, screen, within, waitFor, cleanup } = await import('@testing-library/react');
  const { default: userEvent } = await import('@testing-library/user-event');
  const { default: App } = await import('../src/App.jsx');
  const store = new Store(':memory:');
  const doc = store.importDocument(
    'demo-001',
    'Discharge addendum',
    'Contact the discharge team by September 26, 2026 to discuss your paperwork.',
  );
  const task = store.proposeTask('demo-001', {
    documentId: doc.id,
    sectionId: 's1',
    quote: doc.sections[0].text,
  });
  const sample = store.all('patient').find((p) => p.id.startsWith('synthea-'));
  const sampleDoc = store.importDocument(
    sample.id,
    'Fictional discharge clarification',
    'Bring your discharge paperwork to the next follow-up visit.',
  );
  const staleAction = store.proposeReminder('demo-001', 'demo-001-task-1');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  let loseResponse = false,
    failQueue = false;
  const sent = [];
  globalThis.fetch = async (input, options) => {
    if (input === '/api/status')
      return new Response(JSON.stringify({ connected: true, ready: false, models: [] }));
    if (failQueue && input === '/api/patients')
      throw new TypeError('Simulated connection unavailable');
    const result = await originalFetch(
      typeof input === 'string' && input.startsWith('/api') ? base + input : input,
      options,
    );
    if (String(input).endsWith('/help/responses') && options?.method === 'POST') {
      sent.push(JSON.parse(options.body));
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError('Simulated response lost');
      }
    }
    return result;
  };
  const user = userEvent.setup({ document: dom.window.document });
  const close = async () => user.click(screen.getByRole('button', { name: 'Close dialog' }));
  const dialog = () => within(screen.getByRole('dialog', { name: 'Review & respond' }));
  try {
    render(<App />);
    await screen.findByRole('heading', { name: 'Your recovery, organized.' });
    const lab = screen
      .getByRole('heading', { name: 'Clarify the laboratory instructions' })
      .closest('article');
    await user.click(within(lab).getByRole('button', { name: 'Need help' }));
    await within(lab).findByRole('button', { name: 'Withdraw help request' });
    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await user.selectOptions(screen.getByLabelText('Show requests'), 'help');
    await user.click(
      await screen.findByRole('button', {
        name: 'View source: Clarify the laboratory instructions for Alex Morgan',
      }),
    );
    await dialog().findByRole('heading', { name: 'Original passage' });
    assert.match(
      dialog().getByRole('region', { name: 'Original passage' }).textContent,
      /does not specify the test or a date/,
    );
    await user.type(
      dialog().getByLabelText('Care-team response'),
      'We are checking which laboratory test was intended.',
    );
    loseResponse = true;
    await user.click(dialog().getByRole('button', { name: 'Save help response' }));
    await dialog().findByText('Simulated response lost');
    assert.equal(
      dialog().getByLabelText('Care-team response').value,
      'We are checking which laboratory test was intended.',
    );
    await user.click(dialog().getByRole('button', { name: 'Save help response' }));
    await dialog().findByText(/Response saved locally. Help request remains open/);
    assert.equal(sent.at(-1).requestId, sent.at(-2).requestId);
    assert.equal(
      store
        .taskHistory('demo-001', 'demo-001-task-4')
        .history.filter((h) => h.event === 'help_response').length,
      1,
    );
    await user.type(
      dialog().getByLabelText('Care-team response'),
      'Your question is recorded; the instruction still needs clarification.',
    );
    await user.selectOptions(dialog().getByLabelText('Help decision'), 'resolve');
    await user.click(dialog().getByRole('button', { name: 'Save help response' }));
    await dialog().findByText(/Response saved and help request resolved locally/);
    assert.equal(store.get('task', 'demo-001-task-4').status, 'needs_clarification');
    await close();
    await screen.findByText('No tasks match this view. Nothing needs attention here.');
    await user.click(screen.getByRole('button', { name: 'My recovery', exact: true }));
    await screen.findByText(
      'Your question is recorded; the instruction still needs clarification.',
      { selector: '.task-response > p' },
    );
    assert.equal(
      screen.getByRole('button', { name: 'Mark complete: Clarify the laboratory instructions' })
        .disabled,
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await user.click(
      await screen.findByRole('button', {
        name: 'Review task: Review imported instruction for Alex Morgan',
      }),
    );
    await dialog().findByLabelText('Review note');
    await user.selectOptions(dialog().getByLabelText('Review decision'), 'confirm');
    await user.selectOptions(dialog().getByLabelText('Deadline evidence'), 'source');
    await user.type(dialog().getByLabelText('Confirmed deadline'), '2026-09-27');
    await user.type(
      dialog().getByLabelText('Review note'),
      'Reviewed the addendum and its explicit deadline.',
    );
    await user.click(dialog().getByRole('button', { name: 'Save instruction review' }));
    await dialog().findByRole('alert');
    assert.equal(store.get('task', task.id).status, 'needs_clarification');
    assert.equal(
      dialog().getByLabelText('Review note').value,
      'Reviewed the addendum and its explicit deadline.',
    );
    await user.clear(dialog().getByLabelText('Confirmed deadline'));
    await user.type(dialog().getByLabelText('Confirmed deadline'), '2026-09-26');
    // Simulate an independent patient mutation while the review form is open.
    store.requestHelp('demo-001', task.id, true);
    await user.click(dialog().getByRole('button', { name: 'Save instruction review' }));
    await dialog().findByText(/Reload the latest task before submitting again/);
    assert.ok(
      dialog().getByRole('button', { name: 'Save instruction review' }).matches(':disabled'),
    );
    await user.click(dialog().getByRole('button', { name: 'Reload latest task' }));
    await waitFor(() =>
      assert.ok(
        !dialog().getByRole('button', { name: 'Save instruction review' }).matches(':disabled'),
      ),
    );
    assert.equal(
      dialog().getByLabelText('Review note').value,
      'Reviewed the addendum and its explicit deadline.',
    );
    await user.click(dialog().getByRole('button', { name: 'Save instruction review' }));
    await dialog().findByText('Review saved locally. Reminder approval remains separate.');
    assert.equal(store.get('task', task.id).due, '2026-09-26');
    assert.equal(store.get('task', task.id).status, 'pending');
    assert.ok(store.get('task', task.id).helpRequestedAt);
    assert.equal(store.get('task', task.id).source.quote, doc.sections[0].text);
    await user.type(
      dialog().getByLabelText('Care-team response'),
      'The explicit follow-up date has been recorded.',
    );
    await user.selectOptions(dialog().getByLabelText('Help decision'), 'resolve');
    await user.click(dialog().getByRole('button', { name: 'Save help response' }));
    await dialog().findByText(/Response saved and help request resolved locally/);
    await close();
    await user.click(screen.getByRole('button', { name: 'My recovery', exact: true }));
    assert.ok(screen.getByRole('button', { name: 'Set reminder for Review imported instruction' }));

    // Review a previously proposed reminder's task, then verify the UI blocks old approval.
    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await user.selectOptions(screen.getByLabelText('Show requests'), 'all');
    await user.click(
      await screen.findByRole('button', {
        name: 'Review task: Arrange your follow-up visit for Alex Morgan',
      }),
    );
    await dialog().findByLabelText('Review note');
    await user.selectOptions(dialog().getByLabelText('Review decision'), 'confirm');
    await user.selectOptions(dialog().getByLabelText('Deadline evidence'), 'human_clarification');
    await user.type(dialog().getByLabelText('Confirmed deadline'), '2026-09-28');
    await user.type(
      dialog().getByLabelText('Human clarification explanation'),
      'Fictional care team established this revised date.',
    );
    await user.type(
      dialog().getByLabelText('Review note'),
      'Recorded the human clarification separately.',
    );
    await user.click(dialog().getByRole('button', { name: 'Save instruction review' }));
    await dialog().findByText('Review saved locally. Reminder approval remains separate.');
    await close();
    await user.click(screen.getByRole('button', { name: 'View pending approvals' }));
    assert.ok(screen.getByText(/This reminder no longer matches/));
    assert.equal(screen.queryByRole('button', { name: 'Approve reminder' }), null);
    await user.click(screen.getByRole('button', { name: 'Propose a new reminder' }));
    await screen.findByRole('button', { name: 'Approve reminder' });
    assert.ok(store.plan('demo-001').actions.find((a) => a.id === staleAction.id).stale);
    await close();

    // Rejection remains visible in history and cannot be completed.
    await user.click(
      await screen.findByRole('button', {
        name: 'Review task: Review imported instruction for Alex Morgan',
      }),
    );
    await dialog().findByLabelText('Review note');
    await user.selectOptions(dialog().getByLabelText('Review decision'), 'reject');
    await user.type(
      dialog().getByLabelText('Review note'),
      'Retained for history; no longer an active coordination task.',
    );
    await user.click(dialog().getByRole('button', { name: 'Save instruction review' }));
    await dialog().findByText('Review saved locally. Reminder approval remains separate.');
    await close();
    await user.click(screen.getByRole('button', { name: 'My recovery', exact: true }));
    assert.equal(
      screen.getByRole('button', { name: 'Mark complete: Review imported instruction' }).disabled,
      true,
    );
    assert.equal(
      screen.queryByRole('button', { name: 'Set reminder for Review imported instruction' }),
      null,
    );

    // Queue outage is visible and retryable.
    failQueue = true;
    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await screen.findByText(/Could not load the queue/);
    failQueue = false;
    await user.click(screen.getByRole('button', { name: 'Refresh queue' }));
    const openSource = await screen.findByRole('button', {
      name: 'View source: Clarify the laboratory instructions for Alex Morgan',
    });
    await user.click(openSource);
    await dialog().findByRole('heading', { name: 'Original passage' });
    await user.keyboard('{Escape}');
    assert.equal(screen.queryByRole('dialog'), null);
    assert.equal(document.activeElement, openSource);
    await user.click(
      screen.getByRole('button', {
        name: 'Review task: Verify discharge instructions with the care team for Hui Stoltenberg',
      }),
    );
    await dialog().findByLabelText('Review note');
    await user.selectOptions(dialog().getByLabelText('Review decision'), 'confirm');
    assert.ok(
      dialog().getByRole('button', { name: 'Save instruction review' }).matches(':disabled'),
    );
    const option = dialog().getByRole('option', {
      name: 'Fictional discharge clarification · Imported passage 1',
    });
    await user.selectOptions(dialog().getByLabelText('Instruction source'), option.value);
    await user.type(
      dialog().getByLabelText('Review note'),
      'Reviewed separate discharge clarification; no date is supplied.',
    );
    await user.click(dialog().getByRole('button', { name: 'Save instruction review' }));
    await dialog().findByText('Review saved locally. Reminder approval remains separate.');
    const reviewedSample = store.plan(sample.id).tasks[0];
    assert.equal(reviewedSample.due, null);
    assert.equal(reviewedSample.status, 'pending');
    assert.equal(reviewedSample.instruction.documentId, sampleDoc.id);
    assert.notEqual(reviewedSample.source.documentId, sampleDoc.id);
    await close();
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    store.close();
    dom.window.close();
  }
});
