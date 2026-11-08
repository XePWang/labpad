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
  } finally {
    await handle.close();
  }
}
