# Evaluation evidence: Homeward

> Historical evaluation-tooling run. For the latest merged-version browser checks
> and authorized live attempt, see [Integrated main](integrated-main/README.md).

Assessed base commit: `0ce9dad2a4a9dfd4815cad0a742fb46baa29bad5` on `test/live-agent-evaluations`.
Evaluation changes are uncommitted relative to that base; deterministic and live
reports include dirty status and content hashes of evaluated files. These hashes,
not the base SHA alone, identify the evaluation implementation.

| Evidence                      | Actual result                                      | Artifact                                             |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Baseline `npm run check`      | 40 Node + 2 DOM tests passed; build passed         | [Log](baseline-check.txt), [metadata](baseline.json) |
| Baseline `npm run eval`       | 21/21 passed                                       | [Log](baseline-eval.txt)                             |
| Final `npm run check`         | 44 Node + 2 DOM tests passed; build passed         | [Log](final-check.txt)                               |
| Final `npm run eval`          | 22/22 passed                                       | [JSON](deterministic.json), [log](deterministic.txt) |
| Runtime outage                | One injected HTTP 503 trial passed, no model used  | [Preflight JSON](live-preflight.json)                |
| Actual model trials           | 0 completed; 10 scenarios not run; 0 paid requests | [Preflight JSON](live-preflight.json)                |
| Human-reviewed model answers  | 0                                                  | Await authorized trials                              |
| High-risk consistency repeats | 0                                                  | Budget not authorized                                |

Deterministic evaluation timestamp: `2026-09-19T22:04:36.493Z`.
Preflight timestamp: `2026-09-19T22:04:39.732Z`.
Model identifier: **none**. TrueForge was reachable but returned an empty model
list. Session IDs, live tool calls, token/cost metrics, and model answers do not
exist for the omitted trials. No live pass rate can be calculated.

## Demo-sized summary

> Homeward passed 44 Node tests, 2 DOM tests, and the production build;
> 22 isolated evaluation cases passed. The evaluation recorder was tested with
> a simulated runtime and an actual MCP exchange. A separate outage trial verified
> an unavailable response with unchanged state. Live-agent reliability remains
> unmeasured: no model was configured and no paid trial budget was authorized.

## Scope and reproducibility

See [protocol and matrix](../LIVE-EVALUATIONS.md) for prompts, allowed/prohibited
tools, expected state, source requirements, failure criteria, and commands.
See [owner handoff](../EVALUATION-HANDOFF.md) for the readiness questions to relay.
Existing feature-owner tests were reused without editing them. The care-team UI
commit was verified on the remote branch and as an ancestor of this base before
the integrated check.

No backend/model failure was observed in the completed deterministic checks.
This does not establish live model safety or consistency. The current live blocker
is configuration plus authorization; no repeated unsuccessful paid calls were made.
All captured records are synthetic; the working demo database was not reset.
