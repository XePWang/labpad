import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setLanguage, t, msg, renderMessage, UIError, errorText } from '../shared/i18n';
import { defaultConfig } from '../shared/defaults';
import { validateConfig } from '../shared/validate';
import { operationError } from '../shared/errors';

test('locale resources have matching keys and intact argument placeholders', () => {
  const zh = JSON.parse(
    fs.readFileSync(new URL('../shared/locales/zh-CN.json', import.meta.url), 'utf8'),
  );
  const en = JSON.parse(
    fs.readFileSync(new URL('../shared/locales/en-US.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const placeholders = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const key of Object.keys(en)) {
    assert.equal(en[key], key);
    assert.deepEqual(placeholders(zh[key]), placeholders(key), key);
    assert.equal((zh[key].match(/\$/g) ?? []).length, (key.match(/\$/g) ?? []).length, key);
  }
});
test('saved language is optional for old settings and rejects unsupported values', () => {
  const config = defaultConfig();
  delete config.uiLanguage;
  assert.equal(validateConfig(config).uiLanguage, undefined);
  assert.equal(validateConfig({ ...config, uiLanguage: 'en-US' }).uiLanguage, 'en-US');
  assert.throws(() => validateConfig({ ...config, uiLanguage: 'unsupported' }));
});
test('messages and IPC errors render in the current language without changing raw diagnostics', () => {
  try {
    setLanguage('zh-CN');
    const message = msg('Built-in {0}', 'Zig');
    const error = new UIError('Close {0}', 'main.c');
    const raw = 'main.c:1: error: 中文 source text';
    assert.equal(renderMessage(message), '内置 Zig');
    setLanguage('en-US');
    assert.equal(renderMessage(message), 'Built-in Zig');
    assert.equal(
      renderMessage(
        errorText(
          JSON.parse(JSON.stringify({ message: error.message, localization: error.localization })),
        ),
      ),
      'Close main.c',
    );
    assert.equal(renderMessage(raw), raw);
    assert.equal(
      operationError({ message: "Error invoking remote method 'test': Error: actual cause" }),
      'actual cause',
    );
  } finally {
    setLanguage('zh-CN');
  }
});
