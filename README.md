# Homeward

**A clearer path home after discharge.**

Homeward turns discharge instructions into a source-linked follow-up plan, helps patients keep track of next steps, and gives a care team visibility into reported progress and missing information.

Built for the **Agent Harness Hackathon**, organized by TrueFoundry and HackerSquad, sponsored by OpenAI.

## Run locally

Requires **Node.js 22.14+** (Node 24 recommended) and npm.

```sh
npm install
npm run build
npm start
```

Open **http://localhost:8000**. Three hand-authored fictional patients and one official Synthea sample patient are included. No credentials are needed for the source-search and local workflow demo.

For development, use `npm run dev`: the React UI runs on **http://localhost:5173** and proxies API calls to port 8000. Stop `npm start` before starting development mode, since both use port 8000.

## Connect the event tools

1. Start TrueForge in a separate terminal: `npx @truefoundry/trueforge@latest`.
2. Open **http://localhost:8790 → Settings → Models**. Configure the event-provided model access. If the event provides a compatible AI Gateway, use its base URL, key, and exact model ID in a custom provider. Credentials stay in TrueForge, not this repository or the browser.
3. Keep Homeward running and execute **`npm run setup:trueforge`**. This registers patient-scoped MCP connectors for all seeded patients and, when a model is configured, saves an example Homeward agent. Existing connectors are preserved; a conflicting URL requires manual review.
4. Open **Ask Homeward → TrueForge agent**. The app starts a real TrueForge session with a patient-bound MCP connector and displays the returned answer. Each question starts a fresh session.

Manual connector setup for Alex:

| Field          | Value                                |
| -------------- | ------------------------------------ |
| Name           | `homeward-demo-001`                  |
| URL            | `http://localhost:8000/mcp/demo-001` |
| Authentication | **No auth**                          |
| Transport      | Streamable HTTP                      |

The convenience endpoint **`http://localhost:8000/mcp`** is also scoped to Alex. `/mcp/demo-002` and `/mcp/demo-003` serve the other synthetic patients. The agent cannot change its connector's patient through tool arguments.

To select a specific configured model, copy `.env.example` to `.env` and set `TRUEFORGE_MODEL` to its fully qualified `provider/model` name. Optional `TRUEFORGE_URL` and `TRUEFORGE_TOKEN` configure the server connection. **Never commit `.env` or credentials.**

The app uses TrueForge's HTTP API and MCP execution. Gateway routing, provider failover, and dollar-denominated hard limits are **not implemented by Homeward**. Use the event's gateway configuration if these are required. The local harness enforces iteration, time, and request-count limits and shows actual metrics returned by TrueForge.

## What works

- **Patient recovery plan:** sourced tasks, known deadlines, clarification items, patient-reported completion, and persistent state.
- **Discharge record import:** text-based PDFs, TXT/Markdown files, and pasted text. Passages become searchable; exact cited instructions can be added for human review. Scanned-image OCR is not included.
- **Retrieval:** deterministic lexical passage search locally; a connected TrueForge agent can retrieve passages and answer with their context. No vector database or embedding service is required for this small corpus.
- **Approval-controlled reminders:** propose, approve or decline, execute, and download a real `.ics` calendar file. Local reminder creation is not an appointment booking, email, SMS, or scheduled notification service.
- **Failure demo:** simulate response loss after a reminder is stored; retry the same action and receive the original receipt without creating a duplicate.
- **Care-team overview:** synthetic patients with pending, completed, overdue, help-requested, and clarification states. It is a demo view, not a role-authenticated clinician portal.
- **Online education:** live MedlinePlus Web Service lookup using only fixed general topic searches, with attributed curated links when unavailable. Results are cached for 12 hours. Education never changes the patient's care plan.
- **Agent activity:** actual application/MCP traces, approval decisions, latency, TrueForge session IDs, and reported token/cost metrics. Missing cost data is labeled as unavailable.
- **Evaluation evidence:** isolated deterministic guardrail checks, an actual MCP protocol test, and a DOM interaction test covering the main journey.

## MCP tools

| Tool                            | Purpose                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `get_discharge_plan`            | Read the bound patient's tasks, source records, and actions    |
| `search_discharge_instructions` | Return relevant exact passages with source identifiers         |
| `propose_cited_task`            | Add an exact passage for review; never infer a deadline        |
| `propose_reminder`              | Create an approval request for a known dated task              |
| `execute_approved_reminder`     | Execute only after a human approval; reuse receipts on retries |
| `lookup_patient_education`      | Retrieve general educational links without patient identifiers |

