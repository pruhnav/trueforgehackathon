import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fixtures, DEMO_DATE } from './fixtures.js';
import { buildGuidance } from './guidance.js';
import { buildDischargeSummary, clinicalSnapshotVersion } from './summary.js';

const referenceSchema = z
  .object({
    documentId: z.string().min(1),
    sectionId: z.string().min(1),
    quote: z.string().min(10).max(1800),
  })
  .strict();
const explanation = z.string().trim().min(1).max(2000);
const commandFields = {
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
};
const dateEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), source: referenceSchema }).strict(),
  z.object({ kind: z.literal('human_clarification'), explanation }).strict(),
]);
const reviewSchema = z.discriminatedUnion('decision', [
  z.object({
    ...commandFields,
    decision: z.literal('confirm'),
    note: explanation,
    instructionSource: referenceSchema.optional(),
    due: z.string().nullable(),
    dateEvidence: dateEvidenceSchema.nullable(),
  }).strict(),
  ...['clarify', 'reject'].map((decision) =>
    z.object({ ...commandFields, decision: z.literal(decision), note: explanation }).strict(),
  ),
]);
const helpResponseSchema = z
  .object({
    ...commandFields,
    helpRequestId: z.string().uuid(),
    decision: z.enum(['respond', 'resolve']),
    response: explanation,
  })
  .strict();

// Stable hashes are insensitive to object key ordering, including JSON loaded from SQLite.
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item).sort().map((key) => [key, item[key]]),
        )
      : item,
  );
const fingerprint = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function passageHasDate(quote, due) {
  if ((quote.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).includes(due)) return true;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const dates = quote.matchAll(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi,
  );
  return [...dates].some(
    ([, month, day, year]) =>
      `${year}-${String(months.indexOf(month.slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}` === due,
  );
}
function reminderBasis(task) {
  return {
    instructionRevision: task.instructionRevision,
    title: task.title,
    detail: task.detail,
    source: task.source,
    instruction: task.instruction,
    status: task.status,
    due: task.due,
    dateEvidence: task.dateEvidence,
  };
}

