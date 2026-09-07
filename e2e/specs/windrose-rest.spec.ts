import { expect } from '@playwright/test';
import { mountScenario, test } from '../fixtures/harness.js';
import { SCENARIOS } from '../scenarios/index.js';

// Regression: the wind rose's latest-value glow is *permanent*, so it must not
// ride the hover weight channel — that one also drives `hoverJitterAmp`, and
// sharing it left the newest petal's grains shimmering forever after the pour
// had settled. Emphasis brightens; only hover and the pour move sand.
//
// Asserted on pixels rather than on internals because "is it moving?" is not
// something the config or the event stream can answer.
const scenario = SCENARIOS['windrose-basic']!;

test.describe('wind rose: sand is still at rest', () => {
  test('the highlighted petal does not jitter once settled', async ({ page, pkg }) => {
    const m = await mountScenario(page, scenario, 'canvas2d', pkg);

    // Pointer never enters the chart, so nothing is hovered — the only
    // emphasis in play is the latest-value highlight.
    const first = await m.canvasHash();
    expect(first, 'grain canvas unreadable').not.toBe(-1);

    await m.advance(1000);
    expect(await m.canvasHash(), 'sand moved with nothing hovered').toBe(first);

    await m.advance(4000);
    expect(await m.canvasHash(), 'sand moved with nothing hovered').toBe(first);
    expect(m.errors).toEqual([]);
  });

  test('hover still jitters the sand it is over', async ({ page, pkg }) => {
    const m = await mountScenario(page, scenario, 'canvas2d', pkg);
    const box = await m.host.boundingBox();
    if (!box) throw new Error('harness host has no layout box');

    const atRest = await m.canvasHash();

    // The S petal (see windrose-basic's layout reference).
    await m.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.746);
    await m.advance(300);
    const hoverA = await m.canvasHash();
    expect(hoverA, 'hovering changed nothing').not.toBe(atRest);

    // Jitter is a function of `now`, so time alone must keep it moving.
    await m.advance(300);
    expect(await m.canvasHash(), 'hovered sand stopped moving').not.toBe(hoverA);
    expect(m.errors).toEqual([]);
  });
});
