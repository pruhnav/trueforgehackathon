// Explicit browser verification; requires separately installed playwright-core and Chrome.
// APP_ROOT must be a built, isolated snapshot. Never starts the team's normal database.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(process.env.APP_ROOT || '.local/integrated-main');
const out = resolve('docs/assets/journey');
const evidence = resolve('docs/evidence/integrated-main/browser.json');
const commit = readFileSync(resolve('docs/evidence/integrated-main/commit.txt'), 'utf8').trim();
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { Store } = await import(pathToFileURL(`${root}/server/store.js`));
const { createApp } = await import(pathToFileURL(`${root}/server/app.js`));
mkdirSync(out, { recursive: true });
const report = {
  commit,
  startedAt: new Date().toISOString(),
  mode: 'real-browser-source-search',
  viewport: { width: 1600, height: 1000 },
  steps: [],
  captures: [],
  pageErrors: [],
  apiErrors: [],
  networkFailures: [],
  consoleErrors: [],
  paidRequests: 0,
};
const store = new Store(':memory:');
const previousCwd = process.cwd();
process.chdir(root);
const server = createApp(store).listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
process.env.PORT = String(server.address().port);
let browser, page;
const record = (text) =>
  report.steps.push({ at: new Date().toISOString(), result: 'pass', description: text });
