import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { once } from 'node:events';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

test('Patient UI: sources, completion, safe reminder retry, retrieval, care team, and import', async () => {
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
  const { render, screen, waitFor, cleanup } = await import('@testing-library/react');
  const { default: userEvent } = await import('@testing-library/user-event');
  const { default: App } = await import('../src/App.jsx');
  const store = new Store(':memory:');
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    if (input === '/api/status')
      return Promise.resolve(
        new Response(JSON.stringify({ connected: true, ready: false, models: [] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    return originalFetch(
      typeof input === 'string' && input.startsWith('/api') ? `${root}${input}` : input,
      options,
    );
  };
  const user = userEvent.setup({ document: dom.window.document });
  try {
    render(<App />);
    await screen.findByRole('heading', { name: 'Your recovery, organized.' });
    await user.click(screen.getAllByRole('button', { name: 'View source' })[0]);
    assert.ok(screen.getByRole('dialog', { name: 'Discharge summary' }));
    assert.match(screen.getByRole('dialog').textContent, /within seven days/);
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(
      screen.getByRole('button', { name: 'Mark complete: Gather your visit paperwork' }),
    );
    await screen.findByRole('button', { name: 'Reopen: Gather your visit paperwork' });
    await user.click(
      screen.getByRole('button', { name: 'Set reminder for Arrange your follow-up visit' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Approve reminder' }));
    await user.click(
      await screen.findByRole('checkbox', { name: 'Demo: simulate a timeout after saving' }),
    );
    await user.click(screen.getByRole('button', { name: 'Create local reminder' }));
    await screen.findByText(/Simulated timeout after save/);
    await user.click(screen.getByRole('button', { name: 'Retry safely' }));
    const calendar = await screen.findByRole('link', { name: 'Download calendar reminder' });
    assert.match(calendar.getAttribute('href'), /\/calendar$/);
    assert.equal(store.all('action').length, 1);
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Ask Homeward' }));
    await user.click(screen.getByRole('button', { name: 'What paperwork should I bring?' }));
    await screen.findByText(/These are exact source excerpts/);
    await user.click(screen.getByRole('button', { name: 'Close assistant' }));
    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await screen.findByText('Overdue follow-up');
    await user.click(screen.getByRole('button', { name: /Jordan Rivera/ }));
    await screen.findByText(/Jordan, here’s your plan/);
    await user.click(screen.getByRole('button', { name: 'Add discharge record' }));
    await user.type(
      screen.getByLabelText('Discharge instructions'),
      'Contact the clinic to clarify the next appointment date.',
    );
    await user.click(screen.getByRole('button', { name: 'Import record' }));
    await screen.findByRole('heading', { name: 'Your instructions, together.' });
    await user.click(screen.getByRole('button', { name: /Additional discharge instructions/ }));
    await user.click(screen.getByRole('button', { name: 'Add for care-team review' }));
    await waitFor(() =>
      assert.ok(
        store.plan('demo-002').tasks.some((t) => t.title === 'Review imported instruction'),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Agent activity' }));
    await screen.findByRole('heading', { name: 'Trust is in the details.' });
    await screen.findByText('reminder.deduplicated');
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    store.close();
    dom.window.close();
  }
});
