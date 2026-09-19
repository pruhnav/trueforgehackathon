# Care-team review UI handoff

Branch: `feat/care-team-review-ui`

## What changed

- Care team now includes a Review & respond queue: attention, open help, instruction review, and all tasks/history filters.
- Queue entries show patient, task, reason, latest available timestamp, and an exact-source entry point. Missing historical timestamps are labeled; the list is not a clinical priority ranking.
- Review dialogs show immutable original evidence separately from the effective instruction and human-entered decisions. They support confirm, clarify, reject, unknown deadlines, explicit source dates, human clarification, and selecting a separately documented instruction.
- Help responses can leave requests open or explicitly resolve them. Responses and audit history appear on patient task cards. Patient withdrawal has distinct wording and retains its own audit event.
- Rejected tasks cannot be completed or scheduled. Resolving help preserves any instruction-review gate. Stale reminders expose re-proposal instead of approval/execution.
- The 60/40 workspace and collapsible navigation remain. New forms/queue wrap on narrow screens, preserve keyboard focus, and retain input after recoverable failures.

## Demo

1. In My recovery, request help on Alex's laboratory clarification task.
2. Open Care team, choose Open help requests, and View exact source.
3. Enter a response and save with Respond and leave open. Then enter a resolution response and choose Respond and resolve help request.
4. Return to My recovery: read the saved local response/history. Completion must remain disabled because the instruction still needs clarification.
5. Import synthetic text: `Contact the discharge team by September 26, 2026 to discuss your paperwork.` Add its passage for care-team review.
6. Open that task in the queue. Choose Confirm as an actionable task, Explicit date in a source passage, September 26, 2026, and a review note. Save.
7. The task can now be completed or separately proposed for a reminder. Human task review does not grant reminder approval.
8. All tasks & history also exposes previously reviewed/rejected tasks for further explicit review.

## Contract and recovery

Uses only the existing v1 endpoints in DISCHARGE-REVIEW-API.md. No backend or MCP changes.

Review commands retain a UUID for an identical retry, bind expectedRevision, and always refetch after success/replay. Conflicts block submission until explicit reload; notes and selected inputs are retained for comparison against current data. A failed post-save refresh is labeled as saved-but-not-refreshed. No outbound delivery is implied.

The small demo queue loads patient plans and task histories using existing endpoints. A paginated server-side queue would be a future scaling improvement, not a dependency for this synthetic cohort.

## Validation

- `npm run check`: 40 backend/contract tests plus 2 real-backend React DOM journeys passed; production build passed.
- `npm run eval`: 21/21 deterministic checks passed.
- New journey covers help handoff/resolution, exact source, patient response, preserved clarification gate, network response loss and retry deduplication, invalid deadline evidence, stale revisions with retained notes, source-supported and human-clarified deadlines, rejected tasks, stale reminders/re-proposal, queue outage/retry, empty filter, source modal Escape/focus restoration, and Synthea requiring separate instructions with no inferred date.
- No connected browser surface was available (`apps: [], browsers: []`). No screenshots or pixel-level responsive verification are claimed. A teammate should inspect laptop, narrow-screen, and presentation widths in a real browser.
- No unresolved backend contract dependencies. Existing local-demo identity and clinical-validation limitations remain.
