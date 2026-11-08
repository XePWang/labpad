import { UIError, t as localize } from '../shared/i18n';
import { cleanupAll, addCleanupNotes, cleanupText } from './cleanup';
import {
  EDITOR_FILE_BYTES,
  ARCHIVE_FILE_BYTES,
  CONFIG_FILE_BYTES,
} from '../shared/resource-limits';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';

/** Check metadata first, then enforce the byte limit while reading a growing file. */
export async function readFileLimited(
  file: string,
  limit: number,
  message: string,
): Promise<Buffer> {
  const handle = await open(
    file,
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK),
  );
  let failure: Error | undefined;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new UIError('Choose a regular file.');
    if (info.size > limit) throw new Error(message);
    const chunks: Buffer[] = [];
    let size = 0;
    while (size <= limit) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit - size + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw new Error(message);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw failure;
  } finally {
    const warnings = await cleanupAll([
      { label: localize('File Handle'), run: () => handle.close() },
    ]);
    if (failure) addCleanupNotes(failure, warnings);
    else if (warnings.length) throw Error(cleanupText(warnings).trim());
  }
}

export const readEditableFile = (file: string) =>
  readFileLimited(
    file,
    EDITOR_FILE_BYTES,
    localize(
      'This file exceeds 8 MB and cannot be opened in the editor. View it in the file manager.',
    ),
  );
export const readArchiveFile = (file: string) =>
  readFileLimited(
    file,
    ARCHIVE_FILE_BYTES,
    localize(
      'This archive exceeds 100 MB. Remove build outputs and create a new archive before importing.',
    ),
  );
export const readConfigFile = (file: string) =>
  readFileLimited(
    file,
    CONFIG_FILE_BYTES,
    localize('This configuration file exceeds 100 MB and cannot be imported.'),
  );
