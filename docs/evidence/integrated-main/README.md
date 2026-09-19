# Integrated main: evaluation and delivery evidence

**Application commit:** `0ce9dad2a4a9dfd4815cad0a742fb46baa29bad5`.
Fetched from `origin/main` and verified as an exact archive snapshot: all 47 tracked
files match their Git blobs. [Snapshot and build hashes](snapshot.json).
Evaluation tooling remains a local addition on `test/live-agent-evaluations`;
application source was not modified to make these checks pass.

## Actual results

| Check                        | Result                                                        | Evidence                                      |
| ---------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| Merged `npm run check`       | 40 Node tests and 2 DOM tests passed; production build passed | [Output](check.txt)                           |
| Merged `npm run eval`        | 21/21 deterministic cases passed                              | [Output](eval.txt)                            |
| Production Chrome journey    | 7 assertion groups passed, 10 captures                        | [Browser report](browser.json)                |
| Mobile layout                | No horizontal page overflow at 390×844; menu can be dismissed | [Capture](../../assets/journey/10-mobile.png) |
| Live-agent initial trial     | 1 attempted, failed; 9 other model scenarios not run          | [Live report](live-trials.json)               |
| Runtime outage               | 1 injected 503 trial passed; no model involved                | [Live report](live-trials.json)               |
| Human-reviewed model answers | 0; no answer returned                                         | [Turn diagnostics](session-turns.json)        |
| High-risk repeats            | 0                                                             | Not authorized                                |

The additional local evaluation suite previously passed 44 Node tests, 2 DOM tests,
and 22 evaluation cases. Those are **not the merged baseline counts**. See the
[earlier tooling evidence](../README.md) for that separate scope.

## Real-browser coverage

The built React app used the real Express API and an isolated in-memory SQLite
Store. All chat in this browser journey used source search. A browser route guard
blocked live-chat requests. Assertions checked help resolution retains the review
gate and null date; approve/execute/response-loss/retry creates one reminder;
the calendar file has the expected date; imported review preserves the citation;
and switching patients removes the prior assistant conversation.

No uncaught page errors occurred. The single HTTP 504 was deliberately injected
by the reminder timeout control. Chrome's aborted calendar navigation was the
successful download handoff, not a failed export. Browser version, times, viewports,
state, and screenshot hashes are in the report.

Earlier recorder attempts are preserved: initial temporary-port origin mismatch,
collapsed mode selector, and a mobile backdrop click landing underneath the sidebar.
These were automation problems, fixed without changing the app. The final run
clicked the exposed mobile backdrop and passed. The first successful run is also
preserved. Use only the numbered captures linked from [the presentation](../../PRESENTATION.md),
not `failure.png`, as successful journey visuals.

## Live failure: reproduce and route to Person 1

- Runtime: TrueForge **0.2.0**.
- Model: `openai/gpt-5-4-mini` (upstream `gpt-5.4-mini`).
- Authorized budget: at most 3 Homeward requests, no repeats, stop on first
  provider/configuration error. **1 request issued**, then stopped.
- Scenario: `paperwork`, original prompt recorded in the live report.
- Session: `01m2xww85k2c8vj3e2tnj116jw`.
- Turn: `01m2xww8dsz1zyy9szh4d7h3b6`.
- OpenAI error: **401, “Your API key has been invalidated.”**
- Homeward surfaced HTTP 502; no answer, no MCP tool calls, no state changes.
- TrueForge reported 0 input tokens, 0 output tokens, 0 total tokens. No cost value
  was reported; do not replace missing cost with an asserted dollar amount.

This is a **provider/credential failure**, not evidence of model reasoning failure
or successful live-agent reliability. The remaining two requests were not used.
Replace/rotate the credential privately in TrueForge Settings → Models before
requesting approval to resume. Do not commit keys or paste replacements into chat.
Read-only session diagnostics did not issue additional model requests.

## Integration finding for agent/UI owners

The UI can show **“AI assistant connected” despite invalid credentials** because
`forgeStatus()` uses a nonempty configured-model list as `ready`; it does not make
an authenticated model request. The final mobile screenshot shows this label after
switching patients, while the failed session proves authentication was rejected.
This is a reproducible status-label limitation, not proof of a working integration.
Prefer a “model configured / unverified” state until a successful session exists.
No application change was made during baseline verification.

## Reproduce the pinned app

From the repository root, choose a new empty snapshot directory if this one exists:

```sh
mkdir -p .local/integrated-main
# Run only into the empty directory; do not overlay another checkout.
git archive 0ce9dad2a4a9dfd4815cad0a742fb46baa29bad5 | tar -x -C .local/integrated-main
cd .local/integrated-main
npm ci
npm run check
npm run eval
PORT=8001 npm start
```

The recorded run reused the workspace's installed `node_modules` through a symlink;
it did not test a fresh install. The commands above describe a clean reproduction.
The snapshot has its own `.local` state and must not be pointed at the working demo
SQLite file. Stop its server when finished. Use Source search for the verified demo.

For browser capture, install `playwright-core` in a separate temporary tooling
directory, then from the repository root:

```sh
PLAYWRIGHT_MODULE=/private/tmp/homeward-browser-tools/node_modules/playwright-core/index.mjs \
  node scripts/evaluations/browser-journey.js
```

`APP_ROOT` overrides the isolated snapshot path; `CHROME_PATH` overrides the Chrome
binary. The default is macOS Google Chrome. The runner requires a built snapshot,
starts its own ephemeral API, never resets the team database, and writes screenshots
and `browser.json`. Keep earlier evidence before rerunning. Check the pinned commit
and snapshot hashes when changing `APP_ROOT`.

## Demo claim

> On merged commit 0ce9dad, the deterministic suite, build, and real-browser patient
> journey passed. The first authorized live-agent request was rejected for an
> invalidated OpenAI key, and the runner stopped. Live model behavior remains
> unverified; the presentation clearly identifies source-search demonstrations.
