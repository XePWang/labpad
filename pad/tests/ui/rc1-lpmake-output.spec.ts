import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('LPMake build errors appear in Output without a duplicate top banner', async () => {
  const { app, page, close } = await qualityFixture();
  try {
    await page.evaluate(() => window.labpad.createLab('Diagnostics', 'project'));
    await page.reload();
    await page.locator('.tree-file[data-file="LPMake.txt"]').click();
    await page
      .locator('.cm-content')
      .fill('target("app")\nset_language("cpp")\nadd_files("./*.c")\n');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.source-tab.active .save-status')).toHaveText('已保存');
    await page.getByRole('button', { name: '编译', exact: true }).click();
    await expect(page.locator('.output-log')).toContainText(
      'LPMake.txt:2:14: error: Unsupported language',
    );
    await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
    console.log('LPMAKE_OUTPUT ' + JSON.stringify(await page.locator('.output-log').innerText()));
    await expect(page.locator('.alert.error')).toHaveCount(0);
  } finally {
    await close();
  }
});

test('syntax, resolution, debugger and terminal LPMake failures use Output and recover to real C compilation', async () => {
  test.setTimeout(150000);
  const { app, page, close } = await qualityFixture();
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => ({
        response: args.at(-1).buttons.indexOf('保存并编译'),
        checkboxChecked: false,
      });
    });
    await page.evaluate(async (platform) => {
      await window.labpad.createLab('DiagnosticRoutes', 'project');
      const b = await window.labpad.bootstrap();
      b.config.formatOnSave = false;
      if (platform === 'linux')
        b.config.compiler = {
          ...b.config.compiler,
          mode: 'custom',
          kind: 'gcc',
          cPath: '/usr/bin/gcc',
          cppPath: '/usr/bin/g++',
        };
      await window.labpad.saveConfig(b.config, b.dataRoot);
    }, process.platform);
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const writeMake = async (text: string) => {
      await page.locator('.tree-file[data-file="LPMake.txt"]').click();
      await page.locator('.cm-content').fill(text);
      await page.keyboard.press('Control+s');
      await expect(page.locator('.source-tab.active .save-status')).toHaveText('已保存');
    };
    const check = async (contains: string) => {
      await expect(page.locator('.output-log')).toContainText(contains);
      await expect(
        page.locator('.bottom-tabs').getByRole('button', { name: '输出', exact: true }),
      ).toHaveClass(/active/);
      await expect(page.locator('.alert.error')).toHaveCount(0);
      await expect(page.locator('.diagnostic-count[aria-label="错误 1"]')).toHaveCount(1);
      await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
      console.log(
        'DIAGNOSTIC_ROUTE ' + JSON.stringify(await page.locator('.output-log').innerText()),
      );
    };
    for (const [source, reason] of [
      ['target("app"', 'Unexpected end of file'],
      ['target("app")\nadd_defiens("X")', 'Unknown command'],
      ['target("app")\nadd_files("./missing.c")', 'missing.c'],
    ]) {
      await writeMake(source);
      await page.getByRole('button', { name: '编译', exact: true }).click();
      await check(reason);
      expect(
        (
          await page.evaluate(async () =>
            window.labpad.compileState((await window.labpad.bootstrap()).draft),
          )
        ).ready,
      ).toBe(false);
    }
    await writeMake('target("app")\nset_language("cpp")\nadd_files("./*.c")\n');
    await page.locator('.cases-heading').getByRole('tab', { name: '调试', exact: true }).click();
    await page
      .locator('.cases-heading')
      .getByRole('button', { name: '开始调试', exact: true })
      .click();
    await check('Unsupported language');
    await page.locator('.bottom-tabs').getByRole('button', { name: '终端', exact: true }).click();
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('lpmake b');
    await page.keyboard.press('Enter');
    await check('Unsupported language');
    await writeMake('target("app")\nset_standard("c17")\nset_mode("debug")\nadd_files("./*.c")\n');
    await page.locator('.tree-file[data-file="main.c"]').click();
    await page.locator('.cm-content').fill('int main(void) { return unknown_symbol; }\n');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.source-tab.active .save-status')).toHaveText('已保存');
    await page.getByRole('button', { name: '编译', exact: true }).click();
    await expect(page.locator('.output-log')).toContainText('unknown_symbol');
    await expect(page.locator('.output-log')).toContainText('编译状态：CE');
    await expect(page.locator('.alert.error')).toHaveCount(0);
    console.log(
      'REAL_COMPILER_ERROR ' + JSON.stringify(await page.locator('.output-log').innerText()),
    );
    await page.locator('.cm-content').fill('int main(void) { return 0; }\n');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.source-tab.active .save-status')).toHaveText('已保存');
    await page.getByRole('button', { name: '编译', exact: true }).click();
    await expect(page.locator('.output-log')).toContainText('编译状态：success');
    await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
    await expect(page.locator('.alert.error')).toHaveCount(0);
  } finally {
    await close();
  }
});
