// Fixed datasets for scenarios. Never randomize here: an E2E failure has to be
// reproducible from the scenario id alone.

import type { Point, WindPoint } from '../../src/index.js';

/** Five categorical slots, one series. Slot centers land at x = 0.1, 0.3, … */
export const FIVE_BARS: Point[] = [
  { x: 'A', y: 40 },
  { x: 'B', y: 75 },
  { x: 'C', y: 55 },
  { x: 'D', y: 90 },
  { x: 'E', y: 20 },
];

/** Same shape as {@link FIVE_BARS} — one series, five x-slots — for the line chart. */
export const FIVE_POINTS: Point[] = FIVE_BARS;

/** One series, five slices; same values as {@link FIVE_BARS} so the fractions are shared. */
export const FIVE_SLICES: Point[] = FIVE_BARS;

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

/**
 * Five wind readings across three of four sectors, oldest → newest.
 *
 * With `sectors: 4` (centered) and a single band threshold at 5, the bins are:
 *   N (−45°..45°): ids 0 (band 0) + 1 (band 1) → 2 readings
 *   E (45°..135°): id 2 (band 0)              → 1 reading
 *   S (135°..225°): ids 3, 4 (both band 1)    → 2 readings
 *   W: empty — a sector to hover and get nothing back.
 * The newest reading (id 4) is in S, which is what the latest-value highlight
 * and the first table row both resolve to.
 */
export const WIND_READINGS: WindPoint[] = [
  { t: 1000, direction: 0, intensity: 2 },
  { t: 2000, direction: 5, intensity: 8 },
  { t: 3000, direction: 90, intensity: 3 },
  { t: 4000, direction: 180, intensity: 9 },
  { t: 5000, direction: 182, intensity: 9.5 },
];
