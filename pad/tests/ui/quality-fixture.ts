import { expect, _electron } from '@playwright/test';
import { withFixtures, closeApplication } from './legacy-flow.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export async function qualityFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-quality-ui-'));
  const app = await withFixtures(_electron).launch({
    executablePath: process.env.LABPAD_TEST_EXECUTABLE,
    cwd: process.cwd(),
    args: process.env.LABPAD_TEST_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, LABPAD_DATA_DIR: path.join(root, 'data'), LABPAD_SKIP_WARMUP: '1' },
  });
  const page = await app.firstWindow();
  await page.locator('.toolbar').waitFor();
  return {
    app,
    page,
    root,
    close: async () => {
      await closeApplication(app);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
