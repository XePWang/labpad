export function withFixtures(
  value: typeof import('playwright')._electron,
): typeof import('playwright')._electron;

export function closeApplication(app: import('playwright').ElectronApplication): Promise<void>;

export function compileAndRun(page: import('@playwright/test').Page, key?: string): Promise<void>;

export function compileOnly(page: import('@playwright/test').Page, key?: string): Promise<void>;
