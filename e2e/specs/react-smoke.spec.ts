import { expect } from '@playwright/test';
import { test } from '../fixtures/harness.js';

// Smoke test for `@smalldat/sandycoast/react`: does the package's React entry
// point actually resolve and render a working chart? Not a scenario replica
// of component.spec.ts — those specs exercise chart behavior in depth through
// the vanilla API, which the React bindings wrap without changing.
test.describe('react bindings', () => {
  test('imports @smalldat/sandycoast/react and mounts a chart', async ({ page, pkg }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    const path = pkg === 'dist' ? '/react-packaged.html' : '/react.html';
    await page.goto(path);
    await page.waitForFunction(() => !!window.__scReact?.ready, undefined, { timeout: 15_000 });

    expect(await page.evaluate(() => window.__scReact?.backend)).toBe('canvas2d');
    expect(await page.locator('#host canvas').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
