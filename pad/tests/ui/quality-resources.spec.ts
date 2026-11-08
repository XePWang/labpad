import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
import { open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileAndRun } from './legacy-flow.cjs';
async function memorySamples(app: any) {
  const read = () =>
    app.evaluate(({ app }: any) =>
      Object.fromEntries(
        app
          .getAppMetrics()
          .filter((p: any) => ['Browser', 'Tab'].includes(p.type))
          .map((p: any) => [p.type + '-' + p.pid, p.memory.workingSetSize]),
      ),
    );
  const first = await read(),
    peaks = { ...first };
  let running: Promise<void> | undefined;
  const sample = () => {
    if (running) return;
    running = read()
      .then((value: any) => {
        for (const [k, v] of Object.entries(value)) peaks[k] = Math.max(peaks[k] ?? 0, v as number);
      })
      .finally(() => (running = undefined));
  };
  const timer = setInterval(sample, 100);
  return async () => {
    clearInterval(timer);
    await running;
    const last = await read();
    console.log(
      'RESOURCE_MEMORY_KiB ' +
        JSON.stringify({ first, sampledPeaks: peaks, last, intervalMs: 100 }),
    );
  };
}
test('native editor and project archive requests reject metadata oversize and keep the window usable', async () => {
  const { app, page, root, close } = await qualityFixture();
  const finishMemory = await memorySamples(app);
  try {
    await page.evaluate(async () => {
      await window.labpad.createLab('资源边界', 'project');
    });
    await page.reload();
    await page.locator('.toolbar').waitFor();
    const state = await page.evaluate(() => window.labpad.bootstrap()),
      large = path.join(state.dataRoot, 'projects', '资源边界', 'large.txt');
    let h = await open(large, 'w');
    await h.truncate(8 * 1024 * 1024 + 1);
    await h.close();
    const message = await page.evaluate(async () => {
      try {
        await window.labpad.workspaceOpen('资源边界', 'large.txt');
        return 'not rejected';
      } catch (e) {
        return String(e);
      }
    });
    expect(message).toContain('8 MB');
    const zip = path.join(root, 'oversize.zip');
    h = await open(zip, 'w');
    await h.truncate(100 * 1024 * 1024 + 1);
    await h.close();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, zip);
    const problem = await page.evaluate(async () => {
      try {
        await window.labpad.importProject();
        return 'not rejected';
      } catch (e) {
        return String(e);
      }
    });
    expect(problem).toContain('100 MB');
    await page.locator('.toolbar button').filter({ hasText: '设置' }).click();
    await expect(page.locator('.settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).toHaveCount(0);
  } finally {
    try {
      await finishMemory();
    } finally {
      await close();
    }
  }
});
test('large token mismatch opens a budgeted Diff while preserving full judging output', async () => {
  const { app, page, root, close } = await qualityFixture();
  const finishMemory = await memorySamples(app);
  try {
    const expected = Array.from({ length: 6000 }, (_, i) => 'a' + i).join(' '),
      file = path.join(root, 'diff.json');
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'labpad.project',
        labId: '差异预算',
        problems: [
          {
            problemId: 'one',
            source:
              '#include <stdio.h>\nint main(void){for(int i=0;i<6000;i++)printf("b%d ",i);return 0;}',
            testCases: [{ id: 'tokens', input: '', expectedOutput: expected }],
          },
        ],
      }),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await page.evaluate(() => window.labpad.importProject());
    await page.reload();
    await page.locator('.toolbar').waitFor();
    await compileAndRun(page);
    await page.getByRole('button', { name: '查看 Diff', exact: true }).click();
    await expect(page.locator('.diff-note')).toBeVisible();
    await page.getByRole('button', { name: '查看原文', exact: true }).click();
    await expect(page.locator('.actual-output')).toContainText('b5999');
    await page.locator('.toolbar button').filter({ hasText: '设置' }).click();
    await expect(page.locator('.settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    try {
      await finishMemory();
    } finally {
      await close();
    }
  }
});
