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
    await screen.findByRole('heading', { name: 'Hi Alex. What can we clear up?' });
    assert.ok(screen.getByRole('heading', { name: 'Your recovery, organized.' }));
    assert.ok(screen.getByRole('complementary', { name: 'Persistent discharge assistant' }));
    await user.click(screen.getByRole('button', { name: 'Collapse menu' }));
    assert.equal(
      screen.getByRole('button', { name: 'Expand menu' }).getAttribute('aria-expanded'),
      'false',
    );
    assert.equal(dom.window.localStorage.getItem('homeward.menuCollapsed'), 'true');
    await user.click(screen.getByRole('button', { name: 'Expand menu' }));
    assert.equal(
      screen.getByRole('button', { name: 'Collapse menu' }).getAttribute('aria-expanded'),
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'What follow-up do I need?' }));
    await screen.findByText(/These are exact source excerpts/);
    await user.click(screen.getByRole('button', { name: 'View care plan' }));
    await screen.findByRole('heading', { name: 'Your recovery, organized.' });
    await user.click(screen.getAllByRole('button', { name: 'Need help', exact: true })[0]);
    await screen.findByText('Help requested', { selector: '.badge' });
    assert.equal(
      screen.getByRole('button', { name: 'Mark complete: Arrange your follow-up visit' }).disabled,
      true,
    );
    assert.equal(
      screen.queryByRole('button', { name: 'Set reminder for Arrange your follow-up visit' }),
      null,
    );
    await user.click(screen.getByRole('button', { name: 'Withdraw help request' }));
    await waitFor(() =>
      assert.equal(
        screen.getByRole('button', { name: 'Mark complete: Arrange your follow-up visit' })
          .disabled,
        false,
      ),
    );
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
    await user.click(screen.getByRole('button', { name: 'Focus discharge assistant' }));
    assert.equal(document.activeElement, screen.getByLabelText('Ask about your discharge'));
    assert.ok(screen.getByText(/These are exact source excerpts/));
    await user.type(
      screen.getByLabelText('Ask about your discharge'),
      'What paperwork should I bring?',
    );
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() =>
      assert.equal(screen.getAllByText(/These are exact source excerpts/).length, 2),
    );
    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await screen.findByText('Overdue follow-up');
    assert.equal(screen.getAllByText(/These are exact source excerpts/).length, 2);
    await user.click(screen.getByRole('button', { name: /Jordan Rivera/ }));
    await screen.findByText(/Jordan, here’s your plan/);
    await screen.findByRole('heading', { name: 'Hi Jordan. What can we clear up?' });
    assert.equal(screen.queryByText(/These are exact source excerpts/), null);
    await user.click(screen.getByRole('button', { name: 'View care plan' }));
    await user.click(screen.getByRole('button', { name: 'Add discharge record' }));
    await user.type(
      screen.getByLabelText('Discharge instructions'),
      'Contact the clinic to clarify the next appointment date.',
    );
    await user.click(screen.getByRole('button', { name: 'Import record' }));
    await screen.findByRole('button', { name: /2 records connected/ });
    await user.click(screen.getByRole('button', { name: 'My documents', exact: true }));
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
    await user.click(screen.getByRole('button', { name: 'Care team', exact: true }));
    await user.click(await screen.findByRole('button', { name: /Hui Stoltenberg.*discharged/ }));
    await screen.findByRole('heading', { name: 'Hi Hui. What can we clear up?' });
    await user.click(screen.getByRole('button', { name: 'My documents', exact: true }));
    await user.click(await screen.findByRole('button', { name: /Synthea historical record/ }));
    assert.ok(screen.getByRole('link', { name: 'Official Synthea dataset' }));
    assert.ok(screen.getByText('Source provenance'));
    assert.ok(screen.getByText(/encounters.csv · CSV row/));
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    store.close();
    dom.window.close();
  }
});
