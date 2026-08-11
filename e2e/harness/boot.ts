import { SCENARIOS } from '../scenarios/index.js';
import type { ChartKind, ProbeEvent } from '../scenarios/types.js';
import type { ChartFactory } from './charts.js';

/**
 * Test probe published on `window.__sc` once the chart has booted. Specs poll
 * for its presence — its existence *is* the ready signal.
 */
export interface HarnessProbe {
  events: ProbeEvent[];
  backend: string | null;
  dispose(): void;
  /** Programmatic twin of a legend click — same code path, per Plan 11. */
  focusSeries(index: number | null): void;
  getFocusedSeries(): number | null;
}

declare global {
  interface Window {
    __sc?: HarnessProbe;
  }
}

/**
 * Read `?scenario=`/`?backend=` from the URL, mount that scenario's chart via
 * the given factories, and publish the probe once it's ready. Shared by
 * main.ts (src) and main.dist.ts (packaged) — the only difference between
 * those two entries is which `CHARTS` they pass in, kept as a static import
 * per entry so Vite serves `dist/index.js` the same reliable way it already
 * serves `src/index.ts`.
 */
export async function boot(CHARTS: Record<ChartKind, ChartFactory>): Promise<void> {
  const q = new URLSearchParams(location.search);
  const id = q.get('scenario');
  const scenario = id ? SCENARIOS[id] : undefined;
  if (!scenario) throw new Error(`Unknown scenario: ${id ?? '(none)'}`);

  const host = document.getElementById('host');
  if (!host) throw new Error('harness host element missing');

  const events: ProbeEvent[] = [];
  const chart = CHARTS[scenario.chart](
    host,
    { ...scenario.config, backend: q.get('backend') ?? 'canvas2d' },
    (e) => events.push(e),
  );

  await chart.whenReady();

  window.__sc = {
    events,
    backend: chart.backend,
    dispose: () => chart.dispose(),
    focusSeries: (index) => chart.focusSeries?.(index),
    getFocusedSeries: () => chart.getFocusedSeries?.() ?? null,
  };
}