There is deliberately **no approval tool**. Approval happens through the app UI/API; an agent cannot approve its own action using the exposed MCP tools. The demo's local API is not user-authenticated, so this boundary is a tool-permission boundary, not a production identity system.

## Architecture

```mermaid
flowchart LR
  UI[React patient and care-team UI] --> API[Local Express API]
  API --> DB[(SQLite records and traces)]
  API --> TF[TrueForge agent runtime]
  TF --> MODEL[Event model or AI Gateway]
  TF --> MCP[Patient-bound MCP tools]
  MCP --> DB
  MCP --> MED[MedlinePlus Web Service]
  UI --> APPROVE[Human approval endpoint]
  APPROVE --> DB
  DB --> ICS[Calendar reminder download]
```

The task state machine is deterministic. The model can retrieve, explain, and propose; the backend controls whether an action can execute. Unknown or imported deadlines remain null. Uploaded material is untrusted data in the agent instructions; source checks prevent invented citations from becoming tasks. These controls do not make language-model medical responses clinically validated.

## Verify

```sh
npm test
npm run eval
npm run build
```

`npm run eval` writes `.local/evaluation.json`; the Agent activity screen reads that report. Results are generated by running the checks, not hardcoded. Tests use separate in-memory or temporary databases and do not reset your local demo.

Once a model is connected and the app is running, **`npm run smoke:trueforge`** performs a real model/tool run. This uses your configured model and may consume event credits. Review the response and trace; automated runtime checks are not a substitute for clinical evaluation.

GitHub Actions runs the tests, evaluation, and production build on pushes and pull requests. See [the demo script](docs/DEMO.md), [team ownership](docs/TEAM.md), [validation notes](docs/VALIDATION.md), and the [dataset and agent integration guide](docs/DATASET-AND-AGENT-INTEGRATION-GUIDE.md).

## Scope and demo data

- All bundled names, discharge records, and instructions are fictional. The scenario date is pinned to **September 19, 2026**, making overdue cases reproducible. Reminder dates follow that demo scenario.
- The app binds to **127.0.0.1**. Do not expose the no-auth app or MCP server publicly or enter real patient data. Shared use needs authentication, role-based authorization, consent, encryption and deployment controls, and a clinical review process.
- Files and SQLite data live under `.local/`, which is ignored by Git. Only synthetic fixtures are committed. Resetting the demo removes local imported records, reminders, and traces after confirmation.
- Real EHR/FHIR connectivity, appointment booking, medication reconciliation, automated outreach, and clinician resolution of review items are future integrations.
- Browser-control availability is environment-dependent. The included DOM tests exercise interactions but do not replace visual/responsive browser review.

## References

- [TrueForge quickstart](https://trueforge.dev/quickstart)
- [TrueForge model configuration](https://trueforge.dev/models)
- [TrueForge MCP connectors](https://trueforge.dev/mcp-servers)
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MedlinePlus Web Service](https://medlineplus.gov/about/developers/webservices/)

MedlinePlus.gov provides the linked educational information and does not endorse Homeward.

## Synthea sample and help requests

Open **Care team → Hui Stoltenberg** to explore the bundled Synthea patient. Open **My documents → Synthea historical record** for the official source URL, archive hash, and per-passage CSV file, row, fields, and file hash. The snapshot is selected from the latest completed inpatient encounter in the official sample archive. Records are filtered as of that discharge date, conservatively excluding records stopped on that day. These are historical synthetic records, not verified discharge orders; no medication schedules or deadlines are inferred.

Regenerate the bundled sample with Python 3 (network access required): `python scripts/ingest-synthea.py`. The upstream latest archive can change; review the resulting patient and provenance diff before accepting it. The bundled JSON works offline. Existing local patients are not overwritten at startup; use the app's explicit demo reset to reload a changed snapshot.

**Need help** flags an open task in the local care-team view. It persists in SQLite and pauses completion, reminder proposals, and execution of previously approved reminders. Clearing help preserves the original clarification status. It does not notify a clinician or send any external message. Already-created calendar files are not recalled.

Data sources remain distinct: hand-authored demo instructions, imported user documents, the [official Synthea sample dataset](https://github.com/synthetichealth/synthea-sample-data), and general MedlinePlus education. The Synthea ingestion is implemented independently; no code from Harbor was copied.
