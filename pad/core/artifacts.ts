import { UIError } from '../shared/i18n';
import { mkdir, readFile, readdir, lstat, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from './atomic-file';
import { workspacePath } from '../shared/workspace';
export interface BuildManifest {
  schemaVersion: 1;
  kind: 'labpad.build';
  owner: string;
  files: string[];
}
export async function buildManifest(directory: string): Promise<BuildManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(directory, '.labpad-build.json'), 'utf8'));
    if (
      value?.schemaVersion === 1 &&
      value.kind === 'labpad.build' &&
      typeof value.owner === 'string' &&
      Array.isArray(value.files)
    ) {
      value.files.forEach(workspacePath);
      return value;
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
  }
  return undefined;
}
export async function prepareBuildDirectory(directory: string, owner: string, files: string[]) {
  files.forEach(workspacePath);
  let existing = await buildManifest(directory);
  const info = await lstat(directory).catch((e: any) => {
    if (e.code !== 'ENOENT') throw e;
    return undefined;
  });
  if (info && (info.isSymbolicLink() || !info.isDirectory()))
    throw new UIError('The build location is not a regular folder: {0}', path.basename(directory));
  if (info && (!existing || existing.owner !== owner))
    throw new UIError(
      'The build folder already exists and belongs to something else. Rename or move it first.',
    );
  const owned = new Set(existing?.files ?? []);
  for (const name of files)
    if (!owned.has(name) && (await lstat(path.join(directory, name)).catch(() => undefined)))
      throw new UIError(
        'The build location contains an unmanaged file: {0}. Move it elsewhere first.',
        name,
      );
  await mkdir(directory, { recursive: true });
  const manifest: BuildManifest = {
    schemaVersion: 1,
    kind: 'labpad.build',
    owner,
    files: [...new Set([...(existing?.files ?? []), ...files])],
  };
  await writeFileAtomic(
    path.join(directory, '.labpad-build.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return manifest;
}
export async function cleanBuildDirectory(directory: string, owner: string) {
  const manifest = await buildManifest(directory);
  if (!manifest || manifest.owner !== owner)
    throw new UIError('There are no LabPad build outputs to clean in this directory.');
  for (const name of manifest.files) {
    let file = directory;
    for (const part of name.split('/')) {
      file = path.join(file, part);
      const st = await lstat(file).catch(() => undefined);
      if (st?.isSymbolicLink())
        throw new UIError('A build output path contains a symbolic link. Cleanup was stopped.');
    }
    await rm(path.join(directory, name), { force: true });
  }
  async function removeEmpty(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true }))
      if (e.isDirectory() && !e.isSymbolicLink()) await removeEmpty(path.join(dir, e.name));
    if (dir !== directory)
      await rmdir(dir).catch((e: any) => {
        if (!['ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
      });
  }
  await removeEmpty(directory);
  await writeFileAtomic(
    path.join(directory, '.labpad-build.json'),
    JSON.stringify({ ...manifest, files: [] }, null, 2) + '\n',
  );
}
