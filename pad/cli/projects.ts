import { directorySnapshot } from '../core/workspace-files';
import { ConfigError } from '../shared/lpmake';
import { readdir, lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { archiveSnapshot } from '../core/project-archive';
import { decodeText, exists, readJSON } from '../core/storage';
import { workspacePath, uniquePaths, type WorkspaceSnapshot } from '../shared/workspace';
import type { Intake, Candidate } from './collect';
import type { Student } from './roster';
export function snapshotHash(
  files: Record<string, string>,
  binaryFiles: Record<string, string> = {},
) {
  const sorted = (v: Record<string, string>) =>
    Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256')
    .update(JSON.stringify([sorted(files), sorted(binaryFiles)]))
    .digest('hex');
}
export async function collectProjects(
  submit: string,
  src: string,
  students: Student[],
  labId: string,
): Promise<Intake> {
  const intake: Intake = { candidates: [], issues: [], empty: [] };
  const identify = (origin: string) =>
    students
      .filter((s) => new RegExp('(?:^|[^0-9])' + s.studentId + '(?:$|[^0-9])').test(origin))
      .map((s) => s.studentId);
  async function candidate(origin: string, snapshot: WorkspaceSnapshot) {
    const { files, binaryFiles = {} } = snapshot;
    const ids = identify(origin);
    if (ids.length !== 1) throw new Error('学号归属不明确');
    delete files['labpad.project.json'];
    uniquePaths([...Object.keys(files), ...Object.keys(binaryFiles)]);
    if (!Object.keys(files).some((n) => /\.(c|cpp|cc|cxx)$/i.test(n) && files[n].trim())) {
      intake.empty.push({ studentId: ids[0], problemId: 'main' });
      return;
    }
    const hash = snapshotHash(files, binaryFiles),
      key = createHash('sha256')
        .update(labId + '\0' + origin + '\0' + hash)
        .digest('hex'),
      root = path.join(src, ids[0], key);
    await mkdir(root, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      const target = path.join(root, workspacePath(name));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text, 'utf8');
    }
    for (const [name, base64] of Object.entries(binaryFiles)) {
      const target = path.join(root, workspacePath(name));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(base64, 'base64'));
    }
    const workspace: WorkspaceSnapshot = {
      files,
      ...(Object.keys(binaryFiles).length ? { binaryFiles } : {}),
      inheritDefaults: true,
    };
    intake.candidates.push({
      key,
      mode: 'project',
      labId,
      studentId: ids[0],
      problemId: 'main',
      language: Object.keys(files).some((n) => /\.(cpp|cc|cxx)$/i.test(n)) ? 'cpp' : 'c',
      source: '',
      workspace,
      hash,
      origin,
      file: path.relative(path.dirname(src), root),
    });
  }
  async function walk(dir: string, relative = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = path.join(dir, entry.name),
        origin = relative ? relative + '/' + entry.name : entry.name;
      try {
        if (entry.isSymbolicLink()) throw new Error('收件目录中存在符号链接');
        if (entry.isFile() && /\.zip$/i.test(entry.name))
          await candidate(origin, await archiveSnapshot(await readFile(full)));
        else if (entry.isDirectory()) {
          const children = await readdir(full, { withFileTypes: true }),
            direct = children.some(
              (e) =>
                e.name === 'LPMake.txt' || e.name === 'src' || /\.(c|cpp|cc|cxx)$/i.test(e.name),
            );
          if (direct && identify(origin).length === 1)
            await candidate(origin, await directorySnapshot(full));
          else await walk(full, origin);
        }
      } catch (e) {
        intake.issues.push({
          origin,
          message: e instanceof Error ? e.message : String(e),
          students: identify(origin),
          problemId: 'main',
          pending: true,
        });
      }
    }
  }
  if (await exists(submit)) await walk(submit);
  intake.candidates.sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0));
  return intake;
}
export function controlledStudentBuild(files: Record<string, string>) {
  // Teacher opt-in permits the declaration language only, never external file or tool hooks.
  const make = files['LPMake.txt'];
  if (!make)
    throw new ConfigError(
      '',
      0,
      'The submission is missing LPMake.txt.',
      'Include LPMake.txt in the project root.',
    );
  return make;
}
