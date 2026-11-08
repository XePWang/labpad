import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticCounts, isLpmakeDiagnostic } from '../shared/diagnostics';
import { operationError } from '../shared/errors';
import { parse } from '../shared/lpmake';

test('LPMake output routing recognizes real parser diagnostics after IPC normalization', () => {
  for (const source of [
    'target("app")\nset_language("cpp")',
    'target("app")\nadd_defiens("X")',
    'target("app"',
  ]) {
    let diagnostic = '';
    try {
      parse(source);
    } catch (error) {
      diagnostic = operationError(error);
    }
    assert.ok(isLpmakeDiagnostic(diagnostic));
    assert.equal(diagnosticCounts(diagnostic).errors, 1);
    const ipc = new Error(`Error invoking remote method 'compile': Error: ${diagnostic}`);
    assert.ok(isLpmakeDiagnostic(operationError(ipc)));
  }
});
test('ordinary operation and compiler errors keep their own presentation', () => {
  for (const text of [
    '路径不存在',
    'main.c:2:1: error: expected expression',
    'LPMake.txt was not found',
    'prefix LPMake.txt:2:1: error: invalid',
  ]) {
    assert.equal(isLpmakeDiagnostic(text), false);
  }
});
