# Subsystem assessment

Assessed application and tooling commit: **`eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a`**, September 19, 2026. This assessment distinguishes source inspection, automated verification, historical browser captures, and live execution. The README rewrite does not change application behavior.

## What Homeward is trying to accomplish

A patient should be able to identify the next recorded action, read the evidence behind it, and recognize a gap that needs human clarification. The care-team demo operator should see those gaps and respond without implicitly approving instructions or reminders. Comprehension and follow-through are intended benefits; the repository contains no patient-outcome study.

The current prototype spans a patient workspace, local care-team workflow, derived guidance/summary services, a role-scoped agent adapter, and an observable action store. It is more than a document chatbot, but it is not a deployed clinical service.

## Claim-to-source inventory

Every implementation link in this table is pinned to the assessed commit. Local tests are navigation links; the [current verification record](evidence/readme-audit/README.md) identifies the version actually tested.

| Claim | Implementation evidence | Test or observation | Important limit |
| --- | --- | --- | --- |
| Persistent assistant, patient tasks, source dialogs, emergency link | [App](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/src/App.jsx) | [Patient DOM journey](../tests/ui.test.jsx), [guidance DOM test](../tests/guidance-ui.test.jsx); older screenshots | No fresh browser capture of the emergency control |
| 60/40 desktop layout, stacked narrow view, collapsible navigation | [Styles](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/src/styles.css) | Earlier Chrome capture at 1600×1000 and 390×844 | New summary/navigation additions need another visual pass |
| Human review and help handoff | [Review UI](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/src/ReviewWorkspace.jsx) | [Review DOM journey](../tests/review-ui.test.jsx) | Local operator identity is not authenticated |
| Shared next-step selection | [Guidance](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/guidance.js) | [Guidance cases](../tests/guidance-cases.js), [HTTP/source tests](../tests/guidance.test.js) | Recorded-date ordering, not clinical priority |
| Grouped, versioned summary | [Summary service](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/summary.js), [summary UI](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/src/PatientSummary.jsx) | [Summary cases](../tests/summary-cases.js), [DOM test](../tests/summary-ui.test.jsx) | Derived saved records; not a new prescription |
| Import, immutable passages, lexical retrieval | [API](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/app.js), [Store](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/store.js) | [HTTP/MCP integration](../tests/http.test.js), [domain cases](../tests/cases.js) | Extracted text only; uploaded PDFs are not retained as original binary archives |
| Four routed specialists and structured references | [Roles/router/schema](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/agents.js), [response validation](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/agent-responses.js) | [Agent team tests](../tests/agent-team.test.js) | Mocked provider tests establish contracts, not live compatibility or answer quality |
| Patient- and role-bound tools | [MCP registry](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/mcp.js) | Real MCP SDK client tests in [agent team](../tests/agent-team.test.js) and [review HTTP](../tests/review-http.test.js) | Legacy patient endpoint remains broader than each specialist endpoint |
| Runtime sessions, budgets, fallback and traces | [TrueForge adapter](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/trueforge.js) | [Adapter tests](../tests/trueforge.test.js), historical failed live trial | No successful evaluated provider run of the new role/schema implementation |
| Transactional review, idempotency and reminder binding | [Store](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/store.js) | [Review domain](../tests/review-cases.js), [persistence/concurrency](../tests/review.test.js), [HTTP](../tests/review-http.test.js) | No external side-effect transaction or calendar recall |
| Local all-day calendar export | [Calendar endpoint](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/app.js) | HTTP date/timezone checks; recorded browser download | User must import/download it; no appointment booking |
| Fictional fixtures and historical Synthea snapshot | [Fixtures](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/fixtures.js), [importer](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/scripts/ingest-synthea.py) | [Synthea/help tests](../tests/synthea-help.test.js), [committed snapshot](../data/synthea-sample.json) | Upstream latest archive is mutable; historical descriptions are not orders |
| Generic online education and fallback | [Education service](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/server/education.js) | [Education tests](../tests/education.test.js) | Provider behavior is simulated in tests; general links do not verify personalized care |
| Evaluation recording | [Live runner](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/scripts/evaluate-live.js), [assessor](https://github.com/pruhnav/trueforgehackathon/blob/eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a/scripts/evaluations/assess.js) | [Recorder tests](../tests/evaluation-harness.test.js) | Automatic invariants do not adjudicate clinical answer quality |

## Data relationships and lifecycle

SQLite uses a `records(kind,id,payload)` table holding JSON records rather than one SQL table per domain entity. Patient IDs are carried on scoped documents, tasks, actions, and audit/command records. `Store.scoped` checks ownership for operations. These application checks are tested, but there is no authenticated user-to-patient authorization layer.

A document has ordered sections. A task retains its original `{documentId, sectionId, quote}` source and may have a separate effective instruction. Review never rewrites the original quote. Tasks carry general and instruction revisions, status, deadline evidence, and help-episode metadata. `task_audit` retains prior/resulting snapshots; `task_command` stores idempotency receipts. Actions bind to task instruction revisions/fingerprints. Review mutations, audit, receipt, and trace are transactional.

Text imports are limited to 20–80,000 characters and divided into passages up to 1,800 characters. The PDF endpoint extracts text; it does not retain original layout/page mapping in imported sections. Search matches normalized words against headings/text, scores matches, and returns at most four results. A good exact quote is traceability evidence, not proof that the instruction is valid or medically appropriate.

The summary derives six groups: ready, attention, completed, rejected, unreviewed, historical. It limits extra uncovered source cards to 24 and reports omitted passage counts; the textual summary shows at most three items per group and points to the full view. Original records remain accessible through My documents. `snapshotVersion` hashes patient/tasks/documents; summary version changes identify stale displayed summaries.

Browser localStorage retains chat and menu preference. Backend reset does not clear it or TrueForge's independent session store. Some task audit payloads contain source text and responses; traces intentionally omit response text for review/help events, but the complete system should not be described as storing no patient content. Model-selected tools can send record contents to the configured provider. Only the fixed-topic education lookup avoids patient identifiers by design.

## Agent coordination and controls

Recognized whole-question next-step requests bypass model execution in either chat mode. Other requests route by explicit intent or deterministic message matching to one specialist. There are four definitions, not concurrent cooperating model instances. The legacy patient MCP endpoint exposes seven tools; role endpoints restrict inventory on the server and in the runtime specification. No specialist can grant human review, resolve help, approve a reminder, book a visit, or dispatch an emergency call.

The structured response contains status, source references, task IDs, action IDs, and an optional allow-listed education topic. Backend validation rejects malformed/foreign references and reconstructs source passages and current action states. It also checks the record snapshot around response handling. It does not prove the selected reference is relevant, comprehensive, or clinically correct. Model-driven tool mutations that legitimately completed during a run are not rolled back merely because its final output falls back; current records/receipts remain authoritative.

The summarizer uses labeled local fallback on unavailable/failed model execution. Invalid final references or changed snapshots trigger a labeled current-record fallback for any role. Other runtime errors surface as errors. No generic retry policy or provider failover is implemented. The model-list readiness check does not authenticate a billable turn; an unavailable explicit model override is now reported rather than silently substituted.

Homeward's separate approval endpoint is the active human boundary. Native TrueForge tool approval pauses remain disabled until continuation/resume is implemented. Dynamic subagents, sandbox execution, generative UI, and native question continuation are also disabled in these specifications. Limits are operational controls, not dollar-spend guarantees.

## UI and accessibility observations

Inspected recorded PNGs show a light slate/blue workspace, dark next-task card, white cards, fixed left navigation, and a persistent assistant. The source/review dialogs separate quoted evidence from decisions. These are observations of the earlier captured commit, not a fresh browser assessment of `eaf86d9`.

Current DOM journeys cover interaction semantics including modal close/focus behavior, source rendering, help/review gates, summary refresh, patient switching, and the `tel:911` control when loading fails. A telephone link delegates to the device; no actual emergency call was made or should be placed for a demo. New navigation density, long summaries, keyboard traversal, zoom, and multiple narrow sizes still warrant a real-browser accessibility pass.

## Discrepancies reconciled in the README

| Earlier wording or assumption | Current finding |
| --- | --- |
| Clinician resolution is future work | Local demo response/resolution and instruction review are implemented; authenticated clinical workflow remains future work |
| One unrestricted agent and six tools | Four routed roles; seven legacy tools, with smaller role inventories |
| Only lexical search or freeform live answers | Local guidance and grouped summaries now exist; live output selects validated references |
| All failed live requests simply error | Summarizer failures and rejected structured output have explicitly labeled local fallbacks |
| A green connection label proves readiness | Model listing is configuration evidence; older live execution failed authentication |
| No browser evidence exists | Older, isolated Chrome captures exist; none were freshly captured for the new summary/team changes |
| Latest readiness is a universal project status | Readiness is machine-specific; local no-model status and a historical failed credential trial can both be true |
| A saved chat answer establishes a live test | Browser cache and the bundled `?history=1` transcript do not establish a new session, tool call, or reliability result |
| 42 tests / 21 eval cases are the current counts | They describe older snapshots; this audit ran 59 Node + 4 DOM tests and 32 evaluation cases |

## Evidence register

| Classification | What belongs here |
| --- | --- |
| Implemented | Features and controls mapped to the pinned source table above |
| Automated-test verified | Current 59 Node tests, 4 DOM journeys, 32 deterministic cases, production build; [logs and file hashes](evidence/readme-audit/README.md) |
| Recorded real-browser verified | Seven assertion groups and ten captures on `0ce9dad`; [original report](evidence/integrated-main/browser.json) |
| Live attempted, unsuccessful | One older request, invalidated-key 401, no answer/MCP calls; one separately injected outage passed |
| Not established | Live compatibility/quality of structured specialist responses, clinical appropriateness, stable behavior across repeats, patient outcomes, production access control |
| Planned | Provider repair and authorized live evaluation, fresh visual capture, more retrieval/accessibility work, authenticated shared deployment and external integrations |

## Reusable architecture

The README embeds the system, agent-sequence, reminder-state, and data-lineage diagrams. Exact editable copies are in [assets/diagrams](assets/diagrams/README.md). These diagrams describe implemented boundaries, not successful live execution. Mermaid rendering is supported by GitHub; no SVG/PNG diagram export or fresh screenshot was generated in this documentation session because the corresponding local renderer/browser was unavailable.

Primary external references checked September 19, 2026: [TrueForge setup](https://trueforge.dev/quickstart), [models](https://trueforge.dev/models), [MCP connectors](https://trueforge.dev/mcp-servers), [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Synthea samples](https://github.com/synthetichealth/synthea-sample-data), and [MedlinePlus Web Service](https://medlineplus.gov/about/developers/webservices/). They document upstream capabilities; they do not establish that Homeward has exercised every capability.
