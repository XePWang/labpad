import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { qualityFixture } from './quality-fixture';
import type { Compilation } from '../../shared/types';

type Toolchain = { name: string; kind: 'gcc' | 'clang'; cPath: string; cppPath: string };
const configured: Toolchain[] = JSON.parse(process.env.LABPAD_TEST_TOOLCHAINS ?? '[]');
if (!configured.length && process.env.LABPAD_RC2_GCC && process.env.LABPAD_RC2_GXX)
  configured.push({
    name: 'GCC',
    kind: 'gcc',
    cPath: process.env.LABPAD_RC2_GCC,
    cppPath: process.env.LABPAD_RC2_GXX,
  });
const scenarios = (configured.length ? configured : [undefined]).flatMap((toolchain) =>
  (['c', 'cpp'] as const).map((language) => ({ toolchain, language })),
);

for (const { language, toolchain } of scenarios) {
  test(
    'topic ' +
      language +
      ' uses the selected build for compilation and keeps debug sessions isolated' +
      (toolchain ? ' with ' + toolchain.name : ''),
    async () => {
      test.setTimeout(240000);
      const { app, page, root, close } = await qualityFixture();
      const picker = page.locator('.build-profile-trigger');
      const phase = page.locator('.phase');
      const compile = page.getByRole('button', { name: '编译', exact: true });
      const runTests = page
        .locator('.cases-heading')
        .getByRole('button', { name: '运行全部测试点' });
      const source =
        '#include <stdio.h>\nint main(void) {\n    volatile int score = 7;\n    printf("%d\\n", score);\n    return 0;\n}\n';
      try {
        const filename = path.join(root, 'course.json');
        await writeFile(
          filename,
          JSON.stringify({
            schemaVersion: 1,
            kind: 'labpad.project',
            labId: '构型实验',
            buildOptions: {
              inheritDefaults: false,
              cArgs: ['-O3', '-g0'],
              cppArgs: ['-O3', '-g0'],
              linkArgs: ['-O1', '-s'],
            },
            problems: [
              {
                problemId: '练习',
                language,
                source,
                testCases: [{ id: 'one', input: '', expectedOutput: '7\n' }],
              },
            ],
          }),
        );
        await app.evaluate(({ dialog }, file) => {
          const mock = ((globalThis as any).__profileTest = {
            choice: '取消',
            prompts: [] as Electron.MessageBoxOptions[],
          });
          dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: [file],
          })) as typeof dialog.showOpenDialog;
          dialog.showMessageBox = (async (_win, options) => {
            mock.prompts.push(options);
            const action = options.buttons?.indexOf(mock.choice) ?? -1;
            return {
              response: action < 0 ? (options.cancelId ?? 0) : action,
              checkboxChecked: false,
            };
          }) as typeof dialog.showMessageBox;
        }, filename);
        if (toolchain)
          await page.evaluate(async ({ kind, cPath, cppPath }) => {
            const { config, dataRoot } = await window.labpad.bootstrap();
            config.compiler = { ...config.compiler, mode: 'custom', kind, cPath, cppPath };
            await window.labpad.saveConfig(config, dataRoot);
          }, toolchain);
        await page.evaluate(() => {
          (window as any).__buildResults = [];
          window.labpad.onJudge((event) => {
            if (event.type === 'compilation')
              (window as any).__buildResults.push(event.compilation);
          });
        });
        const lastCompilation = () =>
          page.evaluate(() => (window as any).__buildResults.at(-1) as Compilation | undefined);
        const compileCount = () =>
          page.evaluate(() => (window as any).__buildResults.length as number);
        const lastCommand = async () => (await lastCompilation())!.command;
        const optimization = (args: string[]) => args.filter((arg) => arg.startsWith('-O'));
        const chooseProfile = async (value: 'Debug' | 'Release') => {
          await picker.press('ArrowDown');
          const item = page.getByRole('menuitemcheckbox').filter({ hasText: value });
          await expect(item).toBeVisible();
          await item.click();
          await expect(picker).toHaveText(value);
        };
        const clickCompile = async () => {
          const before = await compileCount();
          await compile.click();
          await expect.poll(compileCount, { timeout: 90000 }).toBeGreaterThan(before);
          const result = (await lastCompilation())!;
          expect(result.status, JSON.stringify(result)).toBe('success');
          await expect(phase).toHaveText('编译成功', { timeout: 90000 });
          await expect(runTests).toBeEnabled();
        };
        const decision = async (label: string) => {
          await app.evaluate((_, value) => {
            (globalThis as any).__profileTest.choice = value;
          }, label);
        };

        await page.locator('.toolbar').getByRole('button', { name: '导入', exact: true }).click();
        await page.getByRole('menuitem', { name: /^导入实验项目…?$/ }).click();
        await expect(picker).toHaveText('Debug');
        await expect(picker.locator('svg')).toHaveCount(1);
        await expect(phase).toHaveText('未编译');
        await chooseProfile('Release');
        await clickCompile();
        const release = await lastCommand();
        if (toolchain)
          expect(path.normalize(release[0])).toBe(
            path.normalize(language === 'c' ? toolchain.cPath : toolchain.cppPath),
          );
        expect(optimization(release)).toEqual(['-O2']);
        await runTests.click();
        await expect(page.locator('.verdict.ac')).toHaveCount(1);
        await expect(runTests).toBeEnabled();

        await chooseProfile('Debug');
        await expect(phase).toHaveText('未编译');
        await expect(runTests).toBeDisabled();
        await expect(page.locator('.verdict.ac')).toHaveCount(0);
        await chooseProfile('Release');
        await expect(runTests).toBeEnabled();
        await expect(page.locator('.verdict.ac')).toHaveCount(1);
        await page.keyboard.press('F5');
        await expect
          .poll(() => app.evaluate(() => (globalThis as any).__profileTest.prompts.length))
          .toBe(1);
        await expect(picker).toHaveText('Release');
        await expect(runTests).toBeEnabled();

        const line = await page.locator('.cm-line').nth(3).boundingBox();
        const gutter = await page.locator('.source-debug-gutter').boundingBox();
        if (!line || !gutter) throw Error('Missing source breakpoint gutter');
        await page.mouse.click(gutter.x + gutter.width / 2, line.y + line.height / 2);
        if (language === 'c') {
          await page.mouse.click(gutter.x + gutter.width / 2, line.y + line.height / 2, {
            button: 'right',
          });
          await page.getByRole('textbox', { name: '断点条件' }).fill('score == 7');
          await page.getByRole('button', { name: '应用', exact: true }).click();
        }
        await decision('切换为 Debug 并调试（推荐）');
        await page.keyboard.press('F5');
        await expect(phase).toHaveText('调试已暂停', { timeout: 90000 });
        await expect(picker).toHaveText('Debug');
        await expect(page.locator('.native-debug-panel')).toContainText('score');
        const debug = await lastCommand();
        expect(optimization(debug)).toEqual(['-O0']);
        expect(debug).toContain('-g');
        expect(debug).not.toContain('-s');
        await page.keyboard.press('F10');
        await expect(phase).toHaveText('调试已暂停');
        await page.getByRole('button', { name: '停止调试', exact: true }).click();
        await expect(picker).toBeEnabled();
        await page.getByRole('tab', { name: '测试点', exact: true }).click();
        await expect(runTests).toBeDisabled();

        await chooseProfile('Release');
        await expect(runTests).toBeEnabled();
        await page.getByRole('tab', { name: '调试', exact: true }).click();
        await decision('仍以 Release 调试');
        await page.locator('.cases-heading').getByRole('button', { name: '开始调试' }).click();
        await expect(phase).toHaveText('调试已暂停', { timeout: 90000 });
        const releaseDebug = await lastCommand();
        expect(optimization(releaseDebug)).toEqual(['-O2']);
        expect(releaseDebug).toContain('-g');
        expect(releaseDebug).not.toContain('-s');
        expect(releaseDebug.at(-1)).not.toBe(release.at(-1));
        await page.getByRole('button', { name: '停止调试', exact: true }).click();
        await page.getByRole('tab', { name: '测试点', exact: true }).click();
        await expect(runTests).toBeEnabled();
        await runTests.click();
        await expect(page.locator('.verdict.ac')).toHaveCount(1);
        await expect(runTests).toBeEnabled();

        if (language === 'c') {
          await chooseProfile('Debug');
          await page.keyboard.press('F5');
          await expect(phase).toHaveText('调试已暂停', { timeout: 90000 });
          const oldBuild = await lastCommand();
          const editor = page.locator('.cm-content');
          await editor.click();
          await page.keyboard.press('ControlOrMeta+End');
          await page.keyboard.insertText('\n/* saved during restart */');
          await expect(page.locator('.debug-source-changed')).toBeVisible();
          const restart = page.getByRole('button', { name: '重启调试', exact: true });
          await decision('取消');
          await restart.click();
          await expect(restart).toBeEnabled();
          expect(await lastCommand()).toEqual(oldBuild);
          await expect(phase).toHaveText('调试已暂停');
          await decision('保存并重启');
          await restart.click();
          await expect
            .poll(async () => (await lastCommand()).at(-1), { timeout: 90000 })
            .not.toBe(oldBuild.at(-1));
          await expect(phase).toHaveText('调试已暂停', { timeout: 90000 });
          await expect(page.locator('.debug-source-changed')).toHaveCount(0);
          await page.getByRole('button', { name: '停止调试', exact: true }).click();
        }
        await expect(picker).toBeEnabled();
        await page.getByRole('tab', { name: '测试点', exact: true }).click();
        if ((await picker.innerText()) !== 'Debug') await chooseProfile('Debug');
        await clickCompile();
        expect(optimization(await lastCommand())).toEqual(['-O0']);
        await runTests.click();
        await expect(page.locator('.verdict.ac')).toHaveCount(1);
        await expect(runTests).toBeEnabled();
      } finally {
        await close();
      }
    },
  );
}

