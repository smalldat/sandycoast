import { expect } from '@playwright/test';
import { test } from '../fixtures/harness.js';

/**
 * The chart kernel in a real browser: cancellable events actually stop the
 * built-in reaction, and caller-owned layers actually put pixels on screen.
 * The unit tests cover the dispatch logic; what only a browser can show is
 * that a chart honors a veto and that a layer paints.
 *
 * `src` only — this exercises the shared base class, not the packaging.
 */
test.describe('chart kernel', () => {
  test.skip(({ pkg }) => pkg === 'dist', 'harness page imports src directly');

  test('cancellable events and drawing layers work end to end', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/kernel.html');
    await page.waitForFunction(() => !!window.__scKernel?.ready, undefined, { timeout: 15_000 });

    const checks = await page.evaluate(() => window.__scKernel?.checks ?? {});

    // Layers: both entry points registered.
    expect(checks.layerCount).toBe(2);

    // A cancelled add leaves the dataset alone; the next one applies.
    expect(checks.pointsAfterCancelledAdd).toBe(checks.pointsBefore);
    expect(checks.pointsAfterAllowedAdd).toBe((checks.pointsBefore as number) + 1);

    // The data event describes the pending change and is cancellable.
    expect(checks.addPayload).toMatchObject({ action: 'add', items: 1, cancelable: true });

    // A cancelled zoom leaves the view untouched; the next one applies.
    expect(checks.scaleAfterCancelledZoom).toBe(1);
    expect(checks.scaleAfterAllowedZoom).toBe(2);

    // Same for pan.
    expect(checks.offsetAfterCancelledPan).toBe(true);
    expect(checks.offsetMovedAfterAllowedPan).toBe(true);

    // drawFinished fires per frame with a monotonic counter.
    expect(checks.drawFinishedFired).toBe(true);
    expect(checks.frameCounterAdvances).toBe(true);

    expect(errors).toEqual([]);
  });

  test('layers paint onto their own canvas above the chart', async ({ page }) => {
    await page.goto('/kernel.html');
    await page.waitForFunction(() => !!window.__scKernel?.ready, undefined, { timeout: 15_000 });

    // Both the rule and the filled square land on the layer canvas, so the
    // painted share is well clear of zero but nowhere near the whole surface.
    await expect
      .poll(() => page.evaluate(() => window.__scKernel?.layerInk() ?? -1), { timeout: 5_000 })
      .toBeGreaterThan(0.005);
  });

  test('reports a real click with the mark under the pointer', async ({ page }) => {
    await page.goto('/kernel.html');
    await page.waitForFunction(() => !!window.__scKernel?.ready, undefined, { timeout: 15_000 });

    // The scripted sequence leaves the view zoomed and panned; undo it so the
    // bars sit at their plain layout positions.
    await page.evaluate(() => window.__scKernel?.resetView());

    const box = await page.locator('#host').boundingBox();
    if (!box) throw new Error('harness host has no layout box');
    // Near the base of the third bar — the coordinates bar-basic hovers.
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.95);

    const clicks = await page.evaluate(() => window.__scKernel?.clicks ?? []);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.button).toBe(0);
    expect(clicks[0]?.meta).not.toBeNull();
  });
});
