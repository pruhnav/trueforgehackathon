# Validation and limits

## Automated checks

- Domain tests cover source integrity, null deadlines, approvals, rejected actions, patient boundaries, stale-task execution, citation rejection, and reminder deduplication after response loss.
- A persistence test closes and reopens SQLite and verifies the saved task state.
- An actual MCP SDK client connects over Streamable HTTP, lists tools, reads the bound patient, attempts a foreign task, attempts unapproved execution, then executes after approval through the UI API.
- The HTTP test also checks calendar output, actual PDF parsing/import, invalid input, disallowed browser origins, and missing patients.
- A TrueForge adapter contract test uses a simulated provider response to verify session specifications and metrics propagation. It is not evidence of a live model run.
- A React DOM interaction test renders the app against an isolated real backend and exercises source viewing, completion, approval, simulated timeout/retry, source search, patient switching, document import, and trace visibility.
- The production Vite build verifies compilation and asset generation.

## Not established by these checks

- Clinical accuracy, improved health outcomes, regulatory compliance, or suitability for real patient records.
- Pixel-level visual quality or browser/responsive behavior: the initial build environment had no connected browser-control surface. A teammate should visually inspect the supplied responsive layout.
- Actual provider response quality until a model is configured in the local TrueForge instance and `npm run smoke:trueforge` is run.
- Production user isolation: the local app intentionally has no login and all records are fictional. Patient-scoped MCP tools limit an agent's context, but the local UI operator can switch between demo patients.
- Medication advice, symptom triage, real appointments, outbound reminders, or scheduling guarantees.

The evaluation panel is populated from an actual run of the isolated checks. Live token/cost panels are populated only by returned TrueForge metrics. They remain empty or “Not reported” when no data is available.
