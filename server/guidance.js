const navigationQuestions = new Set([
  'what is my next step',
  'what are my next steps',
  'what is my next task',
  'what should i do next',
  'what do i do next',
  'what do i need to do next',
  'what is next on my plan',
  'what is next on my recovery plan',
  'show my next step',
  'show me my next step',
  'show my next steps',
]);

export function isNextStepQuestion(message) {
  if (typeof message !== 'string') return false;
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/^what['’]s\b/, 'what is')
    .replace(/[?!.]+$/, '')
    .trim()
    .replace(/\s+/g, ' ');
  return navigationQuestions.has(normalized);
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byTaskId = (a, b) => compare(a.taskId, b.taskId);
const dateLabels = {
  source: 'Date supported by a cited passage',
  human_clarification: 'Date supplied by human clarification, not the original passage',
  legacy: 'Existing plan date; review evidence not captured',
};
const validationReasons = {
  INVALID_SOURCE: 'invalid_source',
  PATIENT_SCOPE: 'invalid_source',
  UNSUPPORTED_SOURCE: 'historical_or_unsupported_source',
  INVALID_DATE: 'invalid_date',
  DATE_EVIDENCE_REQUIRED: 'invalid_date_evidence',
  UNSUPPORTED_DATE: 'invalid_date_evidence',
};
const reasonLabels = {
  help_requested: 'help requested; task paused',
  needs_clarification: 'awaiting care-team clarification',
  unsupported_status: 'task state requires review',
  invalid_source: 'source reference requires review',
  historical_or_unsupported_source: 'separate discharge instructions are required',
  invalid_date: 'recorded date requires review',
  invalid_date_evidence: 'deadline evidence requires review',
};

export function citationResolver(plan) {
  const documents = new Map(
    plan.documents.filter((d) => d.patientId === plan.patient.id).map((d) => [d.id, d]),
  );
  return function citation(reference) {
    if (typeof reference?.quote !== 'string' || reference.quote.length < 10) return null;
    const document = documents.get(reference.documentId);
    const section = document?.sections.find((s) => s.id === reference.sectionId);
    if (!section?.text.includes(reference.quote)) return null;
    return {
      documentId: document.id,
      sectionId: section.id,
      quote: reference.quote,
      documentTitle: document.title,
      heading: section.heading,
      kind: document.kind,
      page: section.page,
      provenance: section.provenance || null,
    };
  };
}

// Derive guidance from one scoped plan snapshot. The store supplies its existing
// source/date validation rules; this module never writes or infers clinical facts.
export function buildGuidance(plan, validateTask) {
  const citation = citationResolver(plan);
  const datedTasks = [];
  const undatedTasks = [];
  const blockedTasks = [];
  const counts = { completed: 0, rejected: 0 };
  for (const task of plan.tasks) {
    if (task.patientId !== plan.patient.id) continue;
    const closed = ['completed', 'rejected'].includes(task.status);
    if (closed) counts[task.status]++;
    if (closed && !task.helpRequestedAt) continue;

    const original = citation(task.source);
    const effective = citation(task.instruction ?? task.source);
    const item = { taskId: task.id, revision: task.revision, title: task.title };
    const reasons = [];
    if (task.helpRequestedAt) reasons.push('help_requested');
    if (task.status === 'needs_clarification') reasons.push('needs_clarification');
    if (!['pending', 'needs_clarification', 'completed', 'rejected'].includes(task.status))
      reasons.push('unsupported_status');
    if (!original || !effective) reasons.push('invalid_source');
    if (!reasons.length) {
      try {
        validateTask(task);
      } catch (error) {
        const reason = validationReasons[error.code];
        if (!reason) throw error;
        reasons.push(reason);
      }
    }
    if (reasons.length) {
      blockedTasks.push({ ...item, reasons, source: effective || original });
      continue;
    }

    const due = task.due ?? null;
    const projected = {
      ...item,
      due,
      dateState: due === null ? null : due < plan.demoDate ? 'overdue' : due === plan.demoDate ? 'due_today' : 'upcoming',
      dateEvidence: task.dateEvidence ?? null,
      dateLabel: due === null ? 'No deadline established' : dateLabels[task.dateEvidence?.kind] || dateLabels.legacy,
      source: effective,
      dateSource: task.dateEvidence?.kind === 'source' ? citation(task.dateEvidence.source) : null,
    };
    (due === null ? undatedTasks : datedTasks).push(projected);
  }
  datedTasks.sort((a, b) => compare(a.due, b.due) || byTaskId(a, b));
  undatedTasks.sort(byTaskId);
  blockedTasks.sort(byTaskId);
  const nextTask = datedTasks[0] || null;
  const outcome = nextTask
    ? 'next_dated_task'
    : undatedTasks.length
      ? 'undated_tasks'
      : blockedTasks.length
        ? 'needs_attention'
        : 'no_open_tasks';
  const heading = nextTask?.title || {
    undated_tasks: 'Open tasks without a deadline',
    needs_attention: 'Your plan needs attention',
    no_open_tasks: 'No open tasks in this plan',
  }[outcome];
  const summary = nextTask
    ? 'Selected by the earliest recorded deadline among open, unpaused tasks, not by medical urgency.'
    : {
        undated_tasks: 'These tasks have no established deadline. No date has been inferred.',
        needs_attention: 'Items are paused or need care-team clarification or source review before they can be selected.',
        no_open_tasks: 'This describes checklist status, not medical recovery. Completion is patient-reported.',
      }[outcome];
  return {
    asOf: plan.demoDate,
    outcome,
    heading,
    summary,
    nextTask,
    datedTasks,
    undatedTasks,
    blockedTasks,
    counts,
  };
}

export function guidanceAnswer(guidance) {
  const citations = [];
  const lines = [];
  function cite(source) {
    if (!source) return;
    let index = citations.findIndex((c) =>
      c.documentId === source.documentId && c.sectionId === source.sectionId && c.quote === source.quote,
    );
    if (index >= 0) return;
    index = citations.push(source) - 1;
    lines.push(`[${index + 1}] ${source.quote}`);
    lines.push(`Source: ${source.documentTitle} → ${source.heading} (${source.sectionId}).`);
    if (source.kind === 'synthea') lines.push('Historical context only; this is not a discharge instruction.');
  }
  const next = guidance.nextTask;
  if (next) {
    lines.push(`Your next dated task is: ${next.title}.`);
    const state = { overdue: 'overdue', due_today: 'due on the scenario date', upcoming: 'upcoming' }[next.dateState];
    lines.push(`Recorded deadline: ${next.due} (${state} as of ${guidance.asOf}).`);
    lines.push(`${next.dateLabel}.`);
    cite(next.source);
    cite(next.dateSource);
  } else {
    lines.push(guidance.heading + '.');
    const items = guidance.outcome === 'undated_tasks' ? guidance.undatedTasks : guidance.blockedTasks;
    for (const item of items.slice(0, 3)) {
      const state = item.reasons ? item.reasons.map((r) => reasonLabels[r]).join('; ') : 'no deadline established';
      lines.push(`${item.title}: ${state}.`);
      cite(item.source);
    }
    if (items.length > 3) lines.push('More items are available in your recovery checklist.');
  }
  lines.push(guidance.summary);
  if (guidance.undatedTasks.length || guidance.blockedTasks.length)
    lines.push(`Also visible in your plan: ${guidance.undatedTasks.length} open task(s) without a deadline; ${guidance.blockedTasks.length} item(s) awaiting help or review.`);
  lines.push('Plan guidance uses your current saved task states. No model was used and no action was taken.');
  return { answer: lines.join('\n\n'), citations };
}
