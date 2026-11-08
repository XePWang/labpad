import { openSettings } from './settings-helper.cjs';
import { test, expect } from '@playwright/test';
import { qualityFixture as fixture } from './quality-fixture';
import { project } from './selectors.cjs';
test('native dialog semantic ids preserve cancellation and safe defaults', async () => {
  const { app, page, close } = await fixture();
  try {
    await page.evaluate(() => window.labpad.createLab('DialogProject', 'project'));
    await app.evaluate(({ dialog }) => {
      (globalThis as any).__dialogs = [];
      dialog.showMessageBox = async (...args: any[]) => {
        const value = args.at(-1);
        (globalThis as any).__dialogs.push(value);
        return { response: value.cancelId, checkboxChecked: false };
      };
    });
    const result = await page.evaluate(async () => [
      await window.labpad.confirmUnsaved(),
      await window.labpad.confirmCompile(),
      await window.labpad.confirmRestart(),
      await window.labpad.confirmExternal('main.c'),
      await window.labpad.deleteProject('DialogProject'),
    ]);
    expect(result).toEqual(['cancel', false, false, false, false]);
    const dialogs = await app.evaluate(() => (globalThis as any).__dialogs);
    expect(dialogs).toHaveLength(5);
    for (const d of dialogs) {
      expect(d.defaultId).toBeGreaterThanOrEqual(0);
      expect(d.defaultId).toBeLessThan(d.buttons.length);
      expect(d.cancelId).toBe(process.platform === 'linux' ? 0 : d.buttons.length - 1);
    }
    expect(dialogs.at(-1).defaultId).toBe(dialogs.at(-1).cancelId);
    console.log(
      'DIALOGS ' +
        JSON.stringify(
          dialogs.map((d: any) => ({
            title: d.title,
            buttons: d.buttons,
            default: d.defaultId,
            cancel: d.cancelId,
          })),
        ),
    );
  } finally {
    await close();
  }
});
test('shared modal actions maintain platform order, keyboard focus and cancellation', async () => {
  const { page, close } = await fixture();
  try {
    async function actions(root: any, positive: string, cancel: string) {
      const rows = root.locator('.dialog-actions button');
      await expect(rows.last()).toBeEnabled();
      const labels = (await rows.allTextContents()).map((v: string) => v.trim());
      expect(labels[0]).toBe(process.platform === 'win32' ? positive : cancel);
      expect(labels.at(-1)).toBe(process.platform === 'win32' ? cancel : positive);
      expect(await root.evaluate((el: any) => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(root).toHaveCount(0);
    }
    await openSettings(page);
    await actions(page.locator('.settings-dialog'), '保存设置', '取消');
    await project(page).selectOption('@new:lab');
    const create = page.locator('.create-dialog');
    await expect(create.getByRole('textbox', { name: '项目名称', exact: true })).toBeFocused();
    await create.getByRole('textbox', { name: '项目名称', exact: true }).fill('KeyboardProject');
    await create.getByRole('combobox', { name: '项目类型', exact: true }).selectOption('project');
    await create.getByRole('textbox', { name: '项目名称', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(create).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '实验项目', exact: true })).toHaveAttribute(
      'data-value',
      'KeyboardProject',
    );
    await page.getByRole('combobox', { name: '实验项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '构建设置…', exact: true }).click();
    await actions(page.locator('.build-settings'), '应用', '取消');
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByRole('menuitem', { name: '导出实验项目', exact: true }).click();
    await page
      .locator('.export-dialog')
      .getByRole('button', { name: '下一步', exact: true })
      .click();
    await actions(page.locator('.export-dialog'), '仍然导出', '取消导出');
  } finally {
    await close();
  }
});
test('completion rows keep long signatures inside the viewport in both themes', async () => {
  const { app, page, close } = await fixture();
  try {
    const measurements = [];
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async (theme) => {
        const b = await window.labpad.bootstrap();
        b.config.theme = theme as 'dark' | 'light';
        await window.labpad.saveConfig(b.config, b.dataRoot);
      }, theme);
      await page.reload();
      await page.locator('.toolbar').waitFor();
      const name = 'candidate_' + 'long_name_'.repeat(6),
        signature = Array.from(
          { length: 9 },
          (_, i) => 'int argument_with_a_long_descriptive_name_' + i,
        ).join(', ');
      await page
        .locator('.cm-content')
        .fill('void ' + name + '(' + signature + ');\nint main(void){\n candidate');
      await page.locator('.cm-content').focus();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Alt+/');
      await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected=true]')).toHaveCount(1);
      const geometry = await page.evaluate(() => {
        const t = document.querySelector('.cm-tooltip-autocomplete')!,
          li = t.querySelector('li')!,
          label = li.querySelector('.cm-completionLabel')!,
          detail = li.querySelector('.cm-completionDetail')!,
          r = t.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          viewport: innerWidth,
          scroll: t.scrollWidth,
          client: t.clientWidth,
          labelWidth: label.getBoundingClientRect().width,
          detailWidth: detail.getBoundingClientRect().width,
          selected: getComputedStyle(li).backgroundColor,
          font: getComputedStyle(li).fontSize,
        };
      });
      measurements.push({ theme, ...geometry });
      expect(geometry.selected).not.toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({
        path:
          '../.work/quality-consolidation/completion-' + theme + '-' + process.platform + '.png',
      });
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
      await page.keyboard.press('Escape');
    }
    console.log('COMPLETION_GEOMETRY ' + JSON.stringify(measurements));
  } finally {
    await close();
  }
});

