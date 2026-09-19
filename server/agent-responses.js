import { z } from 'zod';
import { AppError } from './store.js';
import { citationResolver } from './guidance.js';
import { summaryAnswer } from './summary.js';
import { teamRole } from './agents.js';
import { lookupEducation } from './education.js';

const responseSchema = z.object({
  status: z.enum(['grounded', 'needs_clarification']),
  sourceRefs: z.array(z.object({ documentId: z.string().min(1), sectionId: z.string().min(1) }).strict()).max(8),
  taskIds: z.array(z.string().min(1)).max(12),
  actionIds: z.array(z.string().min(1)).max(8),
  educationTopic: z.enum(['discharge', 'medication', 'followup']).nullable(),
}).strict();

export async function groundedResponse(store, patientId, raw, roleId, summary) {
  let selected;
  try {
    selected = responseSchema.parse(JSON.parse(raw));
  } catch {
    throw new AppError('The model response could not be verified against the record.', 502, 'UNVERIFIED_AGENT_OUTPUT');
  }
  const role = teamRole(roleId);
  const plan = store.plan(patientId);
  const cite = citationResolver(plan);
  const citations = [];
  const addCitation = (source) => {
    if (source && !citations.some((c) => c.documentId === source.documentId && c.sectionId === source.sectionId && c.quote === source.quote)) citations.push(source);
  };
  try {
    for (const ref of selected.sourceRefs) {
      const document = store.scoped('document', ref.documentId, patientId);
      const section = document.sections.find((s) => s.id === ref.sectionId);
      const source = section && cite({ ...ref, quote: section.text });
      if (!source) throw new Error('Missing source');
      addCitation(source);
    }
    for (const taskId of selected.taskIds) store.scoped('task', taskId, patientId);
    for (const actionId of selected.actionIds) store.scoped('action', actionId, patientId);
    if (selected.actionIds.length && roleId !== 'reminders') throw new Error('Role cannot report actions');
    if (selected.educationTopic && !role.tools.includes('lookup_patient_education')) throw new Error('Role cannot look up education');
  } catch {
    throw new AppError('The model selected an unavailable or out-of-scope reference.', 502, 'UNVERIFIED_AGENT_OUTPUT');
  }

  const cards = summary.sections.flatMap((section) => section.items);
  const tasks = [...new Set(selected.taskIds)].map((id) => cards.find((card) => card.recordType === 'task' && card.id === id));
  for (const task of tasks) {
    addCitation(task?.source);
    addCitation(task?.dateSource);
  }
  if (selected.status === 'grounded' && !citations.length && !selected.actionIds.length && !selected.educationTopic)
    throw new AppError('The model supplied no verifiable evidence.', 502, 'UNVERIFIED_AGENT_OUTPUT');

  if (roleId === 'summarizer') {
    return { ...summaryAnswer(summary), summary, focusTaskIds: selected.taskIds, answerType: 'discharge_summary' };
  }
  const lines = [selected.status === 'needs_clarification'
    ? 'I could not establish the requested detail from your saved instructions. Ask your care team to clarify.'
    : `Here is what your saved records show, selected by ${role.label.toLowerCase()}.`];
  for (const task of tasks) {
    lines.push(`${task.title}: ${task.status.replaceAll('_', ' ')}. ${task.meaning}`);
    if (task.due) lines.push(`Recorded deadline: ${task.due}. ${task.dateLabel}.`);
    if (task.gaps.length) lines.push(task.gaps.join('. ') + '.');
  }
  for (const [i, source] of citations.entries()) {
    lines.push(`[${i + 1}] ${source.quote}`);
    lines.push(`Source: ${source.documentTitle} → ${source.heading} (${source.sectionId}).`);
    if (source.kind === 'synthea') lines.push('Historical context only, not verified discharge directions.');
    else if (source.kind === 'imported') lines.push('Imported source passage; task review and approval remain separate.');
  }
  for (const id of [...new Set(selected.actionIds)]) {
    const action = plan.actions.find((a) => a.id === id);
    const state = action.stale ? 'needs a new proposal because the task changed'
      : { proposed: 'awaiting your separate approval', approved: 'approved but not yet created', executed: `created locally; receipt ${action.receipt}`, rejected: 'declined' }[action.status];
    lines.push(`Reminder “${action.title}”: ${state}. No appointment was booked or external message sent.`);
  }
  if (roleId === 'reminders' && !selected.actionIds.length)
    lines.push('No reminder receipt is being reported. Review reminder states in your plan before retrying an action.');
  let education;
  if (selected.educationTopic) {
    education = await lookupEducation(selected.educationTopic);
    lines.push('General education: the linked MedlinePlus resources do not change your discharge instructions.');
  }
  return {
    answer: lines.join('\n\n'), citations, answerType: 'grounded_answer',
    ...(education ? { education } : {}),
  };
}
