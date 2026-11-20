import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync } from 'fflate';
import { readProjectArchive, readProjectFolder } from '../core/project-archive';

const descriptor = {
  kind: 'labpad.project',
  schemaVersion: 2,
  mode: 'project',
  labId: '课程项目',
  files: [{ path: 'main.c' }, { path: 'LPMake.txt' }, { path: 'data.bin' }],
};

test('extracted project wrapper and ZIP restore the same text and binary resources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-folder-'));
  try {
    const outer = path.join(root, '课程资料');
    const files = {
      '项目/labpad.project.json': Buffer.from(JSON.stringify(descriptor)),
      '项目/main.c': Buffer.from('int main(void) { return 0; }\n'),
      '项目/LPMake.txt': Buffer.from('target("demo")\nadd_files("*.c")\n'),
      '项目/data.bin': Buffer.from([0, 255, 1]),
      '__MACOSX/._项目': Buffer.from('metadata'),
      '.DS_Store': Buffer.from('metadata'),
      'Thumbs.db': Buffer.from('metadata'),
    };
    for (const [name, bytes] of Object.entries(files)) {
      const file = path.join(outer, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    const archive = path.join(root, 'project.zip');
    await writeFile(archive, zipSync(files));
    const imported = await readProjectFolder(outer);
    assert.deepEqual(imported, await readProjectArchive(archive));
    assert.deepEqual(imported, await readProjectFolder(path.join(outer, '项目')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('folder import rejects deep or malformed descriptors before walking files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-folder-'));
  try {
    const nested = path.join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'labpad.project.json'), JSON.stringify(descriptor));
    const oversized = path.join(nested, 'oversized.data');
    await writeFile(oversized, '');
    await truncate(oversized, 9 * 1024 ** 2);
    await assert.rejects(readProjectFolder(root), /labpad\.project\.json/);
    await writeFile(path.join(root, 'labpad.project.json'), '{"kind":"other"}');
    await assert.rejects(readProjectFolder(root), /labpad\.project\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('folder import reports missing files for problem-set source versions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-folder-'));
  try {
    await writeFile(
      path.join(root, 'labpad.project.json'),
      JSON.stringify({
        kind: 'labpad.project',
        schemaVersion: 2,
        labId: '课程题集',
        problems: [{ problemId: '1', versions: [{ file: 'attempt.c', language: 'c' }] }],
      }),
    );
    await assert.rejects(readProjectFolder(root), /attempt\.c/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