const capture = async (name, caption) => {
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 10000 });
  await page.locator('[role=dialog]').evaluateAll((nodes) =>
    nodes.forEach((node) => {
      node.scrollTop = 0;
    }),
  );
  const file = `${out}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  report.captures.push({
    file: `docs/assets/journey/${name}.png`,
    caption,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  });
};
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: report.viewport, acceptDownloads: true });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('requestfailed', (request) =>
    report.networkFailures.push({ url: request.url(), error: request.failure()?.errorText }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/'))
      report.apiErrors.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  // Budget protection: refuse any accidental live-chat request from the browser.
  await page.route('**/api/patients/*/chat', async (route) => {
    if (route.request().postDataJSON()?.mode === 'live')
      throw new Error('Paid model request blocked: this journey is source-search only.');
    await route.continue();
  });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Your recovery, organized.' }).waitFor();
  await capture(
    '01-recovery',
    'Alex sees the next task, deadlines, and unresolved laboratory question.',
  );
  record('Built production frontend loads against the real isolated API.');
  await page.getByRole('button', { name: 'View source', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Discharge summary' }).waitFor();
  await capture('02-source', 'The follow-up task links to its original discharge passage.');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('.assistant-settings summary').click();
  await page.getByRole('button', { name: 'Source search', exact: true }).click();
  await page.locator('.assistant-settings summary').click();
  await page.getByLabel('Ask about your discharge').fill('What paperwork should I bring?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.getByText(/These are exact source excerpts/).waitFor();
  await capture(
    '03-source-search',
    'Paperwork guidance is retrieved as exact excerpts; no live model is involved.',
  );
  record('Paperwork source search returns source excerpts in the persistent assistant.');
  const lab = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Clarify the laboratory instructions' }) });
  await lab.getByRole('button', { name: 'Need help', exact: true }).click();
  await lab.getByRole('button', { name: 'Withdraw help request' }).waitFor();
  await page.getByRole('button', { name: 'Care team', exact: true }).click();
  await page.getByLabel('Show requests').selectOption('help');
  await page
    .getByRole('button', {
      name: 'View source: Clarify the laboratory instructions for Alex Morgan',
    })
    .click();
  await page
    .getByLabel('Care-team response')
    .fill('Your question is recorded. The test and date still require clarification.');
  await page.getByLabel('Help decision').selectOption('resolve');
  await page.getByRole('button', { name: 'Save help response' }).click();
  await page.getByText(/Response saved and help request resolved locally/).waitFor();
  assert.equal(store.get('task', 'demo-001-task-4').status, 'needs_clarification');
  assert.equal(store.get('task', 'demo-001-task-4').due, null);
  await capture(
    '04-help-review',
    'Resolving the help conversation preserves the instruction review gate and unknown date.',
  );
  record(
    'Patient help request reaches care-team UI; resolution preserves null due and review gate.',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'My recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Set reminder for Arrange your follow-up visit' }).click();
  await page.getByRole('button', { name: 'Approve reminder' }).waitFor();
  await capture(
    '05-approval',
    'The patient explicitly approves a local reminder, separate from instruction review.',
  );
  await page.getByRole('button', { name: 'Approve reminder' }).click();
  await page.getByRole('checkbox', { name: 'Demo: simulate a timeout after saving' }).check();
  await page.getByRole('button', { name: 'Create local reminder' }).click();
  await page.getByText(/Simulated timeout after save/).waitFor();
  await page.getByRole('button', { name: 'Retry safely' }).click();
  const calendar = page.getByRole('link', { name: 'Download calendar reminder' });
  await calendar.waitFor();
  const downloadEvent = page.waitForEvent('download');
  await calendar.click();
  const download = await downloadEvent;
  await download.saveAs(`${out}/reminder.ics`);
  assert.match(readFileSync(`${out}/reminder.ics`, 'utf8'), /DTSTART;VALUE=DATE:20260926/);
  assert.equal(store.all('action').length, 1);
  assert.equal(store.all('trace').filter((t) => t.event === 'reminder.created').length, 1);
  await capture(
    '06-safe-retry',
    'A retry returns one saved reminder and a real downloadable calendar file.',
  );
  record(
    'Approve → execute → simulated response loss → retry → calendar download creates one reminder.',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Add discharge record' }).click();
  await page
    .getByLabel('Discharge instructions')
    .fill('Bring your discharge paperwork on September 26, 2026.');
  await page.getByRole('button', { name: 'Import record' }).click();
  await page.getByRole('button', { name: /2 records connected/ }).waitFor();
  await page.getByRole('button', { name: 'My documents', exact: true }).click();
  await page.getByRole('button', { name: /Additional discharge instructions/ }).click();
  await page.getByRole('button', { name: 'Add for care-team review' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Care team', exact: true }).click();
  await page.getByLabel('Show requests').selectOption('all');
  await page
    .getByRole('button', { name: 'Review task: Review imported instruction for Alex Morgan' })
    .click();
  await page.getByLabel('Review decision').selectOption('confirm');
  await page.getByLabel('Deadline evidence').selectOption('source');
  await page.getByLabel('Confirmed deadline').fill('2026-09-26');
  await page.getByLabel('Review note').fill('Reviewed the exact dated synthetic passage.');
  await page.getByRole('button', { name: 'Save instruction review' }).click();
  await page.getByText('Review saved locally. Reminder approval remains separate.').waitFor();
  const imported = store
    .plan('demo-001')
    .tasks.find((t) => t.title === 'Review imported instruction');
  assert.equal(imported.status, 'pending');
  assert.equal(imported.due, '2026-09-26');
  assert.equal(imported.source.quote, 'Bring your discharge paperwork on September 26, 2026.');
  await capture(
    '07-import-review',
    'An imported passage becomes actionable only after explicit review with date evidence.',
  );
  record(
    'Browser import → sourced task proposal → care-team dated confirmation preserves original citation.',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click();
  await page.getByRole('heading', { name: 'Trust is in the details.' }).waitFor();
  await page.getByText('reminder.deduplicated', { exact: true }).waitFor();
  await capture(
    '08-activity',
    'Actual local traces expose review, approval, reminder creation, and deduplication.',
  );
  await page.getByRole('button', { name: 'Care team', exact: true }).click();
  await page.getByRole('button', { name: /Jordan Rivera/ }).click();
  await page.getByRole('heading', { name: 'Hi Jordan. What can we clear up?' }).waitFor();
  assert.equal(await page.getByText(/These are exact source excerpts/).count(), 0);
  record('Switching patients clears the previous patient assistant conversation.');
  await page.getByRole('button', { name: 'Care team', exact: true }).click();
  await page.getByRole('button', { name: /Hui Stoltenberg.*discharged/ }).click();
  await page.getByRole('button', { name: 'My documents', exact: true }).click();
  await page.getByRole('button', { name: /Synthea historical record/ }).click();
  await page.getByRole('link', { name: 'Official Synthea dataset' }).waitFor();
  await capture(
    '09-provenance',
    'Synthea history displays source provenance and stays distinct from discharge instructions.',
  );
  record('Synthea document provenance is accessible through the actual browser UI.');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.getByRole('button', { name: 'Close menu', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Close menu', exact: true }).click({ position: { x: 350, y: 100 } });
  await capture(
    '10-mobile',
    'Mobile-width document workspace: a responsive-layout capture, not an accessibility certification.',
  );
  report.mobileHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(report.mobileHorizontalOverflow, false, 'Mobile viewport has horizontal overflow.');
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.apiErrors.length, 1);
  assert.equal(report.apiErrors[0].status, 504);
  assert.ok(report.apiErrors[0].path.endsWith('/execute'));
  report.runnerSha256 = createHash('sha256')
    .update(readFileSync(new URL(import.meta.url)))
    .digest('hex');
  report.result = 'pass';
} catch (error) {
  report.result = 'fail';
  report.failure = { message: error.message, stack: error.stack };
  if (page)
    await capture(
      'failure',
      'Failed verification state; not a successful journey screenshot.',
    ).catch(() => {});
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.finalTasks = store.all('task');
  report.finalActions = store.all('action');
  writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  store.close();
  process.chdir(previousCwd);
  console.log(
    JSON.stringify(
      {
        result: report.result,
        steps: report.steps.length,
        captures: report.captures.length,
        failure: report.failure?.message,
      },
      null,
      2,
    ),
  );
}
