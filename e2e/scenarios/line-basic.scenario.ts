import type { LineChartConfig } from '../../src/index.js';
import { FIVE_POINTS } from './data.js';
import type { Scenario } from './types.js';

// Layout reference (see `layoutLine`): same 5 slots as the bar chart, so slot
// centers are x = 0.1, 0.3, 0.5, 0.7, 0.9. Unlike bars, hover hit-tests a small
// radius (0.05) around each vertex rather than a whole column, so the target
// point must land on the vertex itself:
//   yScale domain is [0, 90] (includeZero, max value 90); vertex height in
//   layout space is (value / 90) * PLOT_HEIGHT (0.92). The harness's hoverFrac
//   is a screen fraction (origin top-left), so y = 1 - height.
//     C: value 55 -> height 0.5622 -> y = 0.4378
//     D: value 90 -> height 0.9200 -> y = 0.0800

const config: Omit<LineChartConfig, 'backend'> = {
  data: { points: FIVE_POINTS },
  grainDensity: 0.6,
  colors: ['#6ab0e8'],
  fps: { position: 'off' },
  interaction: { hover: { effects: ['highlight'] } },
};

export const lineBasic: Scenario = {
  id: 'line-basic',
  chart: 'line',
  config: config as Record<string, unknown>,
  settleMs: 2000,
  steps: [
    {
      name: 'hover the C vertex',
      act: { kind: 'hoverFrac', x: 0.5, y: 0.4378 },
      expect: { event: { type: 'hover', payload: { xValue: 'C', yValue: 55 } } },
    },
    {
      name: 'move into the gap between slots',
      act: { kind: 'hoverFrac', x: 0.2, y: 0.4378 },
      expect: { event: { type: 'hover', payload: null } },
    },
    {
      name: 'move well above every vertex, still nothing hovered',
      act: { kind: 'hoverFrac', x: 0.5, y: 0.02 },
      // Already un-hovered, so the chart must not re-emit.
      expect: { noEvent: 'hover' },
    },
    {
      name: 'hover the D vertex',
      act: { kind: 'hoverFrac', x: 0.7, y: 0.08 },
      expect: { event: { type: 'hover', payload: { xValue: 'D', yValue: 90 } } },
    },
    {
      name: 'leave the chart',
      act: { kind: 'leave' },
      expect: { event: { type: 'hover', payload: null } },
    },
  ],
};
