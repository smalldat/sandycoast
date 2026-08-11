import type { BarChartConfig } from '../../src/index.js';
import { STACK_POINTS } from './data.js';
import type { Scenario } from './types.js';

// Two series (s1, s2; see STACK_POINTS), legend shown and interactive so
// legend entry 0 = s1, entry 1 = s2 (seriesKeys order = first appearance).
const config: Omit<BarChartConfig, 'backend'> = {
  data: { points: STACK_POINTS },
  grainDensity: 0.6,
  colors: ['#6ab0e8', '#e8b96a'],
  fps: { position: 'off' },
  legend: { show: true, interactive: true },
};

export const barLegendDim: Scenario = {
  id: 'bar-legend-dim',
  chart: 'bar',
  config: config as Record<string, unknown>,
  settleMs: 2000,
  steps: [
    {
      name: 'click legend entry 0 (s1) — isolates it',
      act: { kind: 'clickLegend', index: 0 },
      expect: { event: { type: 'seriesFocus', payload: { index: 0 } } },
    },
    {
      name: 'click legend entry 0 again — clears the isolation',
      act: { kind: 'clickLegend', index: 0 },
      expect: { event: { type: 'seriesFocus', payload: { index: null } } },
    },
    {
      name: 'click legend entry 1 (s2) — isolates it',
      act: { kind: 'clickLegend', index: 1 },
      expect: { event: { type: 'seriesFocus', payload: { index: 1 } } },
    },
    {
      name: 'click legend entry 0 (s1) — switches focus straight across, no intermediate clear',
      act: { kind: 'clickLegend', index: 0 },
      expect: { event: { type: 'seriesFocus', payload: { index: 0 } } },
    },
  ],
};
