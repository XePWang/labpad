import { UIError } from './i18n';
export const shortcutActions = [
  ['run', 'Compile', ['F9', 'Control+Enter']],
  ['save', 'Save Current', ['$mod+KeyS']],
  ['saveAll', 'Save All', ['$mod+Shift+KeyS']],
  ['format', 'Format Code', ['Shift+Alt+KeyF']],
  ['close', 'Close Tab', ['Control+F4']],
  ['closeSaved', 'Close Saved', ['$mod+KeyK KeyU']],
  ['closeAll', 'Close All Tabs', ['$mod+KeyK KeyW']],
  ['next', 'Next Tab', ['Control+Tab']],
  ['previous', 'Previous Tab', ['Control+Shift+Tab']],
  ['copyPath', 'Copy Path', ['Shift+Alt+KeyC']],
  ['copyRelativePath', 'Copy Relative Path', ['Control+Shift+Alt+KeyC']],
  ['interrupt', 'Interrupt Program', ['Control+KeyC']],
  ['newSource', 'New Source', ['$mod+KeyN']],
  ['importSource', 'Import Source', ['$mod+KeyO']],
  ['settings', 'Settings', ['$mod+Comma']],
  ['reopen', 'Reopen Recent Source', ['$mod+Shift+KeyT']],
  ['debugStart', 'Start / Continue Debugging', ['F5']],
  ['debugNext', 'Step Over', ['F10']],
  ['debugInto', 'Step Into', ['F11']],
  ['debugOut', 'Step Out', ['Shift+F11']],
  ['debugRestart', 'Restart Debugging', ['$mod+Shift+F5']],
  ['debugStop', 'Stop Debugging', ['Shift+F5']],
] as const;
export function macPlatform(platform?: string) {
  return /mac|darwin/i.test(
    platform ?? (typeof navigator !== 'undefined' ? navigator.platform : process.platform),
  );
}
export function defaultShortcuts(platform?: string): Record<string, string[]> {
  const value: Record<string, string[]> = Object.fromEntries(
    shortcutActions.map(([id, , keys]) => [id, [...keys]]),
  );
  if (macPlatform(platform))
    Object.assign(value, {
      saveAll: ['$mod+Alt+KeyS'],
      close: ['$mod+KeyW'],
      copyPath: ['$mod+KeyK KeyP'],
      copyRelativePath: [],
    });
  return value;
}
export function migrateShortcuts(value?: Record<string, string[]>, platform?: string) {
  const defaults = defaultShortcuts(platform),
    legacy = Object.fromEntries(shortcutActions.map(([id, , keys]) => [id, [...keys]]));
  if (!value) return defaults;
  for (const [id, keys] of Object.entries(value))
    if (id in defaults) {
      defaults[id] =
        macPlatform(platform) && JSON.stringify(keys) === JSON.stringify(legacy[id])
          ? defaults[id]
          : keys;
    }
  return defaults;
}
export function validateShortcuts(value: unknown, platform?: string): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UIError('Invalid shortcut settings');
  const map = value as Record<string, string[]>,
    used: string[] = [],
    mod = macPlatform(platform) ? 'meta' : 'control';
  for (const [id] of shortcutActions) {
    const keys = map[id];
    if (
      !Array.isArray(keys) ||
      keys.length > 3 ||
      keys.some((k) => typeof k !== 'string' || !k.trim())
    )
      throw new UIError('Invalid shortcut settings: {0}', id);
    for (const key of keys) {
      const parts = key.trim().split(' ');
      if (
        parts.length > 2 ||
        parts.some(
          (p) => !/^((\$mod|Control|Alt|Shift|Meta)\+)*([A-Za-z][A-Za-z0-9]*|[0-9])$/.test(p),
        )
      )
        throw new UIError('Invalid shortcut format: {0}', key);
      const canonical = parts
        .map((p) => {
          const bits = p.toLowerCase().replace(/\$mod/g, mod).split('+'),
            last = bits.pop();
          return bits.sort().join('+') + '+' + last;
        })
        .join(' ');
      if (
        used.some(
          (k) => k === canonical || k.startsWith(canonical + ' ') || canonical.startsWith(k + ' '),
        )
      )
        throw new UIError('Duplicate shortcut or conflicting chord prefix: {0}', key);
      if (/^(alt\+f4|alt\+control\+delete|meta\+key[qhm])$/.test(canonical))
        throw new UIError('This shortcut is reserved by the system: {0}', key);
      used.push(canonical);
    }
  }
  return map;
}
