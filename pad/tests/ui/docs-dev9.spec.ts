import { openSettings } from './settings-helper.cjs';
import { test, expect, _electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('current release guide screenshots', async () => {
  test.setTimeout(120000);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'labpad-doc-')),
    app = await _electron.launch({
      executablePath: process.env.LABPAD_TEST_EXECUTABLE,
      cwd: process.cwd(),
      args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, LABPAD_DATA_DIR: path.join(dir, 'labpad'), LABPAD_SKIP_WARMUP: '1' },
    });
  try {
    const page = await app.firstWindow();
    const guideVersion = await app.evaluate(({app}) => app.getVersion());
    page.setDefaultTimeout(15000);
    await page.locator('.toolbar').waitFor();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        const o = args.at(-1);
        return {
          response:
            o.buttons.indexOf('保存并编译') >= 0
              ? o.buttons.indexOf('保存并编译')
              : o.buttons.indexOf('不保存') >= 0
                ? o.buttons.indexOf('不保存')
                : (o.defaultId ?? 0),
          checkboxChecked: false,
        };
      };
    });
    await page.evaluate(async () => {
      const b = await window.labpad.bootstrap();
      b.config.formatOnSave = false;
      b.config.compiler = {
        ...b.config.compiler,
        mode: 'custom',
        kind: 'gcc',
        cPath: '/usr/bin/gcc',
        cppPath: '/usr/bin/g++',
      };
      await window.labpad.saveConfig(b.config, b.dataRoot);
      await window.labpad.createLab('计算练习', 'project');
    });
    await page.reload();
    await page.locator('.file-tree').waitFor();
    const images = path.resolve('../doc', guideVersion, 'images'),
      shot = (name: string) =>
        page.screenshot({
          path: path.join(images, name.replace(/^dev9-/, '') + '.png'),
          fullPage: true,
        });
    await page
      .locator('.cm-content')
      .fill(
        '#include <stdio.h>\n\nint main(void) {\n    int sum = 0;\n    for (int i = 0; i < 4; ++i) {\n        sum += i;\n    }\n    printf("Sum = %d\\n", sum);\n    return 0;\n}\n',
      );
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('menuitem', { name: '保存全部', exact: true }).click();
    await page.getByRole('button', { name: '＋ 新增测试点', exact: true }).click();
    await page.getByRole('textbox', { name: '预期输出 1' }).fill('Sum = 6\n');
    await page.getByRole('button', { name: '编译', exact: true }).click();
    await expect(page.locator('.phase')).toHaveText('编译成功', { timeout: 45000 });
    await page.locator('.cases-heading .run-test-icon').click();
    await expect(page.locator('.verdict.ac')).toHaveCount(1);
    await expect(page.locator('.test-summary')).toHaveClass(/all-passed/);
    await expect
      .poll(
        async () =>
          (await page
            .locator('.test-summary')
            .evaluate((el) => getComputedStyle(el).backgroundColor)) ===
          (await page.locator('.case-card').evaluate((el) => getComputedStyle(el).backgroundColor)),
      )
      .toBe(true);
    expect(await page.locator('.cases-heading .run-test-icon svg path').getAttribute('fill')).toBe(
      'currentColor',
    );
    await shot('dev9-workspace-dark');
    await page.locator('.source-debug-gutter .cm-gutterElement').nth(6).click({ button: 'right' });
    await page.getByRole('textbox', { name: '断点条件' }).fill('i == 2');
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await page.getByRole('tab', { name: '调试', exact: true }).click();
    await expect(
      page.locator('.cases-heading').getByRole('button', { name: '开始调试', exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.cases-heading').getByRole('button', { name: '构建设置…', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '开始调试', exact: true }).first().click();
    await expect(page.locator('.phase')).toHaveText('调试已暂停', { timeout: 45000 });
    const dot = await page.locator('.right-tabs .live-dot').boundingBox(),
      tab = await page.getByRole('tab', { name: /调试/ }).boundingBox();
    expect(Math.abs(dot!.y + dot!.height / 2 - tab!.y - tab!.height / 2)).toBeLessThan(2);
    const terminalDot = await page.locator('.bottom-heading .live-dot').boundingBox(),
      terminalTab = await page
        .locator('.bottom-heading button')
        .filter({ hasText: '终端' })
        .boundingBox();
    expect(
      Math.abs(terminalDot!.y + terminalDot!.height / 2 - terminalTab!.y - terminalTab!.height / 2),
    ).toBeLessThan(2);
    await shot('dev9-debug-dark');
    await page.getByRole('button', { name: '停止调试', exact: true }).click();
    await expect(page.locator('.phase')).toHaveText('调试结束');
    await page.getByRole('tab', { name: '测试点', exact: true }).click();
    await expect(
      page.locator('.file-tree').getByRole('button', { name: '项目构建设置…', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('combobox', { name: '实验项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '构建设置…', exact: true }).click();
    await page.locator('.build-settings').waitFor();
    await shot('dev9-build-settings');
    await page
      .locator('.build-settings')
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.locator('summary').filter({ hasText: '高级编译参数' }).click();
    await settings.locator('.parameter-settings').scrollIntoViewIfNeeded();
    await expect(settings.locator('.parameter-preview')).toContainText('C · main.c');
    await expect(settings.locator('.source-diagnostic')).toHaveCount(0);
    await shot('dev9-settings');
    await settings.locator('.typography-settings').scrollIntoViewIfNeeded();
    await shot('dev9-font-settings');
    await settings.getByRole('combobox', { name: '主题', exact: true }).selectOption('light');
    await settings.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.locator('[data-file="main.c"]').click();
    await shot('dev9-workspace-light');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
