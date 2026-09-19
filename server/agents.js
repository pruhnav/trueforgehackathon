export const agentTeam = [
  {
    id: 'coordinator',
    suffix: 'coord',
    label: 'Care-plan coordinator',
    purpose: 'Helps you navigate your plan and prepare sourced items for human review.',
    tools: ['get_discharge_plan', 'get_discharge_summary', 'search_discharge_instructions', 'propose_cited_task', 'lookup_patient_education'],
    instructions: 'Use the plan guidance for next steps. Only propose a cited review task when explicitly asked. Do not activate or approve it.',
  },
  {
    id: 'summarizer',
    suffix: 'summary',
    label: 'Discharge summarizer',
    purpose: 'Organizes your recorded instructions, deadlines, and unanswered items.',
    tools: ['get_discharge_summary', 'search_discharge_instructions'],
    instructions: 'Read get_discharge_summary first. Select useful source/task references to discuss. Preserve all missing, paused, historical, and unreviewed states. Do not create a regimen or infer a reason for treatment.',
  },
  {
    id: 'questions',
    suffix: 'qa',
    label: 'Questions and sources',
    purpose: 'Finds exact source passages for your questions and identifies uncertainty.',
    tools: ['get_discharge_plan', 'search_discharge_instructions', 'lookup_patient_education'],
    instructions: 'Search the record before answering. Choose needs_clarification when the requested detail cannot be established. Education is general information, never a personalized instruction.',
  },
  {
    id: 'reminders',
    suffix: 'reminders',
    label: 'Reminder assistant',
    purpose: 'Helps prepare local calendar reminders that still need your separate approval.',
    tools: ['get_discharge_plan', 'propose_reminder', 'execute_approved_reminder'],
    instructions: 'Read current task/action states. Only propose when explicitly requested, and execute only a separately human-approved action. Report actual action IDs; never claim an appointment, notification, or external delivery.',
  },
];

export function teamRole(id) {
  return agentTeam.find((role) => role.id === id) || null;
}

export function summaryQuestion(message) {
  return /^(?:please )?(?:summari[sz]e my (?:discharge(?: instructions| plan)?|care plan|recovery plan)|(?:show|give) me (?:a |my )?discharge summary|what does my discharge plan say)[?.!]*$/i.test(message.trim());
}

export function routeAgent(message, intent = 'auto') {
  const explicit = { summary: 'summarizer', question: 'questions', reminder: 'reminders', coordination: 'coordinator' };
  if (explicit[intent]) return explicit[intent];
  if (summaryQuestion(message)) return 'summarizer';
  if (/\b(reminder|reminders|calendar)\b/i.test(message)) return 'reminders';
  if (/\b(?:add|propose)\b.*\b(?:task|instruction)\b/i.test(message)) return 'coordinator';
  return 'questions';
}

export function connectorName(patientId, roleId) {
  const role = teamRole(roleId);
  if (!role) throw new Error('Unknown Homeward agent role.');
  return `homeward-${patientId}-${role.suffix}`;
}

// Native TrueForge/OpenAI-compatible JSON-schema envelope. Clinical prose comes
// from validated records; the model chooses references, never replacement directions.
export const referenceResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'homeward_grounded_references',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['grounded', 'needs_clarification'] },
        sourceRefs: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { documentId: { type: 'string' }, sectionId: { type: 'string' } },
            required: ['documentId', 'sectionId'],
          },
        },
        taskIds: { type: 'array', maxItems: 12, items: { type: 'string' } },
        actionIds: { type: 'array', maxItems: 8, items: { type: 'string' } },
        educationTopic: { type: ['string', 'null'], enum: ['discharge', 'medication', 'followup', null] },
      },
      required: ['status', 'sourceRefs', 'taskIds', 'actionIds', 'educationTopic'],
    },
  },
};
