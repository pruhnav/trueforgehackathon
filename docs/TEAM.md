# Four-person ownership

| Owner                            | Primary files                                                        | Immediate responsibility                                                                      |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1 — Data and retrieval           | `server/fixtures.js`, `server/store.js`, `server/education.js`       | Review fictional scenarios, exact-source retrieval, import behavior, and resource attribution |
| 2 — Agent and tools              | `server/mcp.js`, `server/trueforge.js`, `scripts/setup-trueforge.js` | Configure event model/gateway, run the live smoke check, tune the agent, inspect actual tools |
| 3 — Product experience           | `src/App.jsx`, `src/styles.css`                                      | Browser review, responsive polish, accessible controls, patient/care-team journey             |
| 4 — Reliability and presentation | `tests/`, `scripts/evaluate.js`, `docs/DEMO.md`, CI                  | Verify failure cases, collect honest evidence, rehearse the demo and handle integration       |

Use feature branches and small pull requests. Agree before changing the shared API shape. Patient IDs scope all records. Task source references contain `documentId`, `sectionId`, and an exact `quote`. Reminder transitions are `proposed → approved → executed` or `proposed → rejected`; only the human API grants approval.

Prioritize connecting the real event model and rehearsing the existing path before expanding scope. A vector database, multi-agent hierarchy, marketplace, or EHR integration is unnecessary for this demo.
