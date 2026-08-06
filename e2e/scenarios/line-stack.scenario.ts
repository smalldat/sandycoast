import type { LineChartConfig } from '../../src/index.js';
import { STACK_POINTS } from './data.js';
import type { Scenario } from './types.js';

// Layout reference (see `layoutLine` with `stack: true`): 2 x-slots, centers at
// x = 0.25 (A), 0.75 (B). The stacked value axis spans [0, maxStackTotal] = [0, 120]
// (slot B: s1 30 + s2 90). Vertex height in layout space is (cumulativeTop / 120) *
// PLOT_HEIGHT (0.92) — s2's vertex sits at the *band top*, not at its own value. The
// hover payload's `yValue` must still be each series' own value, not that cumulative
// top, so slot A's s2 vertex (band top 100) must report 60, not 100.
//   A/s1: top 40  -> height 0.30667 -> y = 0.69333
//   A/s2: top 100 -> height 0.76667 -> y = 0.23333
//   B/s1: top 30  -> height 0.23    -> y = 0.77
//   B/s2: top 120 -> height 0.92    -> y = 0.08

const config: Omit<LineChartConfig, 'backend'> = {
  data: { points: STACK_POINTS },
  grainDensity: 0.6,
  colors: ['#6ab0e8', '#e8b96a'],
  fps: { position: 'off' },
  // Only `stack` matters for this scenario — layoutLine computes the stacked
  // band heights (and each vertex's *own* value) independent of whether the
  // solid overlay (fill/line) is enabled. Skip fill/line here: turning on the
  // solid layer starts the grain-fade reveal, and by `settleMs` the grain
  // canvas the shared "renders grains" test reads would already have faded to
  // transparent (the visible content moves to the separate overlay canvas).
  line: { stack: true },
  interaction: { hover: { effects: ['highlight'] } },
};

export const lineStack: Scenario = {
  id: 'line-stack',
  chart: 'line',
  config: config as Record<string, unknown>,
  settleMs: 2000,
  steps: [
    {
      name: 'hover the A/s1 vertex — bottom of the stack, own value equals its band top',
      act: { kind: 'hoverFrac', x: 0.25, y: 0.69333 },
      expect: { event: { type: 'hover', payload: { xValue: 'A', seriesKey: 's1', yValue: 40 } } },
    },
    {
      name: 'hover the A/s2 vertex — top of the stack, must report its own value (60), not the band total (100)',
      act: { kind: 'hoverFrac', x: 0.25, y: 0.23333 },
      expect: { event: { type: 'hover', payload: { xValue: 'A', seriesKey: 's2', yValue: 60 } } },
    },
    {
      name: 'move between the two bands, nothing within the hit radius',
      act: { kind: 'hoverFrac', x: 0.25, y: 0.46 },
      expect: { event: { type: 'hover', payload: null } },
    },
    {
      name: 'hover the B/s2 vertex — again its own value (90), not the band total (120)',
      act: { kind: 'hoverFrac', x: 0.75, y: 0.08 },
      expect: { event: { type: 'hover', payload: { xValue: 'B', seriesKey: 's2', yValue: 90 } } },
    },
    {
      name: 'leave the chart',
      act: { kind: 'leave' },
      expect: { event: { type: 'hover', payload: null } },
    },
  ],
};
