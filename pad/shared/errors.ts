/** Strip Electron's IPC wrapper while keeping the application's actual error. */
export function operationError(value: unknown): string {
  let text =
    value instanceof Error
      ? value.message
      : value &&
          typeof value === 'object' &&
          typeof (value as { message?: unknown }).message === 'string'
        ? (value as { message: string }).message
        : String(value);
  text = text
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, '')
    .replace(/^(?:(?:Error|UIError):\s*)+/, '');
  return text;
}
