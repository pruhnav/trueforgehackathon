import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { cases, runCase } from './cases.js';
import { Store } from '../server/store.js';
for (const [name, fn] of cases) test(name, () => runCase(fn));
test('State survives reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homeward-test-'));
  try {
    const file = join(dir, 'test.sqlite');
    const first = new Store(file);
    first.completeTask('demo-001', 'demo-001-task-2', true);
    first.close();
    const second = new Store(file);
    assert.equal(second.get('task', 'demo-001-task-2').status, 'completed');
    second.close();
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('homeward-test-'));
    rmSync(dir, { recursive: true });
  }
});
