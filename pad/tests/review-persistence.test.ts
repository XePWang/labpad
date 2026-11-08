import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { Storage } from '../core/storage';
import { FileService } from '../core/files';
import { runGrade } from '../cli/grade';
import { defaultProblem } from '../shared/defaults';
import { workspacePackage } from '../shared/workspace';
import { directorySnapshot } from '../core/workspace-files';
import { retainVersions } from '../cli/versions';
import { snapshotHash } from '../cli/projects';
import type { Intake } from '../cli/collect';

async function temporary(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-review-persistence-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('initialization and refresh use the same exclusions at every directory depth', () =>
  temporary(async (root) => {
    const storage = new Storage(root);
    await storage.init();
    await storage.workspace.create('Project');
    const project = storage.workspace.root('Project');
    for (const name of ['.git', '.work', 'nested/.git', 'nested/.work', 'nested/.GIT']) {
      await mkdir(path.join(project, name), { recursive: true });
      await writeFile(path.join(project, name, 'config'), 'metadata');
    }
    await mkdir(path.join(project, 'build'));
    await writeFile(path.join(project, 'build/notes.txt'), 'user file');
    const initial = await storage.workspace.list('Project');
    assert.deepEqual(initial, await new FileService(project).list());
    assert.ok(initial.some((f) => f.path === 'main.c'));
    assert.ok(initial.some((f) => f.path === 'build/notes.txt'));
    assert.ok(!initial.some((f) => /(^|\/)\.(git|work)(\/|$)/i.test(f.path)));
    assert.ok((await storage.workspace.documents('Project')).length > 0);
    await assert.rejects(
      new FileService(project).operate({ action: 'newFile', paths: ['.git/unsafe'] }),
      /保留/,
    );
  }));

test('project history restores both maps, detects changed binary resources, and retains ordinals', () =>
  temporary(async (root) => {
    const directory = path.join(root, 'src/7355608/version');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'main.c'), 'int main(void){return 0;}\n');
    await writeFile(path.join(directory, 'data.bin'), Buffer.from([0, 255, 128]));
    const snapshot = await directorySnapshot(directory);
    const record = {
      key: 'version',
      mode: 'project',
      file: 'src/7355608/version',
      origin: 'old.zip',
      studentId: '7355608',
      labId: 'Project',
      problemId: 'main',
      language: 'c',
      hash: snapshotHash(snapshot.files, snapshot.binaryFiles),
      ordinal: 7,
    };
    await writeFile(path.join(root, 'src/index.json'), JSON.stringify([record]));
    const intake: Intake = { candidates: [], issues: [], empty: [] };
    await retainVersions(root, 'Project', ['7355608'], ['main'], intake);
    assert.deepEqual(intake.issues, []);
    assert.equal(intake.candidates[0].ordinal, 7);
    assert.deepEqual(intake.candidates[0].workspace, snapshot);
    await writeFile(path.join(directory, 'data.bin'), Buffer.from([0, 254, 128]));
    const changed: Intake = { candidates: [], issues: [], empty: [] };
    await retainVersions(root, 'Project', ['7355608'], ['main'], changed);
    assert.equal(changed.candidates.length, 0);
    assert.ok(changed.issues[0].pending);
    assert.match(changed.issues[0].message, /校验失败/);
  }));

test('batch rerun without the original ZIP still selects the best complete binary project', () =>
  temporary(async (root) => {
    const source =
      '#include <stdio.h>\nint main(void){FILE*f=fopen("data.bin","rb");if(!f)return 2;int n=0,value=fgetc(f);fclose(f);scanf("%d",&n);printf("%d\\n",value+n);return 0;}\n';
    const files = {
      'LPMake.txt': 'target("app")\nset_standard("c17")\nadd_files("./*.c")\n',
      'main.c': source,
    };
    const rules = {
      ...defaultProblem('Project', ''),
      testCases: [
        { id: 'one', input: '1', expectedOutput: '1' },
        { id: 'two', input: '2', expectedOutput: '2' },
      ],
    };
    const pkg = workspacePackage('Project', { files }, rules);
    await mkdir(path.join(root, 'submit'));
    await writeFile(path.join(root, 'project.json'), JSON.stringify(pkg));
    await writeFile(path.join(root, 'roster.csv'), '序号,学号,姓名\n1,7355608,示例同学\n');
    await writeFile(
      path.join(root, 'grade.json'),
      JSON.stringify({
        schemaVersion: 1,
        project: 'project.json',
        roster: 'roster.csv',
        weights: { main: 1 },
        compiler: { kind: 'gcc' },
        isolation: 'none',
      }),
    );
    const archive = (value: number) =>
      Buffer.from(
        zipSync({
          'submission/LPMake.txt': strToU8(files['LPMake.txt']),
          'submission/main.c': strToU8(source),
          'submission/data.bin': new Uint8Array([value, 255, 128]),
        }),
      );
    const original = path.join(root, 'submit/7355608_old.zip');
    await writeFile(original, archive(0));
    const runtime = {
      toolchain: path.resolve('../.work/toolchains/linux-x64'),
      checkers: path.resolve('../.work/checkers/linux-x64'),
    };
    const first = await runGrade(root, runtime);
    assert.equal(first.summary[0]['得分100'], '100.00');
    await rm(original);
    await writeFile(path.join(root, 'submit/7355608_new.zip'), archive(1));
    const second = await runGrade(root, runtime);
    assert.deepEqual(second.issues, []);
    assert.equal(second.summary[0]['得分100'], '100.00');
    assert.equal(second.summary[0]['main_通过'], 2);
    const index = JSON.parse(await readFile(path.join(root, 'src/index.json'), 'utf8'));
    assert.equal(index.length, 2);
    assert.equal(second.summary[0]['main_SHA256'], first.summary[0]['main_SHA256']);
  }));
