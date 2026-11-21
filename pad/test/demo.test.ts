import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticCounts } from '../shared/diagnostics';

test('counts warnings and errors in compiler output', () => {
  const output = 'main.c:3:5: warning: unused variable\nmain.c:6:2: error: expected expression';
  assert.deepEqual(diagnosticCounts('', output), { warnings: 1, errors: 1 });
});
