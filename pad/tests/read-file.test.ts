import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { readFileLimited } from '../core/read-file';
import { CommandTerminal } from '../core/terminal';
import { FileService } from '../core/files';
const limit = 1024 ** 2;
test('bounded reading rejects metadata oversize, limits growth to one sentinel byte, and closes on failure', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-read-limit-'));
  const original = fs.open;
  let bytesRead = 0,
    closed = 0,
    hideSize = false,
    failRead = false,
    maxRead = 0;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const file = await original(...args);
    const stat = file.stat.bind(file),
      read = file.read.bind(file),
      close = file.close.bind(file);
    file.stat = (async () => {
      const info = await stat();
      if (hideSize) info.size = 1;
      return info;
    }) as typeof file.stat;
    file.read = (async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | null,
    ) => {
      maxRead = Math.max(maxRead, length);
      if (failRead) throw Error('Injected read error');
      const result = await read(buffer, offset, length, position);
      bytesRead += result.bytesRead;
      return result;
    }) as typeof file.read;
    file.close = async () => {
      closed++;
      await close();
    };
    return file;
  });
  syncBuiltinESMExports();
  try {
    const huge = path.join(root, 'large.txt');
    await fs.writeFile(huge, Buffer.alloc(8 * limit, 'a'));
    await assert.rejects(readFileLimited(huge, limit, 'LIMIT'), /LIMIT/);
    assert.equal(bytesRead, 0);
    assert.equal(closed, 1);
    hideSize = true;
    await assert.rejects(readFileLimited(huge, limit, 'LIMIT'), /LIMIT/);
    assert.equal(bytesRead, limit + 1);
    assert.equal(closed, 2);
    assert.ok(maxRead <= 64 * 1024);
    hideSize = false;
    bytesRead = 0;
    const exact = path.join(root, 'exact.txt'),
      buffer = Buffer.alloc(limit, 'x');
    await fs.writeFile(exact, buffer);
    assert.deepEqual(await readFileLimited(exact, limit, 'LIMIT'), buffer);
    assert.equal(bytesRead, limit);
    assert.equal(closed, 3);
    failRead = true;
    await assert.rejects(readFileLimited(exact, limit, 'LIMIT'), /Injected read error/);
    assert.equal(closed, 4);
    failRead = false;
    await assert.rejects(readFileLimited(root, limit, 'LIMIT'), /普通文件/);
    assert.equal(closed, 5);
    const files = new FileService(root);
    const shell = new CommandTerminal(
      files,
      (request) => files.operate(request),
      async () => '',
    );
    bytesRead = 0;
    await assert.rejects(shell.execute('cat large.txt'), /超过 1 MB/);
    assert.equal(bytesRead, 0);
    const unicode = '中文🙂\n';
    await fs.writeFile(path.join(root, 'utf8.txt'), unicode);
    assert.equal((await shell.execute('cat utf8.txt')).output, unicode);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});
