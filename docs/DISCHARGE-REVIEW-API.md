# Discharge instruction review API — v1

**Status: implemented backend contract, approved by the user on the team's behalf.**
Person 3's frontend handoff is this document; direct contact was unavailable.

Backend branch: `feat/discharge-review-workflow`. Frontend owner: Person 3.
All examples are synthetic. The local demo has no authenticated reviewer identity.
These human UI/API operations are not MCP tools and do not establish clinical verification.

## Existing workflow and consumers

1. `POST /api/patients/:id/documents` imports text/PDF into immutable searchable passages.
2. `POST /api/patients/:id/tasks/review` (despite its name) only **proposes** a task:
   `{ documentId, sectionId, quote }` -> task with `status: needs_clarification`, `due: null`.
   `propose_cited_task` in MCP uses the same store operation.
3. Before this change, that task could not be completed or scheduled and there was
   no resolution endpoint. The new review endpoints below close that gap.
4. `POST /api/patients/:id/reminders` proposes a local reminder for a pending dated task.
   Existing action approval and execution endpoints remain separate.

Status/date/source readers that need to remain compatible:

- `server/store.js`: plan/search, task proposal/deduplication, completion, help,
  reminder proposal, approval, execution, seeding and reset.
- `server/app.js`: patient summaries, plan/task/help/proposal endpoints and calendar export.
- `server/mcp.js`: plan/search/proposal/reminder tool handlers. No review/help-response tool.
- `server/trueforge.js`: sourced search output and instructions about paused help tasks.
- `src/App.jsx` (Person 3): next-task selection, task cards/completion/reminder buttons,
  source drawer, follow-up dates, care-team progress/attention, and action panels.
- `tests/cases.js`, `tests/domain.test.js`, `tests/http.test.js`,
  `tests/synthea-help.test.js`, `tests/ui.test.jsx`; `scripts/evaluate.js` runs domain cases.

## Added task fields (v1)

Existing task IDs, `detail`, and `source` are retained. `source.quote` is never rewritten.

```js
{
  // Existing fields ...
  status: 'pending' | 'completed' | 'needs_clarification' | 'rejected',
  revision: 1,             // increments on each effective task/help mutation
  instructionRevision: 1,  // increments on review and completion/reopen, not help flags
  instruction: null,      // or { documentId, sectionId, quote }: effective exact instruction
  dateEvidence: null,     // see below; due remains YYYY-MM-DD or null
  lastReviewId: null,
  helpRequestId: null,    // UUID for the currently open help episode
  lastHelpAuditId: null
}
```

Frontend: use `task.instruction?.quote ?? task.detail` for the instruction, but keep
the original `task.source` reachable. Rejected tasks remain visible in history;
completion and reminder controls must be disabled. Only pending, dated, unpaused
tasks can propose reminders. A pending task with no deadline can be completed but
cannot have a reminder. Confirmation is local human review, not clinician authentication.

## New: review a task

`POST /api/patients/:id/tasks/:taskId/reviews`

All objects reject unknown fields. Every command requires:

| Field | Rule |
| --- | --- |
| `requestId` | UUID, retained for retries of the identical command |
| `expectedRevision` | Positive integer from the displayed task |
| `decision` | `confirm`, `clarify`, or `reject` |
| `note` | Trimmed nonempty explanation, at most 2,000 characters |

For `confirm`, also supply `due` and `dateEvidence` explicitly, even when null.
Optional `instructionSource` is an exact `{ documentId, sectionId, quote }` reference
(quote 10–1,800 characters). It defaults to the current effective instruction, then
the original task source. The server validates scope and exact passage membership.

| Decision | Result |
| --- | --- |
| `confirm` | `pending`; exact instruction saved separately; supplied supported due or null |
| `clarify` | `needs_clarification`; due/evidence cleared to null; prior instruction retained |
| `reject` | `rejected`; due/evidence cleared to null; source and instruction retained |

`clarify`/`reject` must omit `due`, `dateEvidence`, and `instructionSource`.
All reviews increment both revisions and reset `completedAt` to null. Completed
tasks must first be reopened through the existing completion endpoint. A rejected
task may be explicitly reviewed again with its current revision.
Reviews do not resolve open help requests or approve reminders.

### Deadline evidence

- `due: null` requires `dateEvidence: null`: no deadline established.
- An explicit date in a source uses:
  `{ kind: 'source', source: { documentId, sectionId, quote } }`.
  The exact cited passage must contain that date as `YYYY-MM-DD` or an unambiguous
  English month-name date, e.g. `September 26, 2026` or `Sep 26, 2026`.
  The source must be an instruction/clarification document, not Synthea history.
- A reviewer-established date uses:
  `{ kind: 'human_clarification', explanation: 'Synthetic discharge-team clarification ...' }`.
  The explanation must be nonempty (maximum 2,000 characters). This is stored as
  human-reported clarification, never attributed to the original document.
- Relative dates require explicit human clarification; the server never computes
  a deadline from phrases like “within seven days.”
