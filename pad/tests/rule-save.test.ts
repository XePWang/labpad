import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '../core/storage';
test('source-only saving preserves newer rules; explicit rule writes detect conflicting baselines', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-rule-save-'));
  try {
    const store = new Storage(root);
    await store.init();
    await store.createLab('Lab');
    const draft = await store.createProblem('Lab', 'one', 'c');
    const rule = { ...draft.problem, testCases: [{ id: 'one', input: '', expectedOutput: 'NEW' }] };
    const text = JSON.stringify(rule, null, 4) + '\n';
    await store.saveRuleFile(draft.problem, text);
    await store.save({ ...draft, source: 'int main(void){return 0;}' }, { rules: false });
    const file = store.paths('Lab', 'one', 'c').problem;
    assert.equal(await readFile(file, 'utf8'), text);
    const loaded = await store.openFile('Lab', 'one', 'one.json');
    assert.equal(loaded.ruleFile, true);
    assert.deepEqual(loaded.problem, rule);
    await assert.rejects(store.saveProblem(draft.problem, draft.problem), /规则已更改/);
    await assert.rejects(
      store.saveRuleFile(rule, JSON.stringify({ ...rule, problemId: 'other' })),
      /位置不一致/,
    );
    await assert.rejects(store.saveRuleFile(rule, '{broken'), SyntaxError);
    await assert.rejects(
      store.saveRuleFile(rule, JSON.stringify({ ...rule, testCases: [{ id: 'one' }] })),
      /测试点/,
    );
    assert.equal(await readFile(file, 'utf8'), text);
    const next = { ...rule, title: 'updated' };
    await store.saveProblem(next, rule);
    assert.deepEqual((await store.load('Lab', 'one', 'c')).problem, next);
    await assert.rejects(store.saveRuleFile(rule, text), /规则已更改/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
