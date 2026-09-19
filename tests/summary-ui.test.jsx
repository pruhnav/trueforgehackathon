import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { once } from 'node:events';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

test('patient summary and specialist controls are accessible without a model; emergency calling survives API failure', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:8000' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { render, screen, within, waitFor, cleanup } = await import('@testing-library/react');
  const { default: userEvent } = await import('@testing-library/user-event');
  const { default: App } = await import('../src/App.jsx');
  const store = new Store(':memory:');
  const quote = 'Fictional product **A–B** — discharge directions are not recorded.';
  store.importDocument('demo-001', 'Unreviewed fictional product record', quote);
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  let failPlan = true;
  globalThis.fetch = (input, options) => {
    if (input === '/api/status') return Promise.resolve(new Response(JSON.stringify({ connected: true, ready: false, models: [] })));
    if (String(input).endsWith('/api/v1/models')) return Promise.resolve(new Response(JSON.stringify({ data: [] })));
    if (failPlan && String(input).endsWith('/plan')) return Promise.resolve(new Response(JSON.stringify({ error: 'Synthetic API outage' }), { status: 503 }));
    if (typeof input === 'string' && input.startsWith('/api')) return originalFetch(`${root}${input}`, options);
    throw new Error('Unexpected external request in UI test.');
  };
  const user = userEvent.setup({ document: dom.window.document });
  try {
    render(<App />);
    await screen.findByText('Synthetic API outage');
    assert.equal(screen.getByRole('link', { name: 'Call 911 emergency services (US demo)' }).getAttribute('href'), 'tel:911');
    cleanup();
    failPlan = false;
    render(<App />);
    await screen.findByRole('heading', { name: 'Hi Alex. What can we clear up?' });
    await user.click(screen.getByRole('button', { name: 'My discharge summary', exact: true }));
    const summary = await screen.findByRole('region', { name: 'Recorded discharge summary' });
    assert.ok(within(summary).getByRole('heading', { name: 'Your discharge, step by step.' }));
    assert.ok(within(summary).getByText('Your recorded next steps (3)'));
    assert.ok(within(summary).getByText('Questions and help needed (1)'));
    const laboratory = within(summary).getByRole('article', { name: 'Clarify the laboratory instructions' });
    assert.ok(within(laboratory).getByText('Care-team clarification is needed'));
    assert.ok(within(laboratory).getByText('No deadline established'));
    await user.click(within(laboratory).getByRole('button', { name: /View source/ }));
    assert.match(screen.getByRole('dialog', { name: 'Discharge summary' }).textContent, /does not specify the test or a date/);
    await user.keyboard('{Escape}');
    await user.click(within(summary).getByText('Source passages awaiting review (1)'));
    assert.ok(within(summary).getByText(quote));
    assert.equal(store.plan('demo-001').tasks.length, 4);
    await user.click(screen.getByText('Your Homeward agent team'));
    for (const label of ['Care-plan coordinator', 'Discharge summarizer', 'Questions and sources', 'Reminder assistant']) {
      assert.ok(screen.getByText(label, { selector: 'strong' }));
    }
    await user.click(screen.getByRole('button', { name: 'Ask discharge summarizer' }));
    await screen.findByText('DISCHARGE SUMMARY');
    assert.ok(screen.getByText('Discharge summarizer · Saved records · no model'));
    assert.equal(store.all('action').length, 0);
    assert.ok(!store.all('trace').some((entry) => entry.event === 'agent.started'));
    await user.click(screen.getByText('Document search mode').closest('summary'));
    await user.click(screen.getByRole('button', { name: 'TrueForge agent', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Ask discharge summarizer' }));
    await screen.findByText('Discharge summarizer · Saved-record fallback');
    assert.ok(screen.getByText(/A live model is not ready/));

    await user.click(screen.getByRole('button', { name: 'My recovery', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Mark complete: Complete your recovery check-in' }));
    await screen.findByRole('button', { name: 'Reopen: Complete your recovery check-in' });
    await waitFor(() => assert.ok(screen.getAllByText(/Your records have changed since this summary/).length > 0));
    await user.click(screen.getByRole('button', { name: 'My discharge summary', exact: true }));
    await screen.findByText('Reported complete (1)');
    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await user.click(await screen.findByRole('button', { name: /Sam Taylor.*discharged/ }));
    await screen.findByRole('heading', { name: 'Hi Sam. What can we clear up?' });
    await user.click(screen.getByRole('button', { name: 'My discharge summary', exact: true }));
    const sam = await screen.findByRole('region', { name: 'Recorded discharge summary' });
    assert.ok(!sam.textContent.includes(quote));
    assert.ok(sam.textContent.includes('Sam Taylor'));
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    store.close();
    dom.window.close();
  }
});
