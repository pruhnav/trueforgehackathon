import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from './store.js';
import { mountMcp } from './mcp.js';
import { forgeStatus, runAgent, sourceSearch } from './trueforge.js';
import { educationLinks, lookupEducation } from './education.js';
import { DEMO_DATE } from './fixtures.js';
import { isNextStepQuestion } from './guidance.js';
import { agentTeam, routeAgent } from './agents.js';

export function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1', '['].includes(host))
      return res.status(403).json({ error: 'Local prototype: unrecognized host.' });
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (
          !['localhost', '127.0.0.1'].includes(origin.hostname) ||
          !['5173', String(process.env.PORT || 8000), '8790'].includes(origin.port)
        )
          throw new Error();
      } catch {
        return res.status(403).json({ error: 'Origin is not allowed.' });
      }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  mountMcp(app, store);
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, app: 'Homeward', syntheticOnly: true, demoDate: DEMO_DATE }),
  );
  app.get('/api/status', async (_req, res) => res.json(await forgeStatus()));
  app.get('/api/agent-team', (_req, res) => res.json({
    runtime: 'TrueForge',
    routing: 'one_specialist_per_live_request',
    roles: agentTeam.map(({ id, label, purpose, tools }) => ({ id, label, purpose, tools })),
  }));
  app.get('/api/patients', (_req, res) =>
    res.json(store.all('patient').map((p) => ({ ...p, tasks: store.plan(p.id).tasks }))),
  );
  app.get('/api/patients/:id/plan', (req, res) => res.json(store.plan(req.params.id)));
  app.get('/api/patients/:id/summary', (req, res) => res.json(store.dischargeSummary(req.params.id)));
  app.patch('/api/patients/:id/tasks/:taskId', (req, res) => {
    const { complete } = z.object({ complete: z.boolean() }).parse(req.body);
    res.json(store.completeTask(req.params.id, req.params.taskId, complete));
  });
  app.post('/api/patients/:id/tasks/:taskId/help', (req, res) => {
    const { requested } = z.object({ requested: z.boolean() }).parse(req.body);
    res.json(store.requestHelp(req.params.id, req.params.taskId, requested));
  });
  // Local human UI operations. Deliberately absent from the MCP tool registry.
  app.post('/api/patients/:id/tasks/:taskId/reviews', (req, res) =>
    res.json(store.reviewTask(req.params.id, req.params.taskId, req.body)),
  );
  app.post('/api/patients/:id/tasks/:taskId/help/responses', (req, res) =>
    res.json(store.respondToHelp(req.params.id, req.params.taskId, req.body)),
  );
  app.get('/api/patients/:id/tasks/:taskId/history', (req, res) =>
    res.json(store.taskHistory(req.params.id, req.params.taskId)),
  );
  app.post('/api/patients/:id/documents', async (req, res) => {
    const input = z
      .object({
        title: z.string().min(1).max(120),
        text: z.string().max(80000).optional(),
        pdf: z.string().max(7000000).optional(),
      })
      .parse(req.body);
    let text = input.text;
    if (input.pdf) {
      const data = Buffer.from(input.pdf, 'base64');
      if (data.subarray(0, 5).toString() !== '%PDF-') throw new AppError('This is not a PDF file.');
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(data) });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    }
    res.status(201).json(store.importDocument(req.params.id, input.title, text));
  });
  app.post('/api/patients/:id/tasks/review', (req, res) => {
    const data = z
      .object({
        documentId: z.string(),
        sectionId: z.string(),
        quote: z.string().min(10).max(1800),
      })
      .parse(req.body);
    res.json(store.proposeTask(req.params.id, data));
  });
  app.post('/api/patients/:id/reminders', (req, res) => {
    const { taskId } = z.object({ taskId: z.string() }).parse(req.body);
    res.json(store.proposeReminder(req.params.id, taskId));
  });
  app.post('/api/patients/:id/actions/:actionId/approval', (req, res) => {
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    res.json(store.approve(req.params.id, req.params.actionId, approve));
  });
  app.post('/api/patients/:id/actions/:actionId/execute', (req, res) => {
    const { simulateTimeout } = z
      .object({ simulateTimeout: z.boolean().default(false) })
      .parse(req.body || {});
    res.json(store.execute(req.params.id, req.params.actionId, simulateTimeout));
  });
  app.get('/api/patients/:id/actions/:actionId/calendar', (req, res) => {
    const action = store.scoped('action', req.params.actionId, req.params.id);
    if (action.status !== 'executed')
      throw new AppError('Create an approved reminder before downloading its calendar file.', 403);
    const escape = (s) =>
      s
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/[,;]/g, (c) => `\\${c}`);
    const dt = new Date(`${action.due}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    const end = dt.toISOString().slice(0, 10).replaceAll('-', '');
    res
      .type('text/calendar')
      .attachment('homeward-reminder.ics')
      .send(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Homeward//Discharge Reminder//EN',
          'BEGIN:VEVENT',
          `UID:${action.id}@homeward.local`,
          `DTSTAMP:${new Date()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\.\d{3}/, '')}`,
          `DTSTART;VALUE=DATE:${action.due.replaceAll('-', '')}`,
          `DTEND;VALUE=DATE:${end}`,
          `SUMMARY:${escape(action.title)}`,
          'DESCRIPTION:Local Homeward reminder based on a fictional discharge plan. This is not a booked appointment.',
          'END:VEVENT',
          'END:VCALENDAR',
          '',
        ].join('\r\n'),
      );
  });
  const active = new Set();
  const calls = [];
  app.post('/api/patients/:id/chat', async (req, res) => {
    store.patient(req.params.id);
    const { message, mode, intent } = z
      .object({
        message: z.string().trim().min(2).max(2500),
        mode: z.enum(['live', 'source-search']),
        intent: z.enum(['auto', 'summary', 'question', 'reminder', 'coordination']).default('auto'),
      })
      .parse(req.body);
    const role = routeAgent(message, intent);
    if (mode === 'source-search' || isNextStepQuestion(message))
      return res.json(sourceSearch(store, req.params.id, message, role));
    while (calls[0] < Date.now() - 60000) calls.shift();
    if (active.has(req.params.id) || calls.length >= 8)
      throw new AppError(
        'Agent budget reached. Wait a minute before starting another live run.',
        429,
      );
    active.add(req.params.id);
    calls.push(Date.now());
    try {
      res.json(await runAgent(store, req.params.id, message, role));
    } finally {
      active.delete(req.params.id);
    }
  });
  app.get('/api/education', (_req, res) => res.json({ mode: 'curated', links: educationLinks }));
  app.post('/api/education/refresh', async (req, res) => {
    const { topic } = z
      .object({ topic: z.enum(['discharge', 'medication', 'followup']).default('discharge') })
      .parse(req.body || {});
    const result = await lookupEducation(topic);
    store.trace('education.lookup', result.note, result.mode === 'live' ? 'ok' : 'fallback');
    res.json(result);
  });
  app.get('/api/traces', (_req, res) => res.json(store.all('trace').slice(-200).reverse()));
  app.get('/api/evaluations', (_req, res) => {
    const path = resolve('.local/evaluation.json');
    res.json(
      existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf8'))
        : { cases: [], note: 'Run npm run eval to generate a fresh report.' },
    );
  });
  app.post('/api/demo/reset', (_req, res) => {
    if (active.size) throw new AppError('Wait for active agent runs before resetting.', 409);
    store.reset();
    res.json({ ok: true });
  });
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (req, res, next) =>
      req.path.startsWith('/api/') ? next() : res.sendFile(resolve('dist/index.html')),
    );
  }
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, _req, res, _next) => {
    const status = error instanceof z.ZodError ? 400 : error.status || 500;
    res.status(status).json({
      error:
        error instanceof z.ZodError
          ? 'Invalid request. Check the input fields.'
          : status === 500
            ? 'Something went wrong. Check the local server logs.'
            : error.message,
      ...(error instanceof z.ZodError
        ? { code: 'INVALID_REQUEST' }
        : error instanceof AppError && error.code
          ? { code: error.code, ...error.details }
          : {}),
    });
    if (status === 500) console.error(error);
  });
  return app;
}
