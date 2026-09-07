import type { WindRoseChartConfig } from '../../src/index.js';
import { WIND_READINGS } from './data.js';
import type { Scenario } from './types.js';

// The time table's journey: a row click selects that reading's mark, through
// the same `setSelection` a petal click takes.
//
// Rows are newest first, so row 0 is id 4 (S, 9.5 kt) and row 1 is id 3 (S,
// 9 kt) — both in the S petal's band-1 segment, `s2b1`. Row 2 is id 2 (E,
// 3 kt) in `s1b0`, which is what makes "the selection actually moved" visible.
//
// No canvas geometry is asserted here on purpose: mounting the table changes
// the plot rect, and `windrose-basic` already owns the hit-testing contract.
//
// The latest-value highlight is not asserted here either: it fires once at
// mount, before any step's event window opens, so a step could never observe
// it. `roseStyle.test.ts` owns that contract instead.

const config: Omit<WindRoseChartConfig, 'backend'> = {
  data: { points: WIND_READINGS, intensityUnit: 'kt' },
  grainDensity: 0.6,
  colors: ['#8bc4e8', '#e8c45a'],
  sectors: { count: 4, align: 'centered' },
  petals: { mode: 'bands' },
  bands: { thresholds: [5] },
  // See windrose-basic: keep sand visible after the reveal so the ink check
  // has something to measure on the grain canvas.
  segments: { fill: { opacity: 1 }, reveal: { grainsTo: 0.35 } },
  table: { show: true, position: 'right', maxRows: 10 },
  highlight: { show: true, select: 'latest' },
  fps: { position: 'off' },
};

export const windroseTable: Scenario = {
  id: 'windrose-table',
  chart: 'windrose',
  config: config as Record<string, unknown>,
  settleMs: 2000,
  steps: [
    {
      name: 'clicking the third row selects that reading (E petal)',
      act: { kind: 'clickTableRow', index: 2 },
      expect: { event: { type: 'select', payload: { observationId: 2, segmentKey: 's1b0' } } },
    },
    {
      name: 'clicking the newest row moves the selection to the S petal',
      act: { kind: 'clickTableRow', index: 0 },
      expect: { event: { type: 'select', payload: { observationId: 4, segmentKey: 's2b1' } } },
    },
  ],
};
