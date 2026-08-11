import { expect } from '@playwright/test';
import { mountScenario, test } from '../fixtures/harness.js';
import { SCENARIOS } from '../scenarios/index.js';

// Dedicated spec (not the generic per-scenario runner in component.spec.ts):
// this asserts a cross-cutting contract from Plan 11 — clicking a legend
// entry and calling `focusSeries()` are the same code path — which needs a
// direct API call the scenario Act/Expectation data model doesn't express.
const scenario = SCENARIOS['bar-legend-dim']!;

test.describe('legend click-to-isolate: focusSeries() API parity', () => {
  test('focusSeries() fires the same seriesFocus event a legend click would', async ({
    page,
    pkg,
  }) => {
    const m = await mountScenario(page, scenario, 'canvas2d', pkg);

    expect(await m.getFocusedSeries()).toBeNull();

    await m.focusSeries(1);
    await m.advance(100);
    const events = await m.events();
    const last = [...events].reverse().find((e) => e.type === 'seriesFocus');
    expect(last?.payload).toMatchObject({ index: 1 });
    expect(await m.getFocusedSeries()).toBe(1);

    await m.focusSeries(null);
    await m.advance(100);
    expect(await m.getFocusedSeries()).toBeNull();
    expect(m.errors).toEqual([]);
  });

  test('a legend click and an equivalent focusSeries() call converge on the same state', async ({
    page,
    pkg,
  }) => {
    const clicked = await mountScenario(page, scenario, 'canvas2d', pkg);
    await clicked.host.locator('[role="button"]').nth(1).click();
    await clicked.advance(100);

    const called = await mountScenario(page, scenario, 'canvas2d', pkg);
    await called.focusSeries(1);
    await called.advance(100);

    expect(await clicked.getFocusedSeries()).toBe(await called.getFocusedSeries());
    expect(clicked.errors).toEqual([]);
    expect(called.errors).toEqual([]);
  });
});