export class AppError extends Error {
  constructor(message, status = 400, code = null, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export class Store {
  constructor(path = '.local/homeward.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));',
    );
    if (!this.all('patient').length) this.seed();
    this.seedSynthea();
    this.upgradeReviewRecords();
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  workflowTask(task) {
    return {
      revision: 1,
      instructionRevision: 1,
      instruction: ['pending', 'completed'].includes(task.status) ? task.source : null,
      dateEvidence: task.due
        ? { kind: 'legacy', note: 'Deadline predates captured review evidence.' }
        : null,
      lastReviewId: null,
      helpRequestId: task.helpRequestedAt ? randomUUID() : null,
      lastHelpAuditId: null,
      ...task,
    };
  }
  upgradeReviewRecords() {
    this.transaction(() => {
      for (const task of this.all('task')) {
        const upgraded = this.workflowTask(task);
        if (canonical(task) !== canonical(upgraded)) this.put('task', upgraded);
      }
    });
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
      for (const task of tasks) this.put('task', this.workflowTask(task));
    }
  }
  seedSynthea() {
    const { patient, document, tasks } = JSON.parse(
      readFileSync(new URL('../data/synthea-sample.json', import.meta.url), 'utf8'),
    );
    if (this.get('patient', patient.id)) return;
    this.put('patient', patient);
    this.put('document', document);
    for (const task of tasks) this.put('task', this.workflowTask(task));
  }
  requestHelp(patientId, taskId, requested) {
    z.boolean().parse(requested);
    return this.transaction(() => {
      const task = this.scoped('task', taskId, patientId);
      if (requested && ['completed', 'rejected'].includes(task.status))
        throw new AppError('Only open tasks can request help.', 409, 'STATE_CONFLICT');
      if (!!task.helpRequestedAt === requested) return task;
      const previous = structuredClone(task);
      task.helpRequestedAt = requested ? new Date().toISOString() : null;
      task.helpRequestId = requested ? randomUUID() : null;
      task.revision++;
      const event = requested ? 'help_requested' : 'help_withdrawn';
      const auditId = randomUUID();
      task.lastHelpAuditId = auditId;
      this.saveTaskAudit(previous, task, {
        id: auditId,
        event,
        decision: requested ? 'request' : 'withdraw',
        actor: { kind: 'local_demo_patient', authenticated: false },
        helpRequestId: requested ? task.helpRequestId : previous.helpRequestId,
      });
      return task;
    });
  }
  sourceReference(patientId, reference, instructionOnly = false) {
    const doc = this.scoped('document', reference.documentId, patientId);
    const section = doc.sections.find((s) => s.id === reference.sectionId);
    if (!reference.quote || reference.quote.length < 10 || !section?.text.includes(reference.quote))
      throw new AppError(
        'A task must cite an exact passage from this patient’s document.',
        422,
        'INVALID_SOURCE',
      );
    if (
      instructionOnly &&
      (!['imported', 'synthetic'].includes(doc.kind) ||
        [doc.trustClass, section.trustClass].some(
          (value) => value && value !== 'patient_instruction',
        ))
    )
      throw new AppError(
        'Historical or unsupported material requires a separate discharge instruction or clarification document.',
        422,
        'UNSUPPORTED_SOURCE',
      );
    return { documentId: doc.id, sectionId: section.id, quote: reference.quote };
  }
  reviewDate(patientId, due, evidence) {
    if (due !== null && !isCalendarDate(due))
      throw new AppError('Use a real calendar date in YYYY-MM-DD format.', 422, 'INVALID_DATE');
    if ((due === null) !== (evidence === null))
      throw new AppError(
        'A deadline needs evidence; an unknown deadline must have null evidence.',
        422,
        'DATE_EVIDENCE_REQUIRED',
      );
    if (evidence?.kind === 'source') {
      this.sourceReference(patientId, evidence.source, true);
      if (!passageHasDate(evidence.source.quote, due))
        throw new AppError(
          'The cited passage does not explicitly contain the selected date. Record human clarification instead.',
          422,
          'UNSUPPORTED_DATE',
        );
    }
    return evidence;
  }
  saveTaskAudit(previous, task, fields) {
    const references = [task.source, task.instruction, task.dateEvidence?.source].filter(Boolean);
    const audit = {
      id: randomUUID(),
      patientId: task.patientId,
      taskId: task.id,
      at: new Date().toISOString(),
      actor: { kind: 'local_demo_operator', authenticated: false },
      requestId: null,
      helpRequestId: null,
      note: null,
      response: null,
      ...fields,
      previous,
      resulting: structuredClone(task),
      sourceReferences: references.filter(
        (ref, i) => references.findIndex((r) => canonical(r) === canonical(ref)) === i,
      ),
    };
    this.put('task', task);
    this.put('task_audit', audit);
    this.trace(`task.${audit.event}`, `Task ${task.id}: ${audit.decision}.`, 'ok', {
      patientId: task.patientId,
      taskId: task.id,
      auditId: audit.id,
    });
    return audit;
  }
  taskHistory(patientId, taskId) {
    return {
      task: this.scoped('task', taskId, patientId),
      history: this.all('task_audit').filter(
        (entry) => entry.patientId === patientId && entry.taskId === taskId,
      ),
    };
  }
  taskCommand(patientId, taskId, operation, input, mutate) {
    return this.transaction(() => {
      const task = this.scoped('task', taskId, patientId);
      const id = JSON.stringify([patientId, taskId, input.requestId]);
      const payloadHash = fingerprint({ operation, input });
      const existing = this.get('task_command', id);
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new AppError(
            'Request ID was already used for a different command.',
            409,
            'IDEMPOTENCY_CONFLICT',
          );
        return { ...existing.result, replayed: true };
      }
      if (task.revision !== input.expectedRevision)
        throw new AppError(
          'Task changed. Reload before submitting another decision.',
          409,
          'REVISION_CONFLICT',
          { currentRevision: task.revision },
        );
      const previous = structuredClone(task);
      const audit = mutate(task, previous);
      const result = { task, audit, replayed: false };
      this.put('task_command', { id, patientId, taskId, payloadHash, result });
      return result;
    });
  }
  reviewTask(patientId, taskId, raw) {
    const input = reviewSchema.parse(raw);
    return this.taskCommand(patientId, taskId, 'review', input, (task, previous) => {
      if (task.status === 'completed')
        throw new AppError('Reopen a completed task before reviewing it.', 409, 'STATE_CONFLICT');
      this.sourceReference(patientId, task.source);
      if (input.decision === 'confirm') {
        task.instruction = this.sourceReference(
          patientId,
          input.instructionSource || task.instruction || task.source,
          true,
        );
        task.dateEvidence = this.reviewDate(patientId, input.due, input.dateEvidence);
        task.due = input.due;
        task.status = 'pending';
      } else {
        task.status = input.decision === 'clarify' ? 'needs_clarification' : 'rejected';
        task.due = null;
        task.dateEvidence = null;
      }
      task.completedAt = null;
      task.revision++;
      task.instructionRevision++;
      task.lastReviewId = randomUUID();
      return this.saveTaskAudit(previous, task, {
        id: task.lastReviewId,
        event: 'review',
        decision: input.decision,
        requestId: input.requestId,
        note: input.note,
      });
    });
  }
  respondToHelp(patientId, taskId, raw) {
    const input = helpResponseSchema.parse(raw);
    return this.taskCommand(patientId, taskId, 'help_response', input, (task, previous) => {
      if (!task.helpRequestedAt || task.helpRequestId !== input.helpRequestId)
        throw new AppError(
          'This help episode is no longer active. Reload the task.',
          409,
          'STATE_CONFLICT',
        );
      if (input.decision === 'resolve') {
        task.helpRequestedAt = null;
        task.helpRequestId = null;
      }
      task.revision++;
      task.lastHelpAuditId = randomUUID();
      return this.saveTaskAudit(previous, task, {
        id: task.lastHelpAuditId,
        event: input.decision === 'resolve' ? 'help_resolved' : 'help_response',
        decision: input.decision,
        requestId: input.requestId,
        helpRequestId: input.helpRequestId,
        response: input.response,
      });
    });
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
    if (!patient) throw new AppError('Patient not found.', 404, 'PATIENT_NOT_FOUND');
    return patient;
  }
  scoped(kind, id, patientId) {
    this.patient(patientId);
    const value = this.get(kind, id);
    if (!value || value.patientId !== patientId)
      throw new AppError('This record is outside the selected patient scope.', 403, 'PATIENT_SCOPE');
    return value;
  }
  plan(patientId) {
    const plan = {
      patient: this.patient(patientId),
      tasks: this.all('task').filter((t) => t.patientId === patientId),
      documents: this.all('document').filter((d) => d.patientId === patientId),
      actions: this.all('action')
        .filter((a) => a.patientId === patientId)
        .map((action) => ({
          ...action,
          stale:
            !['executed', 'rejected'].includes(action.status) &&
            !this.reminderMatches(action, this.get('task', action.taskId)),
        })),
      demoDate: DEMO_DATE,
    };
    plan.guidance = buildGuidance(plan, (task) => {
      this.sourceReference(patientId, task.source);
      this.sourceReference(patientId, task.instruction ?? task.source, true);
      if (task.due != null && !isCalendarDate(task.due))
        throw new AppError('Recorded deadline requires review.', 422, 'INVALID_DATE');
      if (task.dateEvidence && task.dateEvidence.kind !== 'legacy') {
        const evidence = dateEvidenceSchema.safeParse(task.dateEvidence);
        if (!evidence.success)
          throw new AppError('Deadline evidence requires review.', 422, 'DATE_EVIDENCE_REQUIRED');
        this.reviewDate(patientId, task.due ?? null, evidence.data);
      } else if (task.due == null && task.dateEvidence) {
        throw new AppError('Deadline evidence requires review.', 422, 'DATE_EVIDENCE_REQUIRED');
      }
    });
    plan.snapshotVersion = clinicalSnapshotVersion(plan);
    return plan;
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
          kind: d.kind,
          provenance: s.provenance || null,
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
  dischargeSummary(patientId) {
    return buildDischargeSummary(this.plan(patientId));
  }
  completeTask(patientId, taskId, complete) {
    z.boolean().parse(complete);
    return this.transaction(() => {
      const task = this.scoped('task', taskId, patientId);
      if (task.helpRequestedAt)
        throw new AppError('Clear the help request before completing this task.');
      if (!['pending', 'completed'].includes(task.status))
        throw new AppError('This item needs care-team clarification before it can be completed.');
      const status = complete ? 'completed' : 'pending';
      if (task.status === status) return task;
      const previous = structuredClone(task);
      task.status = status;
      task.completedAt = complete ? new Date().toISOString() : null;
      task.revision++;
      task.instructionRevision++;
      this.saveTaskAudit(previous, task, {
        event: complete ? 'task_completed' : 'task_reopened',
        decision: complete ? 'complete' : 'reopen',
        actor: { kind: 'local_demo_patient', authenticated: false },
      });
      return task;
    });
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
    const source = this.sourceReference(patientId, input);
    // Store the source text itself as the instruction. Freeform model text cannot overwrite it.
    const existing = this.all('task').find(
      (t) =>
        t.patientId === patientId &&
        t.source.documentId === source.documentId &&
        t.source.sectionId === source.sectionId &&
        t.source.quote === input.quote,
    );
    if (existing) return existing;
    const task = this.put(
      'task',
      this.workflowTask({
        id: randomUUID(),
        patientId,
        title: 'Review imported instruction',
        detail: input.quote,
        category: 'clarification',
        due: null,
        status: 'needs_clarification',
        source,
        completedAt: null,
      }),
    );
    this.trace(
      'task.proposed',
      'A cited instruction was added for care-team review; no deadline inferred.',
      'ok',
      { patientId },
    );
    return task;
  }
  reminderMatches(action, task) {
    if (
      !task ||
      task.patientId !== action.patientId ||
      task.status !== 'pending' ||
      !isCalendarDate(task.due) ||
      action.due !== task.due ||
      action.taskInstructionRevision !== task.instructionRevision ||
      action.taskFingerprint !== fingerprint(reminderBasis(task))
    ) return false;
    try {
      this.sourceReference(task.patientId, task.source);
      this.sourceReference(task.patientId, task.instruction || task.source, true);
      if (task.dateEvidence?.kind === 'source')
        this.reviewDate(task.patientId, task.due, task.dateEvidence);
      return true;
    } catch (error) {
      if (error instanceof AppError) return false;
      throw error;
    }
  }
  assertCurrentReminder(action) {
    const task = this.scoped('task', action.taskId, action.patientId);
    if (task.helpRequestedAt || !this.reminderMatches(action, task))
      throw new AppError(
        'Task changed or is paused. Recheck the plan and propose a new reminder if needed.',
        409,
        'STALE_REMINDER',
      );
  }
  proposeReminder(patientId, taskId) {
    return this.transaction(() => {
      const task = this.scoped('task', taskId, patientId);
      if (task.helpRequestedAt || task.status !== 'pending' || !isCalendarDate(task.due))
        throw new AppError('Only an open task with an explicit valid deadline can have a reminder.');
      this.sourceReference(patientId, task.source);
      this.sourceReference(patientId, task.instruction || task.source, true);
      if (task.dateEvidence?.kind === 'source')
        this.reviewDate(patientId, task.due, task.dateEvidence);
      const existing = this.all('action').find(
        (a) =>
          a.patientId === patientId &&
          a.taskId === taskId &&
          a.status !== 'rejected' &&
          this.reminderMatches(a, task),
      );
      if (existing) return existing;
      const action = this.put('action', {
        id: randomUUID(),
        patientId,
        taskId,
        type: 'reminder',
        title: task.title,
        due: task.due,
        taskInstructionRevision: task.instructionRevision,
        taskFingerprint: fingerprint(reminderBasis(task)),
        status: 'proposed',
        createdAt: new Date().toISOString(),
        approvedAt: null,
        executedAt: null,
        receipt: null,
      });
      this.trace('reminder.proposed', 'Awaiting human approval.', 'pending', {
        patientId,
        taskId,
        actionId: action.id,
      });
      return action;
    });
  }
  approve(patientId, actionId, approve) {
    z.boolean().parse(approve);
    return this.transaction(() => {
      const action = this.scoped('action', actionId, patientId);
      if (action.status !== 'proposed')
        throw new AppError('This action has already been reviewed.', 409);
      if (approve) this.assertCurrentReminder(action);
      action.status = approve ? 'approved' : 'rejected';
      action.approvedAt = approve ? new Date().toISOString() : null;
      this.put('action', action);
      this.trace(
        approve ? 'approval.granted' : 'approval.rejected',
        'Local reminder approval decision recorded.',
        approve ? 'ok' : 'blocked',
        { patientId, actionId },
      );
      return action;
    });
  }
  execute(patientId, actionId, simulateTimeout = false) {
    let created = false;
    let action;
    try {
      action = this.transaction(() => {
        const current = this.scoped('action', actionId, patientId);
        if (current.status === 'executed') {
          this.trace(
            'reminder.deduplicated',
            'Existing receipt returned; no duplicate reminder created.',
            'ok',
            { patientId, actionId },
          );
          return current;
        }
        if (current.status !== 'approved')
          throw new AppError('Human approval is required before execution.', 403);
        this.assertCurrentReminder(current);
        current.status = 'executed';
        current.executedAt = new Date().toISOString();
        current.receipt = `LOCAL-${current.id.slice(0, 8).toUpperCase()}`;
        this.put('action', current);
        this.trace(
          'reminder.created',
          'Local reminder saved. Calendar file available; no external message sent.',
          'ok',
          { patientId, actionId },
        );
        created = true;
        return current;
      });
    } catch (error) {
      if (error instanceof AppError && [403, 409].includes(error.status))
        this.trace('execution.blocked', 'Reminder approval, scope, or task-version check failed.', 'blocked', {
          patientId, actionId,
        });
      throw error;
    }
    // Response-loss simulation is deliberately after commit, preserving the saved receipt.
    if (simulateTimeout && created) {
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
    this.seedSynthea();
    this.trace('demo.reset', 'Synthetic scenarios restored.');
  }
  close() {
    this.db.close();
  }
}