test('the profile picker fits the 640px toolbar in both languages and is hidden in a project', async () => {
  const { app, page, close } = await qualityFixture();
  const longName = 'Program Design Fundamentals — Introductory Laboratory';
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(640, 450),
    );
    await page.evaluate(async (name) => {
      await window.labpad.createLab(name, 'problem-set');
      await window.labpad.createProblem(name, 'Long problem title in the assignment file', 'c');
    }, longName);
    for (const language of ['zh-CN', 'en-US'] as const) {
      await page.evaluate(async (locale) => {
        const { config, dataRoot } = await window.labpad.bootstrap();
        await window.labpad.saveConfig({ ...config, uiLanguage: locale }, dataRoot);
      }, language);
      await page.reload();
      const choice = page.locator('.build-profile-trigger');
      await expect(choice).toHaveText('Debug');
      await expect(choice.locator('svg')).toBeVisible();
      await expect(page.locator('.toolbar-more-trigger')).toBeVisible();
      const metrics = await page.locator('.toolbar').evaluate((bar) => {
        const profile = bar.querySelector('.build-profile-trigger')!.getBoundingClientRect();
        const compile = bar.querySelector('.run-actions .primary')!.getBoundingClientRect();
        const more = bar.querySelector('.toolbar-more-trigger')!.getBoundingClientRect();
        return {
          fits:
            bar.scrollWidth <= bar.clientWidth + 1 &&
            more.right <= bar.getBoundingClientRect().right,
          aligned: Math.abs(profile.top - compile.top) <= 1,
          order: profile.right <= compile.left,
        };
      });
      expect(metrics).toEqual({ fits: true, aligned: true, order: true });
      await choice.press('ArrowDown');
      await expect(page.getByRole('menuitemcheckbox').filter({ hasText: 'Release' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.labpad.createLab('Sample project', 'project'));
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('.build-profile-trigger')).toHaveCount(0);
  } finally {
    await close();
  }
});
