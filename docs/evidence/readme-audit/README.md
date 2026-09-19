# README audit evidence

Assessed application commit: `eaf86d9ac1f72dd7b59b52b1263a131b307e0b8a` (September 19, 2026). Documentation edits made the working tree dirty; application source was unchanged. Dependencies were reused, so this was not a clean-install test.

| Command | Result | Evidence |
| --- | --- | --- |
| npm run check | 59 Node tests, 4 DOM journeys, production build passed | [Full output](check.txt) |
| npm run eval | 32/32 deterministic checks passed | [Output](eval.txt), [JSON report](deterministic.json) |

[Verification metadata](verification.json) records source hashes, scope, and capture-hash checks. No paid model requests were issued and no fresh browser run was available in this audit. DOM journeys do not establish visual verification.

The [historical browser and live-trial evidence](../integrated-main/README.md) assesses the earlier `0ce9dad` application. Its ten screenshots were inspected and their SHA-256 hashes verified; the [derived manifest](../../assets/journey/manifest.json) preserves their provenance. That trial's provider authentication failed, so successful live-agent reliability remains unverified.

See the [subsystem assessment](../../SUBSYSTEM_ASSESSMENT.md), [patient journey](../../PATIENT_JOURNEY.md), and [editable diagrams](../../assets/diagrams/README.md). Diagram sources are synchronized with the project README; no local rendered exports were produced.
