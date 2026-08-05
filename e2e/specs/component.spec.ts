import { expect, test } from '@playwright/test';
import { mountScenario, runStep } from '../fixtures/harness.js';
import { SCENARIO_LIST } from '../scenarios/index.js';

// One generic runner over every registered scenario: a new chart or case is a
// scenario file, not new spec code.
for (const scenario of SCENARIO_LIST) {
  test.describe(scenario.id, () => {
    test('mounts and renders grains', async ({ page }) => {
      const m = await mountScenario(page, scenario);

      expect(await m.backend()).toBe('canvas2d');
      expect(await m.ink(), 'settled chart painted nothing').toBeGreaterThan(0.02);
      expect(m.errors).toEqual([]);
    });

    test('runs its scripted steps', async ({ page }) => {
      const m = await mountScenario(page, scenario);
      for (const step of scenario.steps) await runStep(m, step);
      expect(m.errors).toEqual([]);
    });

    test('is deterministic across mounts', async ({ page }) => {
      const a = await mountScenario(page, scenario);
      const inkA = await a.ink();
      await page.reload();
      await page.waitForFunction(() => !!window.__sc);
      await page.evaluate((ms) => window.__clock.advance(ms), scenario.settleMs);
      const inkB = await a.ink();

      // Same seed, same frame count → the same picture, pixel for pixel.
      expect(inkB).toBeCloseTo(inkA, 5);
    });
  });
}
