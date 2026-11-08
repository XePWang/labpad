export interface CleanupStep {
  label: string;
  run: () => unknown | Promise<unknown>;
}
/** Run every release independently, including when a callback throws synchronously. */
export async function cleanupAll(steps: CleanupStep[]): Promise<string[]> {
  const results = await Promise.allSettled(steps.map((step) => Promise.resolve().then(step.run)));
  return results.flatMap((result, i) =>
    result.status === 'rejected'
      ? [
          steps[i].label +
            '：' +
            (result.reason instanceof Error ? result.reason.message : String(result.reason)),
        ]
      : [],
  );
}
export function cleanupText(warnings: string[]): string {
  return warnings.length ? '\n[清理未完成] ' + warnings.join('；') : '';
}
export function addCleanupNotes(error: Error, warnings: string[]): void {
  if (warnings.length) error.message += cleanupText(warnings);
}
