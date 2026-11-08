import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { FileService } from '../core/files';
test('failed move and failed restore retain the only source copy for recovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-move-recovery-')),
    rename = fs.rename;
  try {
    const bytes = Buffer.from('the only source copy\n'),
      source = path.join(root, 'main.c');
    await fs.writeFile(source, bytes);
    (fs as any).rename = async (from: any, to: any) => {
      if (
        String(from).includes('.labpad-txn-') &&
        [source, path.join(root, 'nested/main.c')].includes(String(to))
      )
        throw Object.assign(Error('fixture locked destination'), { code: 'EPERM' });
      return rename(from, to);
    };
    syncBuiltinESMExports();
    await assert.rejects(
      new FileService(root).operate({ action: 'move', paths: ['main.c'], destination: 'nested' }),
    );
    (fs as any).rename = rename;
    syncBuiltinESMExports();
    const found: Buffer[] = [];
    async function walk(dir: string) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) await walk(f);
        else found.push(await fs.readFile(f));
      }
    }
    await walk(root);
    assert.ok(
      found.some((b) => b.equals(bytes)),
      'neither the original nor the transaction backup survived',
    );
  } finally {
    (fs as any).rename = rename;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});
