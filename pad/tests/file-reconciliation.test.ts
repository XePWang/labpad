import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '../core/storage';
import { remapPath, replacedPath } from '../shared/file-changes';

test('committed file operations keep metadata and paths when backup cleanup fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-file-cleanup-'));
  const original = fs.rm;
  try {
    const storage = new Storage(root);
    await storage.init();
    await storage.workspace.create('Fixture', 'c');
    await storage.workspace.update('Fixture', { openFiles: ['main.c'], activeFile: 'main.c' });
    let failures = 1;
    fs.rm = (async (target, ...args) => {
      if (failures && path.basename(String(target)).startsWith('.labpad-txn-')) {
        failures--;
        throw Object.assign(Error('Injected cleanup failure'), { code: 'EBUSY' });
      }
      return original(target, ...args);
    }) as typeof fs.rm;
    syncBuiltinESMExports();
    const result = await storage.operateFiles('Fixture', '', {
      action: 'rename',
      paths: ['main.c'],
      destination: 'renamed.c',
    });
    assert.equal(failures, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Injected cleanup failure/);
    const state = await storage.workspace.read('Fixture');
    assert.equal(state.activeFile, 'renamed.c');
    assert.deepEqual(state.openFiles, ['renamed.c']);
    await fs.access(path.join(storage.workspace.root('Fixture'), 'renamed.c'));
    await assert.rejects(fs.access(path.join(storage.workspace.root('Fixture'), 'main.c')));
  } finally {
    fs.rm = original;
    syncBuiltinESMExports();
    await original(root, { recursive: true, force: true });
  }
});
test('directory moves reconcile persisted breakpoints and deletions remove them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-file-state-'));
  try {
    const storage = new Storage(root);
    await storage.init();
    await storage.workspace.create('Fixture', 'c');
    await storage.operateFiles('Fixture', '', {
      action: 'newFile',
      paths: ['src/api.c'],
      content: 'int value;',
    });
    await storage.workspace.update('Fixture', {
      openFiles: ['src/api.c'],
      activeFile: 'src/api.c',
      expanded: ['src'],
      debugView: {
        breakpoints: [
          { path: 'src/api.c', line: 1, enabled: true, condition: 'value==1', verified: true },
        ],
        watches: ['value'],
      },
    });
    await storage.operateFiles('Fixture', '', {
      action: 'rename',
      paths: ['src'],
      destination: 'lib',
    });
    const state = await storage.workspace.read('Fixture');
    assert.equal(state.activeFile, 'lib/api.c');
    assert.deepEqual(state.expanded, ['lib']);
    assert.deepEqual(state.debugView?.breakpoints, [
      { path: 'lib/api.c', line: 1, enabled: true, condition: 'value==1', verified: false },
    ]);
    await storage.operateFiles('Fixture', '', { action: 'delete', paths: ['lib'] });
    assert.deepEqual((await storage.workspace.read('Fixture')).debugView?.breakpoints, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('path mapping preserves copies and does not chain independent batch changes', () => {
  assert.equal(remapPath('src/api.h', [{ from: 'src', to: 'lib' }]), 'lib/api.h');
  assert.equal(remapPath('src/api.h', [{ from: 'src', to: 'lib', copied: true }]), 'src/api.h');
  assert.equal(
    remapPath('src/api.h', [
      { from: 'src', to: 'lib' },
      { from: 'lib', to: 'more' },
    ]),
    'lib/api.h',
  );
  assert.equal(remapPath('src/api.h', [{ from: 'src' }]), undefined);
  assert.ok(replacedPath('to/api.h', [{ from: 'src', to: 'to', replaced: true }]));
});
