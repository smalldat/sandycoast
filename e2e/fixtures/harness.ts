import { type Locator, type Page, test as base, expect } from '@playwright/test';
import type { Act, ProbeEvent, Scenario, Step } from '../scenarios/types.js';
import { installFakeClock } from './clock.js';

/** Which build the harness imports the chart classes from. */
export type Pkg = 'src' | 'dist';

/**
 * `pkg` is a project-level option (see the `packaged` project in
 * playwright.config.ts): every test in that project runs against
 * `dist/index.js` instead of `src/index.ts` without each spec asking for it.
 */
export const test = base.extend<{ pkg: Pkg }>({
  pkg: ['src', { option: true }],
});

/** Frames run after every scripted action so hover fades and redraws land. */
const POST_ACT_MS = 100;

export interface Mounted {
  page: Page;
  host: Locator;
  /** Run `ms` of animation on the fake clock. */
  advance(ms: number): Promise<void>;
  events(): Promise<ProbeEvent[]>;
  backend(): Promise<string | null>;
  /** Fraction of painted pixels on the grain canvas; -1 if not readable (GPU). */
  ink(): Promise<number>;
  /**
   * Content hash of the grain canvas; -1 if not readable (GPU). Two equal
   * hashes mean nothing moved — which is how "static at rest" is asserted.
   */
  canvasHash(): Promise<number>;
  /** Uncaught page errors collected since navigation. */
  errors: string[];
  /** Programmatic twin of a legend click (same code path as `clickLegend`). */
  focusSeries(index: number | null): Promise<void>;
  getFocusedSeries(): Promise<number | null>;
}

/**
 * Boot a scenario in the harness page with a frozen clock, then run its
 * `settleMs` so the chart is in its steady state before the first assertion.
 */
export async function mountScenario(
  page: Page,
  scenario: Scenario,
  backend = 'canvas2d',
  pkg: Pkg = 'src',
): Promise<Mounted> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(installFakeClock);
  // `packaged` gets its own entry (main.dist.ts, statically imported — see
  // harness/charts.dist.ts) rather than a query-param branch in the same
  // entry: a dynamic `import()` of the chart factories was unreliable under
  // Vite's dev server, where a static import is not.
  const path = pkg === 'dist' ? '/packaged.html' : '/';
  await page.goto(`${path}?scenario=${encodeURIComponent(scenario.id)}&backend=${backend}`);
  // The probe is published only after `whenReady()` resolves, so its presence
  // is the boot signal.
  await page.waitForFunction(() => !!window.__sc, undefined, { timeout: 15_000 });

  const mounted: Mounted = {
    page,
    host: page.locator('#host'),
    advance: (ms) => page.evaluate((n) => window.__clock.advance(n), ms),
    events: () => page.evaluate(() => window.__sc?.events ?? []),
    backend: () => page.evaluate(() => window.__sc?.backend ?? null),
    ink: () => page.evaluate(inkFraction),
    canvasHash: () => page.evaluate(canvasContentHash),
    errors,
    focusSeries: (index) => page.evaluate((i) => window.__sc?.focusSeries(i), index),
    getFocusedSeries: () => page.evaluate(() => window.__sc?.getFocusedSeries() ?? null),
  };

  await mounted.advance(scenario.settleMs);
  return mounted;
}

/** Run one scripted step and check its expectations. */
export async function runStep(m: Mounted, step: Step): Promise<void> {
  const before = (await m.events()).length;
  await perform(m, step.act);
  await m.advance(POST_ACT_MS);

  const exp = step.expect;
  if (!exp) return;
  const since = (await m.events()).slice(before);

  if (exp.event) {
    const last = [...since].reverse().find((e) => e.type === exp.event?.type);
    expect(last, `step "${step.name}": no ${exp.event.type} event fired`).toBeDefined();
    if (exp.event.payload === null) {
      expect(last?.payload, `step "${step.name}": expected a null payload`).toBeNull();
    } else {
      expect(last?.payload, `step "${step.name}"`).toMatchObject(exp.event.payload);
    }
  }
  if (exp.noEvent) {
    const fired = since.filter((e) => e.type === exp.noEvent);
    expect(fired, `step "${step.name}": unexpected ${exp.noEvent} event(s)`).toHaveLength(0);
  }
  if (exp.minInk !== undefined) {
    expect(await m.ink(), `step "${step.name}": too few painted pixels`).toBeGreaterThan(
      exp.minInk,
    );
  }
}

async function perform(m: Mounted, act: Act): Promise<void> {
  const box = await m.host.boundingBox();
  if (!box) throw new Error('harness host has no layout box');

  switch (act.kind) {
    case 'hoverFrac':
      await m.page.mouse.move(box.x + box.width * act.x, box.y + box.height * act.y);
      return;
    case 'leave':
      // Well outside the host, so the browser fires a real `pointerleave`.
      await m.page.mouse.move(box.x + box.width + 80, box.y + box.height + 80);
      return;
    case 'advance':
      await m.advance(act.ms);
      return;
    case 'clickLegend':
      // The legend is a real DOM layer (see core/chrome/legend.ts), so a plain
      // click drives the exact same listener a user click would. Table rows are
      // also role=button, so they are excluded rather than counted here.
      await m.host.locator('[role="button"]:not([data-row-id])').nth(act.index).click();
      return;
    case 'clickFrac':
      await m.page.mouse.click(box.x + box.width * act.x, box.y + box.height * act.y);
      return;
    case 'clickTableRow':
      // The time table is a real DOM layer too (core/chrome/table.ts); rows
      // carry data-row-id, which is what tells them from legend entries.
      await m.host.locator('[data-row-id]').nth(act.index).click();
      return;
  }
}

/**
 * Runs in the page: FNV-1a over every channel byte of the grain canvas.
 *
 * Hashes all four channels rather than gating on alpha, so it notices a grain
 * that merely *moved* or changed brightness — an alpha-gated count would call
 * two different pictures identical as long as the same number of pixels were
 * lit.
 */
function canvasContentHash(): number {
  const c = document.querySelector<HTMLCanvasElement>('#host canvas');
  if (!c) return -1;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = c.getContext('2d');
  } catch {
    return -1;
  }
  if (!ctx) return -1;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Runs in the page: share of non-transparent pixels on the grain canvas. */
function inkFraction(): number {
  const c = document.querySelector<HTMLCanvasElement>('#host canvas');
  if (!c) return -1;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = c.getContext('2d');
  } catch {
    return -1; // canvas is bound to a GPU context; not readable this way
  }
  if (!ctx) return -1;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) painted++;
  return painted / (c.width * c.height);
}
