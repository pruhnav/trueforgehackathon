# Patient-centred agent team and summary contract

This extends the next-step slice following the user's request for an agent team,
a discharge summarizer, and future OpenAI access through TrueForge.

## Team

Four fixed specialist definitions use the native TrueFoundry Agent type through
TrueForge inline AgentSpecs, not the Remote Agent registry type. A
deterministic request router is the first coordination layer: it chooses one role
per live request, rather than running four models for every question. These are
actual role-specific specs and MCP endpoints, not four labels on an unrestricted agent.

| Role | Job | Tools |
| --- | --- | --- |
| `coordinator` | Explain the plan and prepare cited review items when asked | plan, summary, source search, cited-task proposal, general education |
| `summarizer` | Organize discharge records and visible gaps | summary, source search |
| `questions` | Find evidence for the patient's question | plan, source search, general education |
| `reminders` | Help with local calendar reminders | plan, propose reminder, execute already-approved reminder |

Dynamic subagents stay disabled: native dynamic children inherit their parent's
tools, which is not the permission separation needed here. The existing legacy
MCP endpoint remains available with its existing tools plus the new read-only
`get_discharge_summary`. New role connectors use `/mcp/:patientId/:role` and enforce
the role's tool inventory on the server as well as in the TrueForge allow-list.
No role receives instruction review, help resolution, approval, outbound messaging,
appointment booking, medication changes, or emergency dispatch tools.

TrueForge approval pauses are intentionally not enabled in this slice. The current
HTTP adapter reports `required_actions` for human attention but does not yet resume
paused turns. Enabling `require_approval_for_tools` now would therefore interrupt the
existing patient workflow. Instead, proposal tools remain narrow, the reminder role
can execute only an action already approved through Homeward's separate UI/API, and
the store rejects unapproved, stale, or cross-patient actions. There is no approval
MCP tool. Native approval continuation should be added end to end before that harness
feature is switched on.

## Additive HTTP contracts

- `GET /api/agent-team`: role IDs, patient-friendly labels, purposes, and tool names.
- `GET /api/patients/:id/summary`: a deterministic, current summary with `patientId`,
  `asOf`, `version`, `guidance`, and grouped `sections` containing source-linked cards.
- Existing chat accepts optional `intent`: `auto` (default), `summary`, `question`,
  `reminder`, or `coordination`. Existing `{ message, mode }` clients keep working.
- Chat responses add `agentRole` and `execution` (`local`, `trueforge`, or
  `local_fallback`). Summary responses include `summary`; validated live responses
  include exact `citations`. Run IDs/metrics appear only for actual model runs.
- Recognized next-step questions still use local plan guidance in either mode.
  Summary questions use the summarizer in live mode when a model is ready, with a
  clearly labeled local summary fallback when unavailable. Source-search mode is local.

Example:

```http
POST /api/patients/demo-001/chat
Content-Type: application/json

{"message":"Summarize my discharge instructions","mode":"live","intent":"summary"}
```

## Grounding and accessible explanation

Summaries separate ready tasks, items needing attention, reported completion,
rejected/history items, unreviewed source passages, and historical context. They
show exact recorded instructions, task status meanings, established dates and their
provenance, and a source button. Missing values remain missing. No medication regimen,
diagnosis, warning threshold, or clinical reason is generated from product/history data.
Unreviewed document passages are visible but are not promoted into actionable tasks.

Live roles use native `response_format: json_schema`. The model selects source,
task, and action references and an optional allow-listed education topic. The backend
validates patient scope and reconstructs exact passages and current receipts; arbitrary
model-written clinical instructions are not displayed. The summarizer can select
items to discuss while the full recorded summary remains visible, including unresolved
items. A changed clinical snapshot or malformed/foreign reference causes a labeled,
deterministic fallback. The transcript is not an instruction-approval mechanism.

## Provider/OpenAI groundwork

- Model calls remain behind TrueForge's HTTP session/turn API, independent of provider.
- Configure an OpenAI provider/key in TrueForge Settings → Models, or connect an
  approved TrueFoundry AI Gateway model. Homeward never accepts or stores that key.
- Set `TRUEFORGE_MODEL` to the exact configured model FQN if needed. An unavailable
  override is reported as not ready, rather than silently selecting a different model.
- `npm run setup:trueforge` registers patient/role connectors and saved team agents
  without replacing existing definitions or credentials. App requests still use
  current inline specs so stale saved examples cannot broaden tool access.
- Native JSON-schema response support and tool calling must be checked with the
  selected provider/model. Invalid output falls back safely, rather than trusting prose.
- The one-minute request budget, iteration limit, timeout/cancel path, and reported
  usage metrics remain. No live model run is implied by local rendering or mock tests.

## Capability register

| Capability | Status |
| --- | --- |
| Native TrueFoundry Agent registry type | Used; Remote Agent is not used |
| Native TrueForge AgentSpec, sessions and turns | Reused for all four live roles |
| Explicit MCP tool selectors | Used with server-enforced role endpoints |
| Native JSON-schema response format | Used for validated reference selection |
| `get_discharge_summary` | New read-only, patient-bound Homeward MCP tool |
| Existing six Homeward tools | Preserved, distributed according to role |
| Native tool approval pauses | Not enabled until Homeward can resume `required_actions`; existing server approval remains authoritative |
| OpenAI / other provider credentials | Managed in TrueForge/gateway; no key in Homeward |
| Native question continuation, dynamic subagents, schedules | Not enabled by this slice |

Official references verified:

- https://www.truefoundry.com/docs/agent-platform/agent-harness/overview
- https://trueforge.dev/create-agent/overview
- https://trueforge.dev/api-reference/agents/create-an-agent
- https://trueforge.dev/api/use-agent
- https://trueforge.dev/key-features/subagents

Frontend handoff: this is an additive contract extending the previously approved
guidance/review contracts. Patient-facing labels must distinguish saved-record
summaries from model-assisted reference selection and show local-demo attribution.

## Verification record

- Integrated on `origin/main` at `c1643ce`, preserving its care-team UI and live
  evaluation harness changes.
- `npm run check`: 59 backend/contract tests plus 4 React DOM journeys passed;
  production build passed.
- `npm run eval`: 32/32 deterministic guardrail cases passed.
- Real MCP SDK clients verify the summary tool and each role's published inventory,
  including rejecting a reminder tool call through the summarizer endpoint.
- Mock TrueForge HTTP tests verify provider-independent model selection (including
  an OpenAI-shaped configured FQN), role-specific native session specs, structured
  output, preservation of existing registrations, provider failure, invalid/foreign
  references, and changes to the care plan during a run.
- DOM tests cover literal source text, missing directions/dates, patient switching,
  summary refresh/history notices, role labels, local/model-unavailable paths, and
  the native US-demo emergency link while plan loading fails.
- Existing care-team review, audited help resolution, reminder approval, stale
  reminder rejection, and retry/persistence tests continue to pass.
- No live provider/key was configured by this work, and TrueForge was not running
  during the final integrated verification. Live response quality, model compatibility,
  and actual provider usage require the documented smoke run after configuration.
  DOM checks do not establish pixel-level mobile browser quality.
