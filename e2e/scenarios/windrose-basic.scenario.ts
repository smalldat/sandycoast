import type { WindRoseChartConfig } from '../../src/index.js';
import { WIND_READINGS } from './data.js';
import type { Scenario } from './types.js';

// Layout reference (see `layoutWindRose`/`hitSegment`): four centered sectors,
// radius 1 (rOuter 0.5), no calm circle, one band threshold at 5, measure
// 'count' — so the radial axis maximum is 2 (the N and S petals).
//
//   N  ids 0,1 → two stacked segments: band 0 over r [0, 0.25), band 1 [0.25, 0.5]
//   E  id 2    → one segment, r [0, 0.25]      (half the count, half the span)
//   S  ids 3,4 → one band-1 segment, r [0, 0.5]
//   W  empty
//
// A point at rose-local radius r and bearing a converts to layout coords via
// dx = r*sin(a), dy = r*cos(a) (y-up, clockwise from north). The rose box is the
// largest square centered in the 900x520 host (margins 4/8 css px), so rose-local
// [0,1] maps to screen-fraction x [0.2156, 0.7844], y [0.0077, 0.9923] — hence
// the extra `1 -` on y, which is measured from the top.
//
//   N band 0 (a=0,   r=0.125) -> x 0.500, y 0.377
//   N band 1 (a=0,   r=0.375) -> x 0.500, y 0.131
//   S band 1 (a=180, r=0.250) -> x 0.500, y 0.746
//   W (empty)(a=270, r=0.250) -> x 0.358, y 0.500

const config: Omit<WindRoseChartConfig, 'backend'> = {
  data: { points: WIND_READINGS, intensityUnit: 'kt' },
  grainDensity: 0.6,
  colors: ['#8bc4e8', '#e8c45a'],
  radius: 1,
  sectors: { count: 4, align: 'centered' },
  petals: { mode: 'bands', width: 0.9 },
  bands: { thresholds: [5] },
  radial: { measure: 'count' },
  // `grainsTo` keeps sand on the grain canvas after the solid layer resolves:
  // the ink check samples that canvas, and a full fade-out would leave it empty
  // even though the chart is drawing correctly on the overlay.
  segments: { fill: { opacity: 1 }, reveal: { grainsTo: 0.35 } },
  fps: { position: 'off' },
  // The library's default hover effects: 'jitter' is what windrose-rest.spec
  // asserts stays confined to hover, so the scenario has to actually arm it.
  interaction: { hover: { effects: ['highlight', 'jitter'] } },
};

export const windroseBasic: Scenario = {
  id: 'windrose-basic',
  chart: 'windrose',
  config: config as Record<string, unknown>,
  settleMs: 2000,
  steps: [
    {
      name: 'hover the inner (weak) band of the N petal',
      act: { kind: 'hoverFrac', x: 0.5, y: 0.377 },
      expect: {
        event: { type: 'hover', payload: { key: 's0b0', bearing: 'N', band: 0, count: 1 } },
      },
    },
    {
      name: 'hover the outer (strong) band of the same petal',
      act: { kind: 'hoverFrac', x: 0.5, y: 0.131 },
      expect: {
        event: { type: 'hover', payload: { key: 's0b1', bearing: 'N', band: 1, count: 1 } },
      },
    },
    {
      name: 'hover the S petal, which holds two readings in one band',
      act: { kind: 'hoverFrac', x: 0.5, y: 0.746 },
      expect: {
        event: { type: 'hover', payload: { key: 's2b1', bearing: 'S', count: 2, value: 2 } },
      },
    },
    {
      name: 'hover the empty W sector',
      act: { kind: 'hoverFrac', x: 0.358, y: 0.5 },
      expect: { event: { type: 'hover', payload: null } },
    },
    {
      name: 'click the S petal to select it',
      act: { kind: 'clickFrac', x: 0.5, y: 0.746 },
      expect: { event: { type: 'select', payload: { segmentKey: 's2b1' } } },
    },
    {
      name: 'click it again to clear the selection',
      act: { kind: 'clickFrac', x: 0.5, y: 0.746 },
      expect: { event: { type: 'select', payload: { segmentKey: null, observationId: null } } },
    },
    {
      name: 'leave the chart',
      act: { kind: 'leave' },
      expect: { event: { type: 'hover', payload: null } },
    },
  ],
};