test('all sixteen zoom presets retain reachable modal actions and the selected zoom item', async () => {
  const { page, close } = await fixture();
  try {
    const records = [];
    for (const percent of [
      25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400,
    ]) {
      await page.evaluate(async (value) => {
        const b = await window.labpad.bootstrap();
        b.config.zoomFactor = value / 100;
        await window.labpad.saveConfig(b.config, b.dataRoot);
      }, percent);
      await page.reload();
      await page.locator('.toolbar').waitFor();
      console.log('ZOOM_BEGIN ' + percent);
      await openSettings(page);
      const dialog = page.locator('.settings-dialog');
      const size = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: innerWidth,
          height: innerHeight,
        };
      });
      records.push({ percent, ...size });
      expect(size.left).toBeGreaterThanOrEqual(-1);
      expect(size.right).toBeLessThanOrEqual(size.width + 1);
      expect(size.top).toBeGreaterThanOrEqual(-1);
      expect(size.bottom).toBeLessThanOrEqual(size.height + 1);
      await dialog.getByRole('combobox', { name: '界面缩放', exact: true }).click();
      const selected = page.locator('.zoom-options [data-state="checked"]');
      await expect(selected).toHaveText(percent + '%');
      await expect(selected).toBeInViewport();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
    console.log('ZOOM_GEOMETRY ' + JSON.stringify(records));
  } finally {
    await close();
  }
});

test('1280x720 windows keep UI fonts separate from opposite code-size extremes', async () => {
  const { app, page, close } = await fixture();
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 720));
    for (const [theme, english, chinese] of [
      ['dark', 8, 40],
      ['light', 40, 8],
    ] as const) {
      await page.evaluate(
        async (value) => {
          const b = await window.labpad.bootstrap();
          b.config.theme = value.theme;
          b.config.typography = {
            ...b.config.typography!,
            englishSize: value.english,
            chineseSize: value.chinese,
          };
          await window.labpad.saveConfig(b.config, b.dataRoot);
        },
        { theme, english, chinese },
      );
      await page.reload();
      await page.locator('.toolbar').waitFor();
      await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', english + 'px');
      await page.locator('.cm-content').fill('#include <stdio.h>\nint main(void){\n pri');
      await page.locator('.cm-content').focus();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Alt+/');
      await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
      await expect(page.locator('.cm-tooltip-autocomplete li').first()).toHaveCSS(
        'font-size',
        english + 'px',
      );
      await page.keyboard.press('Escape');
      await openSettings(page);
      expect(
        await page.locator('.settings-dialog').evaluate((el) => getComputedStyle(el).fontFamily),
      ).not.toContain('LabPad Latin');
      await page.keyboard.press('Escape');
      await expect(page.locator('.settings-dialog')).toHaveCount(0);
    }
  } finally {
    await close();
  }
});
