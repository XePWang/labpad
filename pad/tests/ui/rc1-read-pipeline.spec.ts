import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
test('completion skips unrelated data and a compile state query reads one workspace snapshot', async () => {
  const { app, page, close } = await qualityFixture();
  try {
    const draft = await page.evaluate(async () => {
      await window.labpad.createLab('ReadScope', 'project');
      return (await window.labpad.bootstrap()).draft;
    });
    const directory = await page.evaluate(
      async () => (await window.labpad.bootstrap()).workspace!.scope,
    );
    await app.evaluate(async ({ ipcMain }, directory) => {
      const fs = process.getBuiltinModule('fs/promises') as any,
        path = process.getBuiltinModule('path')!;
      await fs.writeFile(path.join(directory, 'large.txt'), Buffer.alloc(8 * 1024 ** 2, 'a'));
      await fs.writeFile(path.join(directory, 'api.h'), 'int helper(void);\n');
      const { AsyncLocalStorage } = process.getBuiltinModule('async_hooks')!,
        scope = new AsyncLocalStorage<string>();
      const handlers = (ipcMain as any)._invokeHandlers;
      for (const channel of ['completion:files', 'compile:state']) {
        const original = handlers.get(channel);
        handlers.set(channel, (...args: any[]) => scope.run(channel, () => original(...args)));
      }
      const original = fs.open,
        counts = ((globalThis as any).__pipelineReads = {} as Record<string, number>);
      fs.open = async (...args: any[]) => {
        const handle = await original(...args),
          channel = scope.getStore();
        if (channel && path.basename(String(args[0])) === 'large.txt')
          counts[channel] = (counts[channel] ?? 0) + 1;
        return handle;
      };
      (globalThis as any).__restorePipeline = () => {
        fs.open = original;
        process.getBuiltinModule('module')!.syncBuiltinESMExports();
      };
      process.getBuiltinModule('module')!.syncBuiltinESMExports();
    }, directory);
    const files = await page.evaluate(() => window.labpad.completionFiles('ReadScope', ''));
    expect(files.files['api.h']).toContain('helper');
    await page.evaluate((d) => window.labpad.compileState(d), draft);
    const counts = await app.evaluate(() => (globalThis as any).__pipelineReads);
    console.log('PIPELINE_READS ' + JSON.stringify(counts));
    expect(counts['completion:files'] ?? 0).toBe(0);
    expect(counts['compile:state']).toBe(1);
  } finally {
    await app.evaluate(() => (globalThis as any).__restorePipeline?.()).catch(() => {});
    await close();
  }
});
