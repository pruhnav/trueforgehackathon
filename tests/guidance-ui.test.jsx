import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { once } from 'node:events';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { importedTask, confirmation } from './review-cases.js';

test('next-step UI agrees with chat, refreshes after changes, and preserves literal reviewed sources', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:8000',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { render, screen, within, waitFor, cleanup } = await import('@testing-library/react');
  const { default: userEvent } = await import('@testing-library/user-event');
  const { default: App } = await import('../src/App.jsx');
  const store = new Store(':memory:');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  const chatInputs = [];
  globalThis.fetch = (input, options) => {
    if (input === '/api/status')
      return Promise.resolve(new Response(JSON.stringify({ connected: true, ready: true, models: ['fixture/model'] })));
    if (typeof input === 'string' && input.endsWith('/chat')) chatInputs.push(JSON.parse(options.body));
    if (typeof input === 'string' && input.startsWith('/api')) return originalFetch(`${root}${input}`, options);
    throw new Error('No external/model calls are allowed in the guidance UI test.');
  };
  const user = userEvent.setup({ document: dom.window.document });
  const messages = () => [...document.querySelectorAll('.chat-message.assistant')];
  async function ask() {
    const count = messages().length;
    await user.type(screen.getByLabelText('Ask about your discharge'), 'What is my next step?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => assert.equal(messages().length, count + 1));
    return messages().at(-1);
  }
  const hero = () => screen.getByRole('region', { name: 'Next-step guidance' });
  try {
    render(<App />);
    await screen.findByRole('heading', { name: 'Hi Alex. What can we clear up?' });
    await screen.findByText('AI assistant connected');
    assert.ok(within(hero()).getByRole('heading', { name: 'Complete your recovery check-in' }));
    await user.click(screen.getByRole('button', { name: 'What is my next step?' }));
    await screen.findByText('PLAN GUIDANCE');
    const first = messages()[0];
    assert.match(first.textContent, /Your next dated task is: Complete your recovery check-in/);
    assert.match(first.textContent, /2026-09-21/);
    assert.match(first.textContent, /No model was used/);
    assert.equal(chatInputs[0].mode, 'live');
    await user.click(within(first).getByRole('button', { name: /Recovery check-in/ }));
    const dialog = screen.getByRole('dialog', { name: 'Discharge summary' });
    assert.match(dialog.querySelector('.source-passage.highlight').textContent, /Complete the recovery check-in on September 21, 2026/);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Mark complete: Complete your recovery check-in' }));
    await waitFor(() => assert.ok(within(hero()).getByRole('heading', { name: 'Arrange your follow-up visit' })));
    assert.match(first.textContent, /Your plan has changed since this answer/);
    const updated = await ask();
    assert.match(updated.textContent, /Your next dated task is: Arrange your follow-up visit/);
    const followup = screen.getByRole('button', { name: 'Mark complete: Arrange your follow-up visit' }).closest('article');
    await user.click(within(followup).getByRole('button', { name: 'Need help', exact: true }));
    await waitFor(() => assert.ok(within(hero()).getByRole('heading', { name: 'Open tasks without a deadline' })));
    assert.equal(screen.getByRole('button', { name: 'Mark complete: Arrange your follow-up visit' }).disabled, true);
    const undated = await ask();
    assert.match(undated.textContent, /Gather your visit paperwork: no deadline established/);

    const task = importedTask(store);
    const quote = 'Bring your **fictional** paperwork — preserve the A–B label and `code`.';
    const doc = store.importDocument('demo-001', 'Reviewed fictional instruction', quote);
    store.reviewTask('demo-001', task.id, confirmation(task, {
      instructionSource: { documentId: doc.id, sectionId: 's1', quote },
      due: '2026-09-20',
      dateEvidence: { kind: 'human_clarification', explanation: 'The fictional team confirmed September 20.' },
    }));
    const reviewed = await ask();
    assert.ok(reviewed.textContent.includes(quote));
    assert.equal(reviewed.querySelector('.source-answer strong'), null);
    await waitFor(() => assert.ok(within(hero()).getByText('Date supplied by human clarification, not the original passage')));
    await user.click(within(hero()).getByRole('button', { name: 'Review instruction' }));
    assert.ok(screen.getByRole('dialog', { name: 'Reviewed fictional instruction' }).textContent.includes(quote));
    await user.keyboard('{Escape}');
    assert.deepEqual(store.get('task', task.id).source, task.source);

    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await user.click(await screen.findByRole('button', { name: /Sam Taylor.*discharged/ }));
    await screen.findByRole('heading', { name: 'Hi Sam. What can we clear up?' });
    assert.ok(within(hero()).getByRole('heading', { name: 'Arrange your follow-up visit' }));
    const sam = await ask();
    assert.match(sam.textContent, /2026-09-25/);
    assert.ok(!sam.textContent.includes('Prepare a list of questions'));
    assert.ok(!sam.textContent.includes(quote));

    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await user.click(await screen.findByRole('button', { name: /Hui Stoltenberg.*discharged/ }));
    await screen.findByRole('heading', { name: 'Hi Hui. What can we clear up?' });
    assert.ok(within(hero()).getByRole('heading', { name: 'Your plan needs attention' }));
    const hui = await ask();
    assert.match(hui.textContent, /Historical context only/);
    assert.equal(store.all('action').length, 0);
    assert.ok(!store.all('trace').some((entry) => entry.event === 'agent.started'));
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    store.close();
    dom.window.close();
  }
});
