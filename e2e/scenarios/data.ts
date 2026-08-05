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
