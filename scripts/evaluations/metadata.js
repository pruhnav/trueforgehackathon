import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export function metadata() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const files = [
    'package.json',
    'tests/cases.js',
    'scripts/evaluate.js',
    'scripts/evaluate-live.js',
    'scripts/evaluations/scenarios.js',
    'scripts/evaluations/assess.js',
    'scripts/evaluations/metadata.js',
  ];
  const tracked = git(
    'ls-files',
    'server',
    'tests',
    'scripts',
    'data',
    'package.json',
    'package-lock.json',
  )
    .split('\n')
    .filter(Boolean);
  const assessedFiles = [
    ...new Set([...files, ...tracked, 'tests/evaluation-harness.test.js']),
  ].sort();
  return {
    commit: git('rev-parse', 'HEAD'),
    dirty: !!git('status', '--porcelain'),
    node: process.version,
    evaluatedFiles: Object.fromEntries(
      assessedFiles.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]),
    ),
  };
}
