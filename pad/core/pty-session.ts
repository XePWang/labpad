import type { IPty } from 'node-pty';
export interface PtyExit {
  exitCode: number;
  signal?: number;
}
export function managePty(
  child: IPty,
  options: { data: (text: string) => void; terminate: () => Promise<void>; stopTimeoutMs?: number },
) {
  let ended = false,
    pending = '',
    unacked = 0,
    paused = false;
  let scheduled: ReturnType<typeof setTimeout> | undefined, stopping: Promise<void> | undefined;
  let complete!: (result: PtyExit) => void;
  const finished = new Promise<PtyExit>((resolve) => (complete = resolve));
  const flush = () => {
    if (scheduled) clearTimeout(scheduled);
    scheduled = undefined;
    if (pending) {
      const value = pending;
      pending = '';
      options.data(value);
    }
  };
  const data = child.onData((value) => {
    if (ended) return;
    pending += value;
    unacked += value.length;
    if (unacked > 262144 && !paused) {
      paused = true;
      child.pause();
    }
    if (!scheduled) scheduled = setTimeout(flush, 16);
  });
  const exit = child.onExit((result) => {
    if (ended) return;
    ended = true;
    try {
      flush();
    } finally {
      data.dispose();
      exit.dispose();
      complete(result);
    }
  });
  const acknowledge = (size: number) => {
    if (ended || !Number.isSafeInteger(size) || size <= 0) return;
    unacked = Math.max(0, unacked - size);
    if (paused && unacked < 65536) {
      paused = false;
      child.resume();
    }
  };
  async function stop() {
    if (ended) return;
    if (stopping) return stopping;
    const task = (async () => {
      if (paused) {
        paused = false;
        child.resume();
      }
      try {
        await options.terminate();
      } catch (error) {
        if (!ended) throw error;
      }
      if (ended) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          finished,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(Error('程序尚未退出，请重试停止。')),
              options.stopTimeoutMs ?? 2500,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    stopping = task;
    try {
      await task;
    } finally {
      if (stopping === task) stopping = undefined;
    }
  }
  return { pid: child.pid, finished, acknowledge, stop };
}
