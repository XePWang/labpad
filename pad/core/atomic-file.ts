import writeFileAtomic from 'write-file-atomic';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const tails = new Map<string, Promise<void>>();
/** Keep an entire save ordered, including Windows retries of a temporarily locked rename. */
export default function writeAtomic(
  file: string,
  data: Parameters<typeof writeFileAtomic>[1],
  options?: Parameters<typeof writeFileAtomic>[2],
): Promise<void> {
  const absolute = path.resolve(file),
    key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const task = (tails.get(key) ?? Promise.resolve()).then(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await writeFileAtomic(file, data, options);
        return;
      } catch (error) {
        const reason = error as NodeJS.ErrnoException;
        if (
          process.platform !== 'win32' ||
          reason.syscall !== 'rename' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(reason.code ?? '') ||
          attempt >= 4
        )
          throw error;
        await delay(50 * 2 ** attempt);
      }
    }
  });
  const barrier = task.then(
    () => {},
    () => {},
  );
  tails.set(key, barrier);
  void barrier.then(() => {
    if (tails.get(key) === barrier) tails.delete(key);
  });
  return task;
}
