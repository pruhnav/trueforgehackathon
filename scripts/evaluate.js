import { mkdirSync, writeFileSync } from 'node:fs';
import { cases, runCase } from '../tests/cases.js';
const results = [];
for (const [name, fn] of cases) {
  const start = Date.now();
  try {
    await runCase(fn);
    results.push({ name, passed: true, durationMs: Date.now() - start });
  } catch (error) {
    results.push({ name, passed: false, error: error.message, durationMs: Date.now() - start });
  }
}
const report = {
  ranAt: new Date().toISOString(),
  type: 'deterministic-runtime-guardrails',
  cases: results,
};
mkdirSync('.local', { recursive: true });
writeFileSync('.local/evaluation.json', JSON.stringify(report, null, 2));
for (const row of results) console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.name}`);
console.log(
  `\n${results.filter((r) => r.passed).length}/${results.length} checks passed. Report: .local/evaluation.json`,
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
