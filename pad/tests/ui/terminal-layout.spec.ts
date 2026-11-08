import { openSettings } from './settings-helper.cjs';
import { test, expect, _electron, type Page } from '@playwright/test';
import { withFixtures } from './legacy-flow.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const tail = (page: Page) =>
  page
    .locator('.xterm-rows>div')
    .allTextContents()
    .then((lines) =>
      lines
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1),
    );
async function enter(page: Page, text: string, prompt: string) {
  await page.locator('.terminal-viewport textarea').focus();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await expect.poll(() => tail(page)).toBe(prompt);
}

for (const scale of [1, 1.25])
  test('terminal viewport, shared text metrics and nested prompts at scale ' + scale, async () => {
    test.setTimeout(120000);
    const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-terminal-layout-'));
    const app = await withFixtures(_electron).launch({
      executablePath: process.env.LABPAD_TEST_EXECUTABLE,
      cwd: process.cwd(),
      args: [
        ...(process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.']),
        '--force-device-scale-factor=' + scale,
      ],
      env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
    });
    try {
      const page = await app.firstWindow();
      await page.locator('.toolbar').waitFor();
      await page.evaluate(async () => {
        await window.labpad.createLab('TextFixture', 'project');
      });
      await page.reload();
      await page.locator('.toolbar').waitFor();
      await page.getByRole('button', { name: '＋ 新增测试点', exact: true }).click();
      await page.getByRole('button', { name: '终端', exact: true }).click();
      await expect.poll(() => tail(page)).toBe('>');
      await enter(page, 'mkdir 文件夹1', '>');
      await enter(page, 'cd 文件夹1', '文件夹1>');
      await enter(page, 'mkdir 文件夹2', '文件夹1>');
      await enter(page, 'cd 文件夹2', '文件夹1/文件夹2>');
      await enter(page, 'pwd', '文件夹1/文件夹2>');
      await expect(page.locator('.xterm-rows')).toContainText('文件夹1/文件夹2> pwd');
      await enter(page, 'cd ..', '文件夹1>');
      await enter(page, 'cd ..', '>');
      for (const profile of [
        { english: 14, chinese: 14, theme: 'dark' },
        { english: 18, chinese: 26, theme: 'dark' },
        { english: 21, chinese: 17, theme: 'light' },
      ]) {
        await openSettings(page);
        await page
          .getByRole('spinbutton', { name: '英文字号', exact: true })
          .fill(String(profile.english));
        await page
          .getByRole('spinbutton', { name: '中文字号', exact: true })
          .fill(String(profile.chinese));
        await page.getByRole('combobox', { name: '主题', exact: true }).selectOption(profile.theme);
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        await expect(page.locator('.settings-dialog')).toHaveCount(0);
        await expect
          .poll(() => page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontSize))
          .toBe(profile.english + 'px');
        const family = await page
          .locator('.cm-scroller')
          .evaluate((el) => getComputedStyle(el).fontFamily);
        for (const selector of [
          '.xterm-rows',
          '.output-log',
          '.io-pair textarea',
          '.actual-output',
        ]) {
          await expect
            .poll(() =>
              page
                .locator(selector)
                .first()
                .evaluate((el) => getComputedStyle(el).fontFamily),
            )
            .toBe(family);
          expect(
            await page
              .locator(selector)
              .first()
              .evaluate((el) => getComputedStyle(el).fontSize),
          ).toBe(profile.english + 'px');
        }
        await expect
          .poll(() =>
            page.evaluate(() => {
              const editor = parseFloat(
                getComputedStyle(document.querySelector('.cm-scroller')!).lineHeight,
              );
              const row = document.querySelector('.xterm-rows>div')!;
              return Math.abs(parseFloat(getComputedStyle(row).lineHeight) - editor);
            }),
          )
          .toBeLessThan(1.6);
        const viewport = page.locator('.terminal-viewport .xterm-viewport');
        expect(await viewport.evaluate((el) => getComputedStyle(el).overflowX)).toBe('hidden');
        expect(await viewport.evaluate((el) => getComputedStyle(el).overflowY)).toBe('hidden');
        expect(await viewport.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
          await page.locator('.output-log').evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        await expect
          .poll(() =>
            page.locator('.terminal-viewport').evaluate((el) => {
              const box = el.getBoundingClientRect(),
                screen = el.querySelector('.xterm-screen')!.getBoundingClientRect();
              return Math.max(screen.right - box.right, screen.bottom - box.bottom);
            }),
          )
          .toBeLessThanOrEqual(1);
        await enter(page, 'pwd', '>');
      }
      await page.evaluate(() =>
        window.labpad.fileOperation('TextFixture', '', {
          action: 'newFile',
          paths: ['lines.txt'],
          content: Array.from({ length: 120 }, (_, i) => 'line' + String(i).padStart(3, '0')).join(
            '\n',
          ),
        }),
      );
      await enter(page, 'clear', '>');
      await enter(page, 'cat lines.txt', '>');
      await expect(page.locator('.xterm-rows')).toContainText('line119');
      await page.locator('.xterm-screen').hover();
      await page.mouse.wheel(0, -500);
      await expect.poll(() => tail(page)).not.toBe('>');
      const track = page.locator('.xterm-scrollable-element>.scrollbar.vertical');
      const thumb = track.locator('.slider');
      const box = (await track.boundingBox())!,
        handle = (await thumb.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 1, { steps: 8 });
      await page.mouse.up();
      await expect(page.locator('.xterm-rows')).toContainText('line000');
      const topHandle = (await thumb.boundingBox())!;
      await page.mouse.move(topHandle.x + topHandle.width / 2, topHandle.y + topHandle.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 1, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => tail(page)).toBe('>');
      await page.screenshot({
        path: path.resolve(
          '../.work/dev9-terminal-fix/terminal-' + process.platform + '-' + scale + '.png',
        ),
      });
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

test('fresh scratch is saved on disk and missing-source save-and-compile restores a real file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-initial-source-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.toolbar').waitFor();
    const initial = await page.evaluate(async () => {
      const state = await window.labpad.bootstrap();
      return window.labpad.compileState(state.draft);
    });
    expect(initial.saved).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        const opts = args.at(-1);
        return {
          response: Math.max(0, opts.buttons.indexOf('保存并编译')),
          checkboxChecked: false,
        };
      };
    });
    const file = await page.evaluate(async () => {
      const state = await window.labpad.bootstrap();
      state.config.formatOnSave = false;
      if (navigator.platform.includes('Linux'))
        state.config.compiler = {
          ...state.config.compiler,
          mode: 'custom',
          kind: 'gcc',
          cPath: '/usr/bin/gcc',
          cppPath: '/usr/bin/g++',
        };
      await window.labpad.saveConfig(state.config, state.dataRoot);
      return state.draft.sourceFile!;
    });
    expect(path.resolve(file).startsWith(path.resolve(root) + path.sep)).toBe(true);
    await app.evaluate(async (_, file) => {
      await process.getBuiltinModule('node:fs/promises').unlink(file);
    }, file);
    await page.evaluate(() => window.labpad.reloadDocument());
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await expect(page.locator('.tab-dirty')).toHaveCount(1);
    await page
      .locator('.cm-content')
      .fill('#include <stdio.h>\nint main(void){puts("restored");return 0;}\n');
    await page.getByRole('button', { name: '编译', exact: true }).click();
    await expect(page.locator('.xterm-rows')).toContainText('restored', { timeout: 60000 });
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const state = await page.evaluate(async () =>
      window.labpad.compileState((await window.labpad.bootstrap()).draft),
    );
    expect(state.saved).toBe(true);
    expect(state.ready).toBe(true);
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
