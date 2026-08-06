// Fixed datasets for scenarios. Never randomize here: an E2E failure has to be
// reproducible from the scenario id alone.

import type { Point } from '../../src/index.js';

/** Five categorical slots, one series. Slot centers land at x = 0.1, 0.3, … */
export const FIVE_BARS: Point[] = [
  { x: 'A', y: 40 },
  { x: 'B', y: 75 },
  { x: 'C', y: 55 },
  { x: 'D', y: 90 },
  { x: 'E', y: 20 },
];

/**
 * Two x-slots, two stacked series — for asserting that a stacked line chart's
 * hover payload carries each series' own value, not the cumulative band total.
 */
export const STACK_POINTS: Point[] = [
  { x: 'A', y: 40, z: 's1' },
  { x: 'A', y: 60, z: 's2' },
  { x: 'B', y: 30, z: 's1' },
  { x: 'B', y: 90, z: 's2' },
];
