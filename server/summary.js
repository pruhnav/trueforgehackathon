import { createHash } from 'node:crypto';
import { citationResolver } from './guidance.js';

const sectionDefinitions = [
  ['ready', 'Your recorded next steps', 'Open instructions in your plan. Dates are shown only when established.'],
  ['attention', 'Questions and help needed', 'These items need clarification, help, or source review.'],
  ['completed', 'Reported complete', 'Completion is patient-reported, not proof of clinical recovery.'],
  ['rejected', 'Retained in history', 'These items are not active instructions.'],
  ['unreviewed', 'Source passages awaiting review', 'Reading a passage does not add or approve a task.'],
  ['historical', 'Historical context', 'Historical records are not discharge orders or verified medication directions.'],
];

export function clinicalSnapshotVersion(plan) {
  return createHash('sha256').update(JSON.stringify({ patient: plan.patient, tasks: plan.tasks, documents: plan.documents })).digest('hex');
}

export function buildDischargeSummary(plan) {
  const cite = citationResolver(plan);
  const sections = sectionDefinitions.map(([id, label, description]) => ({ id, label, description, items: [] }));
  const groups = Object.fromEntries(sections.map((section) => [section.id, section.items]));
  const eligible = new Map([...plan.guidance.datedTasks, ...plan.guidance.undatedTasks].map((t) => [t.taskId, t]));
  const blocked = new Map(plan.guidance.blockedTasks.map((t) => [t.taskId, t]));
  const covered = new Set();
  for (const task of plan.tasks) {
    if (task.patientId !== plan.patient.id) continue;
    const original = cite(task.source);
    const source = cite(task.instruction ?? task.source);
    for (const ref of [original, source]) {
      if (ref) covered.add(JSON.stringify([ref.documentId, ref.sectionId]));
    }
    const ready = eligible.get(task.id);
    const needsAttention = blocked.get(task.id);
    const group = needsAttention ? 'attention' : task.status === 'completed' ? 'completed' : task.status === 'rejected' ? 'rejected' : ready ? 'ready' : 'attention';
    const gaps = [];
    if (task.due == null && !['completed', 'rejected'].includes(task.status)) gaps.push('No deadline established');
    if (needsAttention?.reasons.includes('needs_clarification')) gaps.push('Care-team clarification is needed');
    if (task.helpRequestedAt) gaps.push('Help requested; this task is paused');
    if (needsAttention?.reasons.some((r) => !['needs_clarification', 'help_requested'].includes(r))) gaps.push('Source or date evidence requires review');
    groups[group].push({
      id: task.id,
      recordType: 'task',
      revision: task.revision,
      title: task.title,
      status: task.status,
      meaning: sectionDefinitions.find(([id]) => id === group)[2],
      instruction: (source || original)?.quote ?? null,
      source: source || original,
      originalSource: original,
      due: ready?.due ?? null,
      dateLabel: ready?.dateLabel ?? 'No actionable deadline shown for this item',
      dateSource: ready?.dateSource ?? null,
      gaps,
    });
  }
  groups.ready.sort((a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.id.localeCompare(b.id));

  let sourceCards = 0;
  let omittedSourcePassages = 0;
  for (const doc of plan.documents) {
    if (doc.patientId !== plan.patient.id) continue;
    for (const section of doc.sections) {
      if (covered.has(JSON.stringify([doc.id, section.id]))) continue;
      if (sourceCards >= 24) { omittedSourcePassages++; continue; }
      const source = cite({ documentId: doc.id, sectionId: section.id, quote: section.text });
      if (!source) continue;
      const historical = doc.kind === 'synthea' || doc.trustClass === 'synthetic_record';
      const group = historical ? 'historical' : 'unreviewed';
      sourceCards++;
      groups[group].push({
        id: `source:${doc.id}:${section.id}`,
        recordType: 'source',
        title: section.heading,
        status: historical ? 'historical' : 'unreviewed',
        meaning: sectionDefinitions.find(([id]) => id === group)[2],
        instruction: source.quote,
        source,
        originalSource: source,
        due: null,
        dateLabel: 'No task deadline established from this passage',
        dateSource: null,
        gaps: [],
      });
    }
  }
  return {
    patientId: plan.patient.id,
    patientName: plan.patient.name,
    dischargedAt: plan.patient.dischargedAt,
    asOf: plan.demoDate,
    synthetic: true,
    version: plan.snapshotVersion || clinicalSnapshotVersion(plan),
    guidance: plan.guidance,
    sections,
    omittedSourcePassages,
    note: 'A source-linked overview of saved records, not a new prescription or a clinical assessment. General education remains separate.',
  };
}

export function summaryAnswer(summary) {
  const citations = [];
  const lines = ['Your discharge summary, explained through your saved records.', summary.guidance.summary];
  for (const section of summary.sections) {
    if (!section.items.length) continue;
    lines.push(`${section.label} (${section.items.length})`);
    for (const item of section.items.slice(0, 3)) {
      lines.push(`${item.title}: ${item.status.replaceAll('_', ' ')}.`);
      if (item.due) lines.push(`Recorded deadline: ${item.due}. ${item.dateLabel}.`);
      if (item.gaps.length) lines.push(item.gaps.join('. ') + '.');
      for (const source of [item.source, item.dateSource].filter(Boolean)) {
        const duplicate = citations.findIndex((c) => c.documentId === source.documentId && c.sectionId === source.sectionId && c.quote === source.quote);
        if (duplicate >= 0) continue;
        citations.push(source);
        lines.push(`[${citations.length}] ${source.quote}`);
      }
    }
    if (section.items.length > 3) lines.push('Open My discharge summary to see the other items.');
  }
  if (!summary.sections.some((s) => s.items.length)) lines.push('No source-linked items are available in this plan.');
  if (summary.omittedSourcePassages) lines.push(`${summary.omittedSourcePassages} additional passages remain available in My documents.`);
  lines.push(summary.note);
  return { answer: lines.join('\n\n'), citations };
}