- Validate real Gregorian dates, including leap years. Reject February 30,
  impossible months/days, timestamps, and locale-ambiguous numeric dates.
- Store/compare `YYYY-MM-DD` strings. Calendar export uses `VALUE=DATE` with a UTC
  next-calendar-day calculation; browser timezone must not change the deadline.

### Historical material

A Synthea document or an explicitly historical/synthetic-record trust class cannot
be the effective instruction or deadline source for confirmation. Import separately
documented synthetic discharge instructions/clarification through the existing
document endpoint and cite that passage as `instructionSource`. A review note or
date explanation alone does not convert historical content into an instruction.
Generic review never sets `clinician_verified`, creates a medication regimen, or
changes clinical directions. Unknown document kinds are rejected for confirmation.

### Examples

First use the existing import and proposal endpoints:

```http
POST /api/patients/demo-001/documents
Content-Type: application/json

{"title":"Fictional discharge addendum","text":"Contact the discharge team by September 26, 2026 to discuss your paperwork."}
```

```http
POST /api/patients/demo-001/tasks/review
Content-Type: application/json

{"documentId":"<returned-document-id>","sectionId":"s1","quote":"Contact the discharge team by September 26, 2026 to discuss your paperwork."}
```

Confirm with a source-supported date:

```http
POST /api/patients/demo-001/tasks/<returned-task-id>/reviews
Content-Type: application/json

{
  "requestId": "26ea3834-1c84-44ea-a2d9-94e0cb5b976c",
  "expectedRevision": 1,
  "decision": "confirm",
  "note": "Reviewed the fictional discharge addendum and its stated deadline.",
  "due": "2026-09-26",
  "dateEvidence": {
    "kind": "source",
    "source": {
      "documentId": "<returned-document-id>",
      "sectionId": "s1",
      "quote": "Contact the discharge team by September 26, 2026 to discuss your paperwork."
    }
  }
}
```

Other example request bodies (use a fresh UUID for each new decision):

```js
// Confirm with no deadline:
{ requestId: crypto.randomUUID(), expectedRevision: task.revision,
  decision: 'confirm', note: 'Instruction reviewed; no date is established.',
  due: null, dateEvidence: null }

// Human clarification of a deadline, distinct from document evidence:
{ requestId: crypto.randomUUID(), expectedRevision: task.revision,
  decision: 'confirm', note: 'Recorded a synthetic team clarification.',
  due: '2026-09-28', dateEvidence: { kind: 'human_clarification',
    explanation: 'The fictional discharge team supplied September 28, 2026 during review.' } }

// Keep awaiting clarification:
{ requestId: crypto.randomUUID(), expectedRevision: task.revision,
  decision: 'clarify', note: 'The specific follow-up instruction is still missing.' }

// Reject while retaining source/history:
{ requestId: crypto.randomUUID(), expectedRevision: task.revision,
  decision: 'reject', note: 'This passage is background context, not a patient task.' }
```

## New: human response to a help request

`POST /api/patients/:id/tasks/:taskId/help/responses`

```js
{
  requestId: crypto.randomUUID(),
  expectedRevision: task.revision,
  helpRequestId: task.helpRequestId,
  decision: 'respond', // or 'resolve'
  response: 'Recorded your question for the fictional local care-team review.'
}
```

`response` must be nonempty, at most 2,000 characters. `respond` records a response
while leaving help open. `resolve` records the response and clears the help flag
and active episode ID. Both increment `revision` only. Neither changes task status,
instruction, due, date evidence, or instruction revision. Thus resolving help on an
unverified task leaves it `needs_clarification`.

The existing `{ requested: true|false }` help endpoint remains compatible. Repeated
identical flags are no-ops. A new request gets a new episode ID; `false` is a patient
withdrawal, not a care-team resolution, and is audited accordingly. New requests
are blocked for completed/rejected tasks. Existing outstanding help can be withdrawn.

## Command responses, history, and concurrency

Both new POST endpoints return HTTP 200:

```js
{ task: { /* resulting complete task */ }, audit: { /* entry below */ }, replayed: false }
```

`GET /api/patients/:id/tasks/:taskId/history` returns:

```js
{ task: { /* current complete task */ }, history: [ /* oldest first */ ] }
```

- Commands use a SQLite `BEGIN IMMEDIATE` transaction for task mutation, audit,
  idempotency receipt, and trace. Any failure rolls back all four.
- Match `expectedRevision` before mutation. A stale screen gets HTTP 409 and must reload.
- Idempotency is scoped to patient + task + `requestId`, across both command endpoints.
- An identical retry returns the original task/audit snapshot with `replayed: true`,
  even after later task changes. It creates no second audit or revision. Refetch the
  plan/history after a replay; do not treat its historical snapshot as current state.
- Reusing a request ID for a different payload/operation returns HTTP 409.
- Any effective completion/help mutation also advances `revision`, preventing a
  stale review from overwriting a newer patient action.

### Audit shape

