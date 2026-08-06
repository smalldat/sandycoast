import type { PieChartConfig } from '../../src/index.js';
import { FIVE_SLICES } from './data.js';
import type { Scenario } from './types.js';

// Layout reference (see `layoutPie`/`hitSlice`): one series, defaults
// (innerRadius 0, radius 0.92, startAngle 0, padAngle 0), values 40/75/55/90/20
// (total 280) sweep clockwise from 12 o'clock:
//   A [0, 0.898)  B [0.898, 2.580)  C [2.580, 3.814)  D [3.814, 5.834)  E [5.834, 2π)
// A point at disc-local radius 0.3, angle = the slice midpoint, converts to
// layout coords via dx = r*sin(a), dy = r*cos(a) (y-up, clockwise from 12).
// The disc is a square centered in the 900x520 host (margins 4/8 css px), so
// disc-local [0,1] maps to screen-fraction x [0.2156, 0.7844], y [0.0077, 0.9923]
// (top-left origin, hence the extra `1 -` on y). Slice midpoints used here:
//   B (mid 1.739 rad) -> x 0.668, y 0.550
//   D (mid 4.824 rad) -> x 0.330, y 0.467

const config: Omit<PieChartConfig, 'backend'> = {
  data: { points: FIVE_SLICES },
  grainDensity: 0.6,
  colors: ['#e8b96a', '#6ab0e8', '#8ac97e', '#d97a7a', '#c79ae8'],
  fps: { position: 'off' },
  interaction: { hover: { effects: ['highlight'] } },
};

export const pieBasic: Scenario = {
  id: 'pie-basic',
  chart: 'pie',
  config: config as Record<string, unknown>,
  settleMs: 2000,
  steps: [
    {
      name: 'hover the B slice',
      act: { kind: 'hoverFrac', x: 0.668, y: 0.55 },
      expect: { event: { type: 'hover', payload: { xValue: 'B', value: 75 } } },
    },
    {
      name: 'move outside the disc entirely',
      act: { kind: 'hoverFrac', x: 0.05, y: 0.05 },
      expect: { event: { type: 'hover', payload: null } },
    },
    {
      name: 'hover the D slice',
      act: { kind: 'hoverFrac', x: 0.33, y: 0.467 },
      expect: { event: { type: 'hover', payload: { xValue: 'D', value: 90 } } },
    },
    {
      name: 'leave the chart',
      act: { kind: 'leave' },
      expect: { event: { type: 'hover', payload: null } },
    },
  ],
};
