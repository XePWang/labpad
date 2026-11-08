import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileService } from '../core/files';
import { CommandTerminal } from '../core/terminal';
test('terminal cwd follows committed directory moves and deletion without guessing its prompt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-terminal-context-'));
  try {
    const files = new FileService(root);
    let shell: CommandTerminal;
    shell = new CommandTerminal(
      files,
      async (request) => {
        const result = await files.operate(request);
        await shell.reconcile(result.changes);
        return result;
      },
      async () => '',
    );
    await shell.execute('mkdir inner');
    await shell.execute('cd inner');
    assert.deepEqual(await shell.context(), { scope: root, cwd: 'inner' });
    const change = await files.operate({
      action: 'rename',
      paths: ['inner'],
      destination: 'renamed',
    });
    await shell.reconcile(change.changes);
    assert.equal((await shell.context()).cwd, 'renamed');
    await shell.execute('touch marker.txt');
    await access(path.join(root, 'renamed/marker.txt'));
    const deleted = await files.operate({ action: 'delete', paths: ['renamed'] });
    await shell.reconcile(deleted.changes);
    assert.equal((await shell.execute('pwd')).output, './');
    await shell.execute('mkdir external');
    await shell.execute('cd external');
    await rm(path.join(root, 'external'), { recursive: true });
    assert.equal((await shell.context()).cwd, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
