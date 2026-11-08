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
    if (!info.isFile()) throw new Error('请选择普通文件。');
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
    const warnings = await cleanupAll([{ label: '文件句柄', run: () => handle.close() }]);
    if (failure) addCleanupNotes(failure, warnings);
    else if (warnings.length) throw Error(cleanupText(warnings).trim());
  }
}

export const readEditableFile = (file: string) =>
  readFileLimited(
    file,
    EDITOR_FILE_BYTES,
    '文件超过 8 MB，无法在编辑器中打开。请在文件管理器中查看。',
  );
export const readArchiveFile = (file: string) =>
  readFileLimited(
    file,
    ARCHIVE_FILE_BYTES,
    '压缩包超过 100 MB，无法导入。请移除构建产物后重新打包。',
  );
export const readConfigFile = (file: string) =>
  readFileLimited(file, CONFIG_FILE_BYTES, '配置文件超过 100 MB，无法导入。');
