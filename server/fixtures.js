// Explicitly fictional instructions for a software demonstration, not a treatment template.
export const DEMO_DATE = '2026-09-19';
export const patients = [
  {
    id: 'demo-001',
    name: 'Alex Morgan',
    initials: 'AM',
    age: 42,
    condition: 'Recovery after a hospital stay',
    dischargedAt: DEMO_DATE,
    clinician: 'Dr. Maya Chen',
    hospital: 'Willow Creek Medical · fictional',
    color: 'sage',
  },
  {
    id: 'demo-002',
    name: 'Jordan Rivera',
    initials: 'JR',
    age: 58,
    condition: 'Follow-up coordination',
    dischargedAt: '2026-09-17',
    clinician: 'Dr. Maya Chen',
    hospital: 'Willow Creek Medical · fictional',
    color: 'peach',
  },
  {
    id: 'demo-003',
    name: 'Sam Taylor',
    initials: 'ST',
    age: 36,
    condition: 'Recovery check-in',
    dischargedAt: '2026-09-18',
    clinician: 'Dr. Eli Park',
    hospital: 'Willow Creek Medical · fictional',
    color: 'lavender',
  },
];
export function fixtures() {
  return patients.map((patient, i) => {
    const sections =
      i === 0
        ? [
            [
              'Follow-up appointment',
              'Arrange a follow-up visit with Dr. Maya Chen within seven days of discharge. Call the clinic if you need help arranging the visit.',
            ],
            [
              'Paperwork',
              'Bring your discharge summary and current medication list to the follow-up visit.',
            ],
            [
              'Recovery check-in',
              'Complete the recovery check-in on September 21, 2026. Record any questions you want to discuss with your care team.',
            ],
            [
              'Instructions to clarify',
              'The discharge note mentions a repeat laboratory test, but does not specify the test or a date. Contact the discharge team for clarification before arranging it.',
            ],
          ]
        : i === 1
          ? [
              [
                'Follow-up appointment',
                'Contact your care team by September 18, 2026 to arrange your follow-up visit.',
              ],
              ['Paperwork', 'Bring your discharge summary to your next visit.'],
            ]
          : [
              ['Follow-up appointment', 'Arrange a follow-up visit by September 25, 2026.'],
              [
                'Paperwork',
                'Prepare a list of questions for your care team before your next visit.',
              ],
            ];
    const document = {
      id: `doc-${patient.id}`,
      patientId: patient.id,
      title: 'Discharge summary',
      kind: 'synthetic',
      importedAt: new Date().toISOString(),
      sections: sections.map(([heading, text], n) => ({ id: `s${n + 1}`, heading, text, page: 1 })),
    };
    const dates =
      i === 0
        ? ['2026-09-26', null, '2026-09-21', null]
        : i === 1
          ? ['2026-09-18', null]
          : ['2026-09-25', null];
    const titles =
      i === 0
        ? [
            'Arrange your follow-up visit',
            'Gather your visit paperwork',
            'Complete your recovery check-in',
            'Clarify the laboratory instructions',
          ]
        : i === 1
          ? ['Contact your care team', 'Gather your visit paperwork']
          : ['Arrange your follow-up visit', 'Prepare questions for your care team'];
    const tasks = document.sections.map((section, n) => ({
      id: `${patient.id}-task-${n + 1}`,
      patientId: patient.id,
      title: titles[n],
      detail: section.text,
      category:
        n === 0 ? 'appointment' : n === 1 ? 'preparation' : n === 2 ? 'check-in' : 'clarification',
      due: dates[n],
      status: n === 3 ? 'needs_clarification' : i === 2 && n === 1 ? 'completed' : 'pending',
      source: { documentId: document.id, sectionId: section.id, quote: section.text },
      completedAt: null,
    }));
    return { patient, document, tasks };
  });
}
