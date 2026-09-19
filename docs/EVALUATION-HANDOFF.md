# Evaluation handoff

Latest handoff: [merged app verification and credential failure](evidence/integrated-main/README.md).
The readiness and authorization observations below are from the earlier preflight.
The user subsequently approved three requests; one failed with an invalidated-key 401 and execution stopped.

## Send to Person 1: readiness and authorization

- Is the integration pushed? Which branch and commit?
- Which TrueForge version and exact model identifier work?
- Has `npm run smoke:trueforge` passed on that revision?
- Is there a successful session with actual MCP tool calls? Supply its session ID,
  tool names/outcomes, timestamp, and model identifier.
- How should we obtain authorized credentials privately? Do not paste credentials
  in commits, evaluation reports, or this document.
- Confirm a request/spending budget for initial trials and separately for high-risk
  repeats. A model appearing in Settings alone does not establish readiness.
- Can the runtime reach a temporary loopback MCP endpoint on this machine?

Observed preflight: local TrueForge responds with an empty model list. Zero paid
requests were issued. The user explicitly placed first runs and repeats on hold
pending credentials and budget. Reproduce with `npm run eval:live` and inspect
[the captured report](evidence/live-preflight.json).

## Person 2: implemented contract

Used [DISCHARGE-REVIEW-API.md](DISCHARGE-REVIEW-API.md), `tests/review-cases.js`,
`tests/review.test.js`, and `tests/review-http.test.js`. Feature-owner tests were
not edited. Existing shared review cases are reused through `tests/cases.js`.
An additional evaluation case verifies help persistence and scope across SQLite
reopening. No contract/implementation discrepancy was observed in the executed
coverage; this is not a proof of absence.

Covered: immutable original citations, null unknown deadlines, historical-source
rejection, displayed revisions, UUID idempotency, duplicate/stale submissions,
help resolution preserving review gates, invalid calendar dates, reminder version
binding, separate approval, and patient scope.

## UI integration provenance

Remote `refs/heads/feat/care-team-review-ui` resolved to
`450ea93ce40b1bddee9a5f6216a734d19f276935`; `git merge-base --is-ancestor 450ea93 HEAD`
succeeded before final integrated tests. Base HEAD is
`0ce9dad2a4a9dfd4815cad0a742fb46baa29bad5` (use the full SHA in evidence metadata as the authority).

## Failure report format

For a failure, send owner, category, base commit and file hashes, command/scenario,
model identifier, timestamp/session ID, expected versus observed behavior, tool
arguments/results, and relevant state diff. Link the evidence JSON. Redact secrets,
not assertions. The current blocker belongs to readiness/authorization, not model
behavior or a backend control failure.
