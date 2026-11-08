import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { replaceOutput } from '../cli/grade';
test('report publish and restore failures retain the original error and both reports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-report-recovery-')),
    rename = fs.rename;
  try {
    const output = path.join(root, 'output');
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, 'summary.csv'), '学号,评语\n7355608,keep this comment\n');
    (fs as any).rename = async (from: any, to: any) => {
      if (String(to) === output) {
        const first = path.basename(String(from)).startsWith('output-');
        throw Object.assign(Error(first ? 'primary publish error' : 'secondary restore error'), {
          code: first ? 'ENOSPC' : 'EBUSY',
        });
      }
      return rename(from, to);
    };
    syncBuiltinESMExports();
    await assert.rejects(
      replaceOutput(root, {} as any, [{ 学号: '7355608', 评语: '' }], [], []),
      (error: any) => {
        assert.equal(error.code, 'ENOSPC');
        assert.match(error.message, /primary publish error/);
        assert.match(error.message, /secondary restore error/);
        return true;
      },
    );
    const dirs = await fs.readdir(path.join(root, 'build'));
    assert.equal(dirs.length, 2);
    for (const dir of dirs)
      assert.match(
        await fs.readFile(path.join(root, 'build', dir, 'summary.csv'), 'utf8'),
        /keep this comment/,
      );
  } finally {
    (fs as any).rename = rename;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('backup cleanup failure warns after a successful report commit and preserves comments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labpad-report-cleanup-')),
    rm = fs.rm;
  try {
    const output = path.join(root, 'output');
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, 'summary.csv'), '学号,评语\n7355608,kept\n');
    (fs as any).rm = async (p: any, ...args: any[]) => {
      if (path.basename(String(p)).startsWith('previous-')) throw Error('backup fixture EBUSY');
      return (rm as any)(p, ...args);
    };
    syncBuiltinESMExports();
    const warnings = await replaceOutput(root, {} as any, [{ 学号: '7355608', 评语: '' }], [], []);
    assert.ok(warnings.some((w) => w.includes('backup fixture EBUSY')));
    assert.match(await fs.readFile(path.join(output, 'summary.csv'), 'utf8'), /kept/);
  } finally {
    (fs as any).rm = rm;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});
