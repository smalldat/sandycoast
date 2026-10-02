import { expect } from '@playwright/test';
import { test } from '../fixtures/harness.js';

// Smoke test for `@smalldat/sandycoast/react`: does the package's React entry
// point actually resolve and render a working chart? Not a scenario replica
// of component.spec.ts — those specs exercise chart behavior in depth through
// the vanilla API, which the React bindings wrap without changing. What is
// asserted here beyond mounting is the binding-specific lifecycle: prop
// changes and events crossing the React/vanilla boundary (see react-app.tsx).
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

  test('applies a data change dispatched from the parent mount effect', async ({ page, pkg }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(pkg === 'dist' ? '/react-packaged.html' : '/react.html');
    await page.waitForFunction(() => !!window.__scReact?.ready, undefined, { timeout: 15_000 });

    // The harness sets series C from a mount effect, batched with the commit
    // that publishes the chart instance. Legend entries follow the applied
    // data, so a swallowed update shows up as a missing entry.
    await expect(page.locator('#bar-host')).toContainText('C', { timeout: 5_000 });
    expect(errors).toEqual([]);
  });

  test('draws the `layers` prop and delivers `onClick` with the mark', async ({ page, pkg }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(pkg === 'dist' ? '/react-packaged.html' : '/react.html');
    await page.waitForFunction(() => !!window.__scReact?.ready, undefined, { timeout: 15_000 });

    // The `layers` prop's rule has to reach the kernel's layer canvas.
    await expect
      .poll(() => page.evaluate(() => window.__scReact?.layerInk?.() ?? -1), { timeout: 5_000 })
      .toBeGreaterThan(0);

    // A real click on a bar must arrive at the React prop with its meta.
    // Inside the Q1 group: y stays clear of the x-axis gutter at the bottom.
    const box = await page.locator('#bar-host').boundingBox();
    if (!box) throw new Error('no bar host box');
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.8);

    await expect.poll(() => page.evaluate(() => window.__scReact?.clicks ?? [])).toEqual(['Q1']);
    expect(errors).toEqual([]);
  });

  test('delivers the wind rose highlight emitted during its first layout', async ({
    page,
    pkg,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(pkg === 'dist' ? '/react-packaged.html' : '/react.html');
    await page.waitForFunction(() => (window.__scReact?.highlights ?? 0) > 0, undefined, {
      timeout: 15_000,
    });

    expect(errors).toEqual([]);
  });
});
