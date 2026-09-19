const base = `http://localhost:${process.env.PORT || 8000}`;
const status = await fetch(`${base}/api/status`).then((r) => r.json());
if (!status.ready) {
  console.error(
    'No configured TrueForge model. Add event credentials in TrueForge → Settings → Models, then retry.',
  );
  process.exit(1);
}
console.log(`Running a real model/tool request using ${status.selectedModel}.`);
const response = await fetch(`${base}/api/patients/demo-001/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'live',
    message:
      'Read my discharge plan using the tools. What paperwork should I bring to follow-up? Cite the source. Do not propose or execute any actions.',
  }),
  signal: AbortSignal.timeout(110000),
});
const result = await response.json();
if (!response.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log(result.answer);
console.log(
  JSON.stringify(
    { sessionId: result.sessionId, latencyMs: result.latencyMs, metrics: result.metrics },
    null,
    2,
  ),
);
console.log(
  'Inspect this session and its tool calls in TrueForge; review the answer against the source.',
);
