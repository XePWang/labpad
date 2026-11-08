import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('native saves handle transient rename locks and retain dirty text after persistent failures', async () => {
  const { app, page, close } = await qualityFixture();
  try {
    await page.evaluate(async () => {
      const b = await window.labpad.bootstrap();
      b.config.formatOnSave = false;
      await window.labpad.saveConfig(b.config, b.dataRoot);
      await window.labpad.createLab('AtomicFixture', 'project');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const first = 'int main(void){return 42;}\n';
    await page.locator('.cm-content').fill(first);
    async function inject(failures: number) {
      await app.evaluate((_, limit) => {
        const f = process.getBuiltinModule('node:fs');
        (globalThis as any).__rename ??= f.rename;
        (globalThis as any).__renameCalls = 0;
        f.rename = ((...args: any[]) => {
          if (String(args[1]).includes('AtomicFixture') && String(args[1]).endsWith('main.c')) {
            (globalThis as any).__renameCalls++;
            if ((globalThis as any).__renameCalls <= limit) {
              queueMicrotask(() =>
                args.at(-1)(
                  Object.assign(Error('Injected rename lock'), {
                    code: 'EPERM',
                    syscall: 'rename',
                  }),
                ),
              );
              return;
            }
          }
          return (globalThis as any).__rename(...args);
        }) as typeof f.rename;
      }, failures);
    }
    async function restore() {
      await app.evaluate(() => {
        const f = process.getBuiltinModule('node:fs');
        f.rename = (globalThis as any).__rename;
      });
    }
    async function save() {
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('menuitem', { name: '保存当前', exact: true }).click();
    }
    await inject(2);
    await save();
    if (process.platform === 'win32') {
      await expect(page.locator('.tab-dirty')).toHaveCount(0);
      expect(await app.evaluate(() => (globalThis as any).__renameCalls)).toBe(3);
    } else {
      await expect(page.getByRole('alert')).toContainText('Injected rename lock');
      expect(await app.evaluate(() => (globalThis as any).__renameCalls)).toBe(1);
      await expect(page.locator('.tab-dirty')).toHaveCount(1);
      await restore();
      await save();
      await expect(page.locator('.tab-dirty')).toHaveCount(0);
    }
    await restore();
    expect(
      (await page.evaluate(() => window.labpad.workspaceOpen('AtomicFixture', 'main.c'))).source,
    ).toBe(first);
    const next = first + '// pending\n';
    await page.locator('.cm-content').fill(next);
    await inject(100);
    await save();
    await expect(page.getByRole('alert')).toContainText('Injected rename lock');
    await expect(page.locator('.tab-dirty')).toHaveCount(1);
    expect(await app.evaluate(() => (globalThis as any).__renameCalls)).toBe(
      process.platform === 'win32' ? 5 : 1,
    );
    await restore();
    expect(
      (await page.evaluate(() => window.labpad.workspaceOpen('AtomicFixture', 'main.c'))).source,
    ).toBe(first);
    await save();
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.labpad.workspaceOpen('AtomicFixture', 'main.c'))).source,
    ).toBe(next);
  } finally {
    await app
      .evaluate(() => {
        if ((globalThis as any).__rename)
          process.getBuiltinModule('node:fs').rename = (globalThis as any).__rename;
      })
      .catch(() => {});
    await close();
  }
});
