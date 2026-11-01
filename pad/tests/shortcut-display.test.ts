import test from 'node:test';import assert from 'node:assert/strict';import {formatShortcut,parseShortcutLabel} from '../shared/shortcut-display';import {defaultShortcuts,validateShortcuts} from '../shared/shortcuts';
test('Windows/Linux/Mac resolve platform modifiers to actual key labels',()=>{
 assert.equal(formatShortcut('$mod+Shift+KeyS','win32'),'Ctrl+Shift+S');assert.equal(formatShortcut('$mod+Shift+KeyS','linux'),'Ctrl+Shift+S');assert.equal(formatShortcut('$mod+Alt+KeyS','darwin'),'⌥⌘S');
 assert.equal(formatShortcut('Control+Enter','darwin'),'⌃↩');assert.equal(formatShortcut('$mod+KeyK KeyU','darwin'),'⌘K U');assert.equal(formatShortcut('Meta+KeyA','linux'),'Super+A');assert.equal(formatShortcut('Meta+KeyA','win32'),'Win+A');
});
test('all default bindings roundtrip through visible labels on each OS with no wildcard or key codes exposed',()=>{
 for(const platform of ['win32','linux','darwin']){
  const raw=defaultShortcuts(platform),parsed:Record<string,string[]>={};
  for(const [id,keys] of Object.entries(raw))parsed[id]=keys.map(key=>{const label=formatShortcut(key,platform);assert.ok(!label.includes('$mod')&&!/Key[A-Z]/.test(label),label);return parseShortcutLabel(label,platform);});
  assert.doesNotThrow(()=>validateShortcuts(parsed,platform));
  assert.deepEqual(parsed.run,['F9','Control+Enter']);assert.deepEqual(parsed.save,[platform==='darwin'?'Meta+KeyS':'Control+KeyS']);
 }
});
test('punctuation, navigation, chords and native Mac symbols remain concrete',()=>{
 for(const key of ['Control+Comma','Control+Slash','Alt+Semicolon','Control+ArrowUp','Shift+PageDown','Control+Backslash','Alt+NumpadAdd'])for(const platform of ['win32','linux','darwin'])assert.equal(parseShortcutLabel(formatShortcut(key,platform),platform),key);
 assert.equal(parseShortcutLabel('Ctrl + K U','win32'),'Control+KeyK KeyU');assert.equal(parseShortcutLabel('⇧⌘S','darwin'),'Shift+Meta+KeyS');
 assert.equal(parseShortcutLabel('Cmd+Option+F','darwin'),'Meta+Alt+KeyF');assert.throws(()=>parseShortcutLabel('Ctrl+Mystery','win32'),/无法识别/);
});
test('human-readable editing still rejects collisions and reserved system shortcuts',()=>{
 const keys=defaultShortcuts('darwin');keys.run=[parseShortcutLabel('⌘Q','darwin')];assert.throws(()=>validateShortcuts(keys,'darwin'),/系统/);
 const win=defaultShortcuts('win32');win.run=[parseShortcutLabel('Ctrl+S','win32')];assert.throws(()=>validateShortcuts(win,'win32'),/重复/);
});