```js
{
  id: '<uuid>', patientId: 'demo-001', taskId: '<task-id>',
  event: 'review', // help_requested, help_withdrawn, help_response, help_resolved,
                   // task_completed, task_reopened
  decision: 'confirm',
  at: '<ISO timestamp>',
  actor: { kind: 'local_demo_operator', authenticated: false },
  requestId: '<uuid-or-null>',
  helpRequestId: null,
  previous: { /* complete task snapshot before mutation */ },
  resulting: { /* complete task snapshot after mutation */ },
  sourceReferences: [ /* original, effective, and date sources, where present */ ],
  note: 'Review explanation',
  response: null // human help response when applicable
}
```

The server assigns actor attribution. No freely entered name is accepted as an
authenticated reviewer. Patient flag/completion events use `local_demo_patient`,
also `authenticated: false`. Audit entries have no edit/delete endpoint. Audit
payloads are stored locally; operational traces contain IDs/outcomes, not notes or
source passages. The existing explicit demo reset remains a destructive demo reset.

### Errors

Existing `{ error: string }` remains; new workflow errors add a stable `code` and,
where appropriate, `currentRevision`.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Missing/unknown fields, wrong types, invalid command shape |
| 403 | `PATIENT_SCOPE` | Task/document belongs to another patient or is unavailable in scope |
| 404 | `PATIENT_NOT_FOUND` | Unknown patient |
| 409 | `REVISION_CONFLICT` | Reload; displayed revision is stale |
| 409 | `IDEMPOTENCY_CONFLICT` | Request ID reused for a different command |
| 409 | `STATE_CONFLICT` | Completed task or inactive/wrong help episode |
| 409 | `STALE_REMINDER` | Re-propose and separately approve against the current task |
| 422 | `INVALID_SOURCE` | Citation is not an exact passage |
| 422 | `UNSUPPORTED_SOURCE` | Historical/unknown source cannot authorize an instruction/date |
| 422 | `INVALID_DATE` | Not a real date-only calendar date |
| 422 | `DATE_EVIDENCE_REQUIRED` | Deadline/evidence mismatch |
| 422 | `UNSUPPORTED_DATE` | Cited passage does not explicitly contain the selected date |

Example conflict:

```json
{"error":"Task changed. Reload before submitting another decision.","code":"REVISION_CONFLICT","currentRevision":3}
```

## Reminder version binding

New action records capture `taskInstructionRevision` and a fingerprint of the
task's instruction, original source, title/detail, status, due, and date evidence.
Approval and execution check both, plus the active help flag and exact source
validity. Review or completion/reopen invalidates prior unexecuted proposals, even
if a task later returns to its old status/date. A new proposal requires new approval.

Help flags pause execution; clearing help permits resumption only if the instruction
revision and fingerprint are still unchanged. Proposals deduplicate only against a
matching current binding. Plan actions add `stale: boolean` for unexecuted actions;
Person 3 should suppress their approval/execute controls and offer re-proposal.
Executed receipts remain immutable and retries return the original receipt, including
after task changes. Already-downloaded calendars are not recalled.

## Upgrade behavior

On startup, transactionally add missing workflow fields to existing JSON task records
without resetting/reseeding existing data or changing sources, status, dates, help
timestamps, or completed actions. Initial revisions are 1; an existing active help
flag receives a persisted episode ID. Existing deadlines get `dateEvidence.kind:
'legacy'`, explicitly recording that review evidence was not captured. Do not invent
a reviewer or a historical review event.

Legacy unexecuted actions have no trustworthy task-version binding: retain them but
mark them stale in plan responses and require re-proposal/reapproval. Executed actions
and their receipts/calendar downloads continue to work. Migration is repeatable and
does not overwrite current workflow fields. New imports/proposals get fields immediately.

## Frontend coordination checklist

- Confirm endpoint names, decisions, strict request fields, and response envelope.
- Use UUID retry keys and the current task revision; reload on 409 or a replay.
- Show original source separately from any explicitly supplied effective instruction.
- Distinguish source dates, human clarification, and legacy evidence.
- Treat `rejected` as inactive; respect `actions[].stale`.
- Separate Respond/Resolve help from Confirm instruction and Approve reminder.
- Display local-demo attribution, never an authenticated-clinician badge.

## Implementation and verification

- Implementation: `server/store.js` and `server/app.js`.
- Shared evaluation/domain cases: `tests/review-cases.js`, included by `tests/cases.js`.
- Persistence, migration, rollback, source mutation, and multi-connection checks:
  `tests/review.test.js`.
- HTTP examples, invalid input, concurrency, help, actual MCP tool inventory, and
  leap-day calendar output under different server timezones: `tests/review-http.test.js`.
- Verified on this branch: `npm run check` passed 40 Node tests, the existing DOM
  interaction test, and the production build. `npm run eval` passed 21/21 cases.
- Main frontend files are owned by Person 3; the new review screens are a frontend
  integration task, not behavior established by the existing DOM test.
