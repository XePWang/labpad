import { UIError, t as localize } from './i18n';
import { macPlatform } from './shortcuts';
const labels: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Esc',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: 'Semicolon',
  Quote: "'",
  Backquote: String.fromCharCode(96),
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
};
const macLabels: Record<string, string> = { Enter: '↩', Backspace: '⌫', Delete: '⌦', Tab: '⇥' };
const keyCodes = new Map(
  Object.entries({ ...labels, ...macLabels }).map(([code, label]) => [label.toLowerCase(), code]),
);
keyCodes.set('分号', 'Semicolon');
export function formatShortcut(binding: string, platform: string): string {
  const mac = macPlatform(platform),
    meta = /win/i.test(platform) ? 'Win' : 'Super';
  return binding
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      const bits = stroke.split('+'),
        key = bits.pop()!,
        mods = bits.map((m) => (m === '$mod' ? (mac ? 'Meta' : 'Control') : m)),
        order = ['Control', 'Alt', 'Shift', 'Meta'] as const;
      const names = order
        .filter((m) => mods.includes(m))
        .map((m) =>
          mac
            ? { Control: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }[m]
            : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: meta }[m],
        );
      const label = key.replace(/^Key([A-Z])$/, '$1').replace(/^Digit([0-9])$/, '$1'),
        visible =
          (mac ? macLabels[key] : undefined) ??
          labels[key] ??
          (key.startsWith('Numpad') ? 'Num' + key.slice(6) : label);
      const displayed = key === 'Semicolon' ? localize('Semicolon') : visible;
      return mac ? names.join('') + displayed : [...names, displayed].join('+');
    })
    .join(' ');
}
export function parseShortcutLabel(value: string, platform: string): string {
  const replaced = value
    .trim()
    .replace(
      /[⌃⌥⇧⌘]\+?/g,
      (g) =>
        (({ '⌃': 'Control+', '⌥': 'Alt+', '⇧': 'Shift+', '⌘': 'Meta+' }) as Record<string, string>)[
          g[0]
        ],
    )
    .replace(/\s*\+\s*/g, '+');
  if (!replaced) throw new UIError('Record or enter a shortcut');
  const modNames: Record<string, string> = {
    ctrl: 'Control',
    control: 'Control',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    cmd: 'Meta',
    command: 'Meta',
    meta: 'Meta',
    win: 'Meta',
    super: 'Meta',
    $mod: macPlatform(platform) ? 'Meta' : 'Control',
  };
  return replaced
    .split(/\s+/)
    .map((stroke) => {
      const bits = stroke.split('+'),
        label = bits.pop()!,
        mods = bits.map((m) => {
          const name = modNames[m.toLowerCase()];
          if (!name) throw new UIError('Unrecognized modifier key: {0}', m);
          return name;
        });
      let key =
        keyCodes.get(label.toLowerCase()) ??
        (/^[a-z]$/i.test(label)
          ? 'Key' + label.toUpperCase()
          : /^[0-9]$/.test(label)
            ? 'Digit' + label
            : /^num/i.test(label)
              ? 'Numpad' + label.slice(3)
              : label);
      const aliases: Record<string, string> = {
        esc: 'Escape',
        tab: 'Tab',
        enter: 'Enter',
        space: 'Space',
        backspace: 'Backspace',
        delete: 'Delete',
        home: 'Home',
        end: 'End',
        insert: 'Insert',
      };
      key = aliases[key.toLowerCase()] ?? key;
      if (
        !/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Escape|Tab|Enter|Space|Backspace|Delete|Home|End|Insert|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|Minus|Equal|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/.test(
          key,
        )
      )
        throw new UIError('Unrecognized key “{0}”. Try recording the shortcut.', label);
      return [...mods, key].join('+');
    })
    .join(' ');
}
