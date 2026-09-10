import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BarChartConfig, DataSet, WindDataSet, WindRoseChartConfig } from '../../src/index.js';
import type {
  BarChart as BarChartComponent,
  WindRoseChart as WindRoseChartComponent,
} from '../../src/react/index.js';

/**
 * The React harness app, shared by `react-main.ts` (imports `src/react`) and
 * `react-main.dist.ts` (imports the built `dist/react.js`) so both entries
 * exercise exactly the same component tree.
 *
 * Beyond the smoke test (does the entry resolve and mount a working chart?)
 * it pins two lifecycle contracts the bindings are easy to regress on:
 *
 * 1. A `data` change dispatched from a parent's mount effect lands in the
 *    same commit as the binding publishing its instance — it must still be
 *    applied, not swallowed as "the instance was just created with it".
 * 2. Charts that emit during their first layout pass (the wind rose's
 *    initial `highlight`) reach handlers registered by the binding.
 */
export interface HarnessBindings {
  BarChart: typeof BarChartComponent;
  WindRoseChart: typeof WindRoseChartComponent;
}

// Module scope: the bindings recreate the chart when `options` changes
// identity, and morph when `data` does — both must be stable across renders.
const barOptions: Omit<BarChartConfig, 'data'> = {
  backend: 'canvas2d',
  legend: { show: true },
};

const roseOptions: Omit<WindRoseChartConfig, 'data'> = { backend: 'canvas2d' };

const initialBarData: DataSet = {
  points: [
    { x: 'Q1', y: 10, z: 'A' },
    { x: 'Q1', y: 20, z: 'B' },
    { x: 'Q2', y: 15, z: 'A' },
    { x: 'Q2', y: 25, z: 'B' },
  ],
};

// Adds a third series, so "did this data reach the chart?" is observable
// from the outside as a legend entry rather than from pixels.
const effectBarData: DataSet = {
  points: [...initialBarData.points, { x: 'Q1', y: 12, z: 'C' }, { x: 'Q2', y: 18, z: 'C' }],
};

const roseData: WindDataSet = {
  points: Array.from({ length: 48 }, (_, i) => ({
    t: Date.UTC(2024, 0, 1) + i * 3_600_000,
    direction: (i * 37) % 360,
    intensity: 3 + (i % 7),
  })),
};

const paneStyle = { width: '900px', height: '260px' } as const;

function Harness({ BarChart, WindRoseChart }: HarnessBindings) {
  const [barData, setBarData] = useState(initialBarData);

  // Contract 1: batched with the binding's own instance-publishing state
  // update, so the chart must pick this up without a second nudge.
  useEffect(() => {
    setBarData(effectBarData);
  }, []);

  return (
    <>
      <div id="bar-host">
        <BarChart
          data={barData}
          options={barOptions}
          style={paneStyle}
          ref={(instance) => {
            if (!instance) return;
            instance.whenReady().then(() => {
              window.__scReact = {
                ...(window.__scReact ?? { highlights: 0 }),
                ready: true,
                backend: instance.backend,
              };
            });
          }}
        />
      </div>
      <div id="rose-host">
        <WindRoseChart
          data={roseData}
          options={roseOptions}
          style={paneStyle}
          // Contract 2: emitted during the rose's first layout pass, before
          // any interaction — a binding that subscribes a render late misses it.
          onHighlight={() => {
            const probe = window.__scReact ?? { ready: false, backend: null, highlights: 0 };
            window.__scReact = { ...probe, highlights: probe.highlights + 1 };
          }}
        />
      </div>
    </>
  );
}

/** Mounts the harness app into `host` with the given bindings module. */
export function mountReactHarness(host: HTMLElement, bindings: HarnessBindings): void {
  window.__scReact = { ready: false, backend: null, highlights: 0 };
  createRoot(host).render(
    <Harness BarChart={bindings.BarChart} WindRoseChart={bindings.WindRoseChart} />,
  );
}
