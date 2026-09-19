import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixtures, DEMO_DATE } from './fixtures.js';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export class Store {
  constructor(path = '.local/homeward.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));',
    );
    if (!this.all('patient').length) this.seed();
  }
  all(kind) {
    return this.db
      .prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid')
      .all(kind)
      .map((r) => JSON.parse(r.payload));
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.payload) : null;
  }
  put(kind, value) {
    this.db
      .prepare(
        'INSERT INTO records(kind,id,payload) VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload',
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  seed() {
    for (const { patient, document, tasks } of fixtures()) {
      this.put('patient', patient);
      this.put('document', document);
      for (const task of tasks) this.put('task', task);
    }
  }
  trace(event, detail, status = 'ok', extra = {}) {
    return this.put('trace', {
      id: randomUUID(),
      at: new Date().toISOString(),
      event,
      detail,
      status,
      ...extra,
    });
  }
  patient(id) {
    const patient = this.get('patient', id);
    if (!patient) throw new AppError('Patient not found.', 404);
    return patient;
  }
  scoped(kind, id, patientId) {
    this.patient(patientId);
    const value = this.get(kind, id);
    if (!value || value.patientId !== patientId)
      throw new AppError('This record is outside the selected patient scope.', 403);
    return value;
  }
  plan(patientId) {
    return {
      patient: this.patient(patientId),
      tasks: this.all('task').filter((t) => t.patientId === patientId),
      documents: this.all('document').filter((d) => d.patientId === patientId),
      actions: this.all('action').filter((a) => a.patientId === patientId),
      demoDate: DEMO_DATE,
    };
  }
  search(patientId, query) {
    const plan = this.plan(patientId);
    const words = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) || [])].filter(
      (w) =>
        w.length > 2 &&
        ![
          'the',
          'and',
          'what',
          'with',
          'does',
          'for',
          'have',
          'need',
          'you',
          'can',
          'how',
        ].includes(w),
    );
    return plan.documents
      .flatMap((d) =>
        d.sections.map((s) => ({
          documentId: d.id,
          documentTitle: d.title,
          sectionId: s.id,
          heading: s.heading,
          page: s.page,
          quote: s.text,
          score: words.reduce(
            (n, w) => n + (`${s.heading} ${s.text}`.toLowerCase().includes(w) ? 1 : 0),
            0,
          ),
        })),
      )
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }
  completeTask(patientId, taskId, complete) {
    const task = this.scoped('task', taskId, patientId);
    if (task.status === 'needs_clarification')
      throw new AppError('This item needs care-team clarification before it can be completed.');
    task.status = complete ? 'completed' : 'pending';
    task.completedAt = complete ? new Date().toISOString() : null;
    this.put('task', task);
    this.trace(
      'task.updated',
      `${task.title}: ${complete ? 'patient-reported complete' : 'reopened'}`,
      'ok',
      { patientId },
    );
    return task;
  }
  importDocument(patientId, title, text) {
    this.patient(patientId);
    if (typeof text !== 'string' || text.trim().length < 20 || text.length > 80000)
      throw new AppError('Provide between 20 and 80,000 characters of discharge text.');
    const sections = text
      .trim()
      .split(/\n\s*\n/)
      .flatMap((p) => p.match(/[\s\S]{1,1800}/g) || [])
      .map((t, i) => ({
        id: `s${i + 1}`,
        heading: `Imported passage ${i + 1}`,
        text: t,
        page: null,
      }));
    const document = this.put('document', {
      id: randomUUID(),
      patientId,
      title: title.slice(0, 120),
      kind: 'imported',
      importedAt: new Date().toISOString(),
      sections,
    });
    this.trace(
      'document.imported',
      `${title}: ${sections.length} searchable passages. Imported instructions require review.`,
      'ok',
      { patientId },
    );
    return document;
  }
  proposeTask(patientId, input) {
    const doc = this.scoped('document', input.documentId, patientId);
    const section = doc.sections.find((s) => s.id === input.sectionId);
    if (!input.quote || input.quote.length < 10 || !section?.text.includes(input.quote))
      throw new AppError('A task must cite an exact passage from this patient’s document.');
    // Store the source text itself as the instruction. Freeform model text cannot overwrite it.
    const existing = this.all('task').find(
      (t) =>
        t.patientId === patientId &&
        t.source.documentId === doc.id &&
        t.source.quote === input.quote,
    );
    if (existing) return existing;
    const task = this.put('task', {
      id: randomUUID(),
      patientId,
      title: 'Review imported instruction',
      detail: input.quote,
      category: 'clarification',
      due: null,
      status: 'needs_clarification',
      source: { documentId: doc.id, sectionId: section.id, quote: input.quote },
      completedAt: null,
    });
    this.trace(
      'task.proposed',
      'A cited instruction was added for care-team review; no deadline inferred.',
      'ok',
      { patientId },
    );
    return task;
  }
  proposeReminder(patientId, taskId) {
    const task = this.scoped('task', taskId, patientId);
    if (task.status !== 'pending' || !task.due)
      throw new AppError('Only an open task with an explicit deadline can have a reminder.');
    const existing = this.all('action').find(
      (a) => a.patientId === patientId && a.taskId === taskId && a.status !== 'rejected',
    );
    if (existing) return existing;
    const action = this.put('action', {
      id: randomUUID(),
      patientId,
      taskId,
      type: 'reminder',
      title: task.title,
      due: task.due,
      status: 'proposed',
      createdAt: new Date().toISOString(),
      approvedAt: null,
      executedAt: null,
      receipt: null,
    });
    this.trace('reminder.proposed', `Awaiting human approval: ${task.title}`, 'pending', {
      patientId,
      actionId: action.id,
    });
    return action;
  }
  approve(patientId, actionId, approve) {
    const action = this.scoped('action', actionId, patientId);
    if (action.status !== 'proposed')
      throw new AppError('This action has already been reviewed.', 409);
    action.status = approve ? 'approved' : 'rejected';
    action.approvedAt = approve ? new Date().toISOString() : null;
    this.put('action', action);
    this.trace(
      approve ? 'approval.granted' : 'approval.rejected',
      action.title,
      approve ? 'ok' : 'blocked',
      { patientId, actionId },
    );
    return action;
  }
  execute(patientId, actionId, simulateTimeout = false) {
    const action = this.scoped('action', actionId, patientId);
    if (action.status === 'executed') {
      this.trace(
        'reminder.deduplicated',
        'Existing receipt returned; no duplicate reminder created.',
        'ok',
        { patientId, actionId },
      );
      return action;
    }
    if (action.status !== 'approved') {
      this.trace('execution.blocked', 'Human approval is required before execution.', 'blocked', {
        patientId,
        actionId,
      });
      throw new AppError('Human approval is required before execution.', 403);
    }
    const task = this.scoped('task', action.taskId, patientId);
    if (task.status !== 'pending' || task.due !== action.due)
      throw new AppError(
        'Task changed after proposal. Recheck the care plan before creating a reminder.',
        409,
      );
    action.status = 'executed';
    action.executedAt = new Date().toISOString();
    action.receipt = `LOCAL-${action.id.slice(0, 8).toUpperCase()}`;
    this.put('action', action);
    this.trace(
      'reminder.created',
      'Local reminder saved. Calendar file available; no external message sent.',
      'ok',
      { patientId, actionId },
    );
    if (simulateTimeout) {
      this.trace(
        'delivery.timeout',
        'Simulated response loss after saving. Safe to retry using the same action ID.',
        'error',
        { patientId, actionId },
      );
      throw new AppError(
        'Simulated timeout after save. Retry safely; the same receipt will be returned.',
        504,
      );
    }
    return action;
  }
  reset() {
    this.db.exec('DELETE FROM records');
    this.seed();
    this.trace('demo.reset', 'Synthetic scenarios restored.');
  }
  close() {
    this.db.close();
  }
}
