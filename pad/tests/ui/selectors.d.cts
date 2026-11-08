import type { Page, Locator } from '@playwright/test';
interface Selection { selectOption(value: string): Promise<void>; inputValue(): Promise<string | null>; }
export function project(page: Page): Selection;
export function zoom(page: Page): Selection;
export function topic(page: Page): Selection & { isDisabled(): Promise<boolean>; boundingBox(): ReturnType<Locator['boundingBox']>; };
