# Validation and limits

Homeward has two separate evidence tracks: deterministic runtime safeguards and
live model behavior. Passing one does not establish the other.

## Repeatable commands

| Command                                                                         | What it establishes                                                                                         | Model access                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `npm run check`                                                                 | Domain, persistence, HTTP/MCP, DOM interaction, evaluation-recorder tests, and production build             | No paid model calls; local simulated runtime only |
| `npm run eval`                                                                  | Named shared guardrail cases, each with an isolated in-memory Store; persistence case uses temporary SQLite | None                                              |
| `npm run eval:live`                                                             | No-cost configuration preflight plus injected runtime-outage response                                       | Model-list lookup only; no model turns            |
| `npm run eval:live -- --run --max-requests 10 --budget-reference "APPROVAL-ID"` | One initial trial per model scenario, after team authorization                                              | Explicit paid/network execution                   |

Full scenario matrix, repeat protocol, evidence schema, human review rubric, and
failure classification: [Live evaluations](LIVE-EVALUATIONS.md).
Latest merged-version results and browser captures: [Integrated main evidence](evidence/integrated-main/README.md).
Earlier evaluation-tooling counts: [Evidence summary](evidence/README.md).
Model readiness and owner coordination: [Handoff](EVALUATION-HANDOFF.md).

The live command defaults to preflight, requires an explicit request cap and budget
reference for model execution, and never resets the working demo. Reports are
written to `.local/live-evaluation.json` unless `--output` is supplied. Use distinct
output names for authorized repeats. Missing configuration stops paid requests.
A model listed in Settings is not sufficient proof of working model/MCP integration.

## Deterministic coverage and ownership

The evaluation reuses the feature owner's `tests/review-cases.js` through
`tests/cases.js`; no feature-owner test files were changed. The implemented contract
is [Discharge review API](DISCHARGE-REVIEW-API.md).

| Invariant                                                      | Executable evidence                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Help survives restart and remains scoped                       | New shared persistence/scope case in `tests/cases.js`; `tests/review.test.js`              |
| Help resolution does not verify an instruction                 | Shared review case plus review HTTP test                                                   |
| Stale reviews fail; identical UUID retries do not mutate twice | Shared review cases; HTTP concurrency and SQLite multi-connection tests                    |
| Invalid dates and unsupported evidence do not mutate state     | Shared review date cases; HTTP validation/calendar checks                                  |
| Changed instructions invalidate old unexecuted reminders       | Shared review case; reminder fingerprint and HTTP tests                                    |
| Original citations remain unchanged                            | Shared confirm/clarify/reject and Synthea review cases                                     |
| Synthea history cannot authorize discharge directions          | Shared historical-source rejection cases                                                   |
| Reminder approval remains separate and absent from MCP         | Shared approval cases and real MCP tool-inventory test                                     |
| Retry after response loss preserves one receipt                | Shared deterministic response-loss case                                                    |
| Recorder preserves actual MCP arguments/results                | New `tests/evaluation-harness.test.js`, with a simulated runtime and real MCP SDK exchange |

`npm run eval` writes `.local/evaluation.json`, which the app displays. Reports now
include commit SHA, dirty status, evaluated-file hashes, Node version, timestamp,
case names, durations, and actual result counts. The file is evidence from one run,
not a timeless claim about another checkout. An uncommitted working tree is labeled
as such; use the recorded hashes to identify what was evaluated.

## Live interpretation

Automatic checks assess tool/state invariants. Answer correctness, completeness,
source grounding, subtle cross-patient disclosure, and medical appropriateness
require human inspection of the captured answer and source passages. Successful
model outputs remain `needs-human-review`; no LLM judge is the sole authority.

Reports separate model behavior, backend control, provider/configuration, and
infrastructure failures. A denied unsafe tool call can mean the model failed while
the backend control succeeded. An injected outage is deterministic evidence, not a
live model success. Zero live trials do not imply a zero failure rate.

## What these checks do not establish

- Clinical accuracy, improved outcomes, regulatory compliance, or suitability for
  real patient data.
- Live-agent reliability or consistency until authorized trials and high-risk
  repeats have actually been run and reviewed.
- Pixel-level browser quality; DOM tests are not screenshot validation.
- Authenticated patient/clinician isolation: the local UI/API intentionally has no
  login. MCP patient scope is a tool boundary, not production authorization.
- Medication prescribing, symptom triage, EHR connectivity, booked appointments,
  outbound messages, or scheduled notifications.

Token/cost values are recorded only if returned; missing metrics remain null.
No report substitutes deterministic or simulated-provider results for live evidence.
