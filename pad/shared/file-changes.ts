export interface FileChange {
  from?: string;
  to?: string;
  copied?: boolean;
  replaced?: boolean;
}
const key = (value: string) => value.normalize('NFC').toLowerCase();
export const under = (file: string, parent: string) =>
  key(file) === key(parent) || key(file).startsWith(key(parent) + '/');
/** Map references against a committed batch, without remapping copies or chaining sibling moves. */
export function remapPath(file: string, changes: FileChange[]): string | undefined {
  for (const change of changes)
    if (change.from && !change.copied && under(file, change.from))
      return change.to ? change.to + file.slice(change.from.length) : undefined;
  return file;
}
export const replacedPath = (file: string, changes: FileChange[]) =>
  changes.some(
    (change) =>
      change.replaced &&
      change.to &&
      under(file, change.to) &&
      !(change.from && !change.copied && under(file, change.from)),
  );
