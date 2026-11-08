import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';

for (const mode of ['problem-set', 'project'] as const) {
  test(
    'compact ' + mode + ' keeps editor, file controls, completion and search usable',
    async () => {
      const { app, page, close } = await qualityFixture();
      try {
        const lab = mode === 'project' ? 'CompactProject' : 'CompactSet';
        await page.evaluate(
          async ({ lab, mode }) => {
            await window.labpad.createLab(lab, mode);
            if (mode === 'problem-set') await window.labpad.createProblem(lab, 'Lab 1-1', 'c');
            const b = await window.labpad.bootstrap();
            await window.labpad.fileOperation(lab, b.draft.problem.problemId, {
              action: 'newFile',
              paths: ['notes.txt'],
              content: 'A small note.\n',
            });
            b.config.formatOnSave = false;
            b.config.zoomFactor = 1;
            await window.labpad.saveConfig(b.config, b.dataRoot);
            await window.labpad.fileView(lab, { sidebarWidth: 420, sidebarCollapsed: false });
          },
          { lab, mode },
        );
        const minimum = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getMinimumSize(),
        );
        expect(minimum).toEqual([640, 380]);
        const records = [];
        for (const [width, height] of [
          [640, 380],
          [640, 480],
          [683, 380],
          [683, 480],
        ]) {
          for (const theme of ['dark', 'light'] as const) {
            await app.evaluate(
              ({ BrowserWindow }, { width, height }) =>
                BrowserWindow.getAllWindows()[0].setContentSize(width, height),
              { width, height },
            );
            await page.evaluate(async (theme) => {
              const b = await window.labpad.bootstrap();
              b.config.theme = theme;
              await window.labpad.saveConfig(b.config, b.dataRoot);
              await window.labpad.saveLayout({ ...b.config.layout, editorPercent: 20 });
            }, theme);
            await page.reload();
            await page.locator('.toolbar').waitFor();
            await expect
              .poll(() =>
                page.locator('.editor-content').evaluate((e) => e.getBoundingClientRect().width),
              )
              .toBeGreaterThanOrEqual(240);
            const metrics = await page.evaluate(() =>
              Object.fromEntries(
                [
                  '.workspace-row',
                  '.workspace',
                  '.editor-content',
                  '.file-tree',
                  '.source-strip',
                  '.cases-heading',
                  '.bottom-heading',
                ].map((s) => {
                  const e = document.querySelector(s)!;
                  return [
                    s,
                    {
                      ...e.getBoundingClientRect().toJSON(),
                      client: e.clientWidth,
                      scroll: e.scrollWidth,
                    },
                  ];
                }),
              ),
            );
            expect(metrics['.file-tree'].width).toBeGreaterThanOrEqual(150);
            expect(metrics['.workspace-row'].scroll).toBeLessThanOrEqual(
              metrics['.workspace-row'].client + 1,
            );
            for (const selector of ['.source-strip', '.cases-heading', '.bottom-heading'])
              expect(metrics[selector].height).toBe(40);
            expect(
              (await page.evaluate(() => window.labpad.bootstrap())).workspace!.sidebarWidth,
            ).toBe(420);
            records.push({
              width,
              height,
              theme,
              editor: metrics['.editor-content'].width,
              tree: metrics['.file-tree'].width,
            });
          }
        }
        console.log('COMPACT_FLOWS ' + JSON.stringify({ mode, minimum, records }));
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setContentSize(640, 380),
        );
        await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
        await expect(page.locator('.file-tree')).toBeHidden();
        await expect(page.locator('.cm-content')).toBeVisible();
        await page.getByRole('button', { name: '显示文件', exact: true }).click();
        await expect(page.locator('.file-tree')).toBeVisible();
        const splitter = page.locator('.workspace > .splitpanes__splitter'),
          box = await splitter.boundingBox();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down();
        await page.mouse.move(15, box!.y + box!.height / 2, { steps: 8 });
        await page.mouse.up();
        await expect
          .poll(() =>
            page.locator('.editor-content').evaluate((e) => e.getBoundingClientRect().width),
          )
          .toBeGreaterThanOrEqual(240);
        await page.evaluate(() => {
          const events: unknown[] = ((window as any).__compactFocus = []);
          const record = (event: Event) => {
            const el = event.target as HTMLElement;
            if (
              event.type === 'focusin' ||
              ((event as KeyboardEvent).altKey && (event as KeyboardEvent).key === '/')
            )
              events.push({
                event: event.type,
                key: (event as KeyboardEvent).key,
                tag: el.tagName,
                role: el.getAttribute('role'),
                class: el.className,
              });
          };
          document.addEventListener('focusin', record);
          document.addEventListener('keydown', record, true);
        });
        const mainIndex = await page
          .locator('.source-tab')
          .evaluateAll((nodes) => nodes.findIndex((el) => el.classList.contains('active')));
        await page.locator('.tree-file[data-file="notes.txt"]').click();
        await expect(page.locator('.cm-content')).toContainText('A small note.');
        await page.locator('.source-tab').nth(mainIndex).click();
        const active = page.locator('.source-tab.active');
        await active.click({ button: 'right' });
        const menu = page.locator('.tab-context[data-state="open"]');
        await expect(
          menu.getByRole('menuitem', { name: '在文件管理器中显示', exact: true }),
        ).toBeVisible();
        const bounds = await menu.evaluate((e) => ({
          left: e.getBoundingClientRect().left,
          right: e.getBoundingClientRect().right,
          width: innerWidth,
        }));
        expect(bounds.left).toBeGreaterThanOrEqual(7);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width - 7);
        await page.keyboard.press('Escape');
        await page
          .locator('.cm-content')
          .fill('#include <stdio.h>\nint main(void) {\n    int result = 1;\n    pri');
        await page.keyboard.press('End');
        await page.keyboard.press('Alt+/');
        const completion = page.locator('.cm-tooltip-autocomplete');
        await expect(completion)
          .toBeVisible()
          .catch(async (error) => {
            console.log(
              'COMPACT_COMPLETION_FAILURE ' +
                JSON.stringify(
                  await page.evaluate(async () => {
                    const el = document.querySelector('.cm-content') as any,
                      view = el?.cmView?.view;
                    const draft = (await window.labpad.bootstrap()).draft;
                    return {
                      events: (window as any).__compactFocus,
                      active: document.activeElement?.outerHTML.slice(0, 350),
                      file: draft.file,
                      source: draft.source,
                      selection: view?.state.selection.main,
                      hasFocus: view?.hasFocus,
                    };
                  }),
                ),
            );
            throw error;
          });
        const first = completion.locator('li').first();
        const hit = await first.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const p = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!p && (p === e || e.contains(p));
        });
        expect(hit).toBe(true);
        await page.keyboard.press('Tab');
        await expect(page.locator('.cm-content')).toContainText('printf');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+f');
        const search = page.locator('.cm-search');
        await expect(search).toBeVisible();
        console.log(
          'SEARCH_GEOMETRY ' +
            JSON.stringify(
              await page.locator('.cm-editor').evaluate((e) => ({
                editor: e.getBoundingClientRect().height,
                scroller: e.querySelector('.cm-scroller')!.getBoundingClientRect().height,
                panel: e.querySelector('.cm-search')!.getBoundingClientRect().height,
              })),
            ),
        );
        await search.locator('input[name="search"]').fill('');
        await search.locator('input[name="search"]').pressSequentially('result');
        await page.keyboard.press('Enter');
        await expect(page.locator('.cm-selectionMatch,.cm-searchMatch')).not.toHaveCount(0);
        await search.locator('input[name="replace"]').fill('');
        await search.locator('input[name="replace"]').pressSequentially('value');
        await search.locator('button[name="replace"]').click();
        await expect(page.locator('.cm-content')).toContainText('int value');
        await search.locator('button[name="close"]').click();
        await page.locator('.cm-content').focus();
        await page.keyboard.press('Control+z');
        await expect(page.locator('.cm-content')).toContainText('int result');
        await page.locator('.cm-content').fill('int main(void){return 0;}');
        await page.getByRole('button', { name: '格式化代码', exact: true }).click();
        await expect(page.getByRole('button', { name: '格式化代码', exact: true })).toBeEnabled();
        await expect(page.locator('.cm-content')).toContainText('return 0;');
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setBounds({ width: 640, height: 380 }),
        );
        await expect
          .poll(() =>
            page.locator('.editor-content').evaluate((e) => e.getBoundingClientRect().width),
          )
          .toBeGreaterThanOrEqual(240);
        console.log(
          'MINIMUM_NATIVE_WINDOW ' +
            JSON.stringify(
              await app.evaluate(({ BrowserWindow }) => ({
                outer: BrowserWindow.getAllWindows()[0].getSize(),
                content: BrowserWindow.getAllWindows()[0].getContentSize(),
              })),
            ),
        );
        await expect(page.locator('.alert.error')).toHaveCount(0);
        await app.evaluate(async ({ BrowserWindow }, mode) => {
          const fs = process.getBuiltinModule('fs/promises')!,
            path = process.getBuiltinModule('path')!;
          await fs.writeFile(
            path.resolve(
              '../.work/rc1-final-audit',
              'compact-flow-' + mode + '-' + process.platform + '.png',
            ),
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG(),
          );
        }, mode);
      } finally {
        await close();
      }
    },
  );
}
