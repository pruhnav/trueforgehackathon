# Next-step guidance: first safe slice

This slice implements the shared plan-navigation portion of the approved patient
journey. The existing care-team review UI and v1 review contract remain the write
authority. Guidance is a derived read; it creates no tasks, reviews, or reminders.

## Additive contract / frontend handoff

`GET /api/patients/:id/plan` and the existing patient-bound MCP tool
`get_discharge_plan({})` include the same additional `guidance` object:

```js
{
  asOf: '2026-09-19',
  outcome: 'next_dated_task', // undated_tasks | needs_attention | no_open_tasks
  heading: 'Complete your recovery check-in',
  summary: '...',
  nextTask: {
    taskId: 'demo-001-task-3',
    revision: 1,
    title: 'Complete your recovery check-in',
    due: '2026-09-21',
    dateState: 'upcoming', // overdue | due_today | upcoming
    dateEvidence: { kind: 'legacy', note: '...' },
    dateLabel: 'Existing plan date; review evidence not captured',
    source: { documentId, sectionId, quote, documentTitle, heading, kind, page },
    dateSource: null // validated citation when dateEvidence.kind === 'source'
  }, // null when no eligible dated task exists
  datedTasks: [], // all eligible dated tasks in the same deterministic order
  undatedTasks: [], // same task projection, with due/dateState null
  blockedTasks: [], // { taskId, revision, title, reasons: [...], source: citation | null }
  counts: { completed: 0, rejected: 0 }
}
```

The dashboard reads `guidance` rather than independently ordering tasks. The hero
opens the selected **effective instruction**; task-card controls still offer the
original source and the reviewed source separately.

Existing chat requests retain `{ message, mode: 'source-search' | 'live' }`.
Recognized plan-navigation questions return:

```js
{
  answer: '...',
  answerType: 'plan_guidance',
  mode: 'source-search', // actual execution path; no model was used
  metrics: null,
  citations: [/* exact validated passages used in this answer */],
  guidance: { /* same derived object as the plan */ }
}
```

This applies in either requested chat mode, so navigation works without a model.
The UI labels it **PLAN GUIDANCE**, not a live TrueForge answer. Other source-search
responses have `answerType: 'source_passages'`. Other live questions keep the
existing TrueForge session path. No request field, existing tool, or endpoint is
removed. No SQLite migration is needed.

## Selection and evidence rules

- Match a small whole-question allow-list, including “What is my next step?” and
  “What should I do next?” Case, whitespace, contractions, and trailing question
  punctuation may normalize. Additional clinical text, “next dose”, or instructions
  to change a task do not match this navigation route.
- Select only pending, unpaused tasks with valid original/effective citations.
- Use the current effective instruction, `task.instruction ?? task.source`.
  Historical/unsupported material alone cannot authorize an actionable step.
- Validate existing dates and source-backed date evidence through the store's
  existing rules. Order by recorded date, then task ID for deterministic ties.
  This is scheduling order, not medical urgency.
- Keep undated tasks separate and retain `due: null`; never derive dates from
  relative language. Label human clarification and legacy dates accurately.
- Show help/review/source/date blockers separately. Completed and rejected tasks
  are not next-step candidates. An empty/finished checklist does not establish
  medical recovery.
- All date comparisons use date-only strings and the existing scenario `demoDate`.
- Preserve exact quote punctuation and render deterministic excerpts as literal
  text, rather than interpreting source content as Markdown.
- Every request derives fresh guidance. Asking a question never proposes a reminder
  or records a clinical decision. Existing reminder approval and revision checks
  remain authoritative.

## TrueForge reuse / capability record

| Capability | Use in this slice |
| --- | --- |
| Patient-bound inline AgentSpec | Existing live-session architecture retained |
| `get_discharge_plan` | Returns shared guidance for navigation questions |
| `search_discharge_instructions` | Retained for specific document questions |
| Existing proposal/reminder/education tools | Retained with explicit role allow-lists; the later team extension adds the seventh, read-only summary tool |
| Sessions, turn polling, budgets, returned metrics | Existing live path retained |
| Local trace | Records guidance outcome/task ID/revision, not quoted passages |
| Structured model responses | Added by the subsequent agent-team extension; see AGENT-TEAM.md |
| Native question continuation | Later slice; not enabled |
| Dynamic subagents, sandbox, generative UI | No new capability enabled |

References consulted during planning:

- [TrueFoundry Agent Harness](https://www.truefoundry.com/docs/agent-platform/agent-harness/overview)
- [TrueForge AgentSpec and tool selection](https://trueforge.dev/create-agent/overview)
- [Native sessions and continuation](https://trueforge.dev/api/use-agent)
- [MCP connectors](https://trueforge.dev/mcp-servers)

No TrueForge configuration or credentials are changed by this slice. A mocked
adapter test verifies the spec; it is not evidence of a live model run or a guarantee
of general medical answer quality.

The subsequent team/summary extension is documented in [AGENT-TEAM.md](AGENT-TEAM.md).
Plan responses also include `snapshotVersion`, matching the recorded summary's
`version`, so the UI can label an older summary after records change.
