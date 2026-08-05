import { SCENARIOS } from '../scenarios/index.js';
import type { ProbeEvent } from '../scenarios/types.js';
import { CHARTS } from './charts.js';

/**
 * Test probe published on `window.__sc` once the chart has booted. Specs poll
 * for its presence — its existence *is* the ready signal.
 */
export interface HarnessProbe {
  events: ProbeEvent[];
  backend: string | null;
  dispose(): void;
}

declare global {
  interface Window {
    __sc?: HarnessProbe;
  }
}

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
};
