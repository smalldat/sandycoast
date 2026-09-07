/**
 * Compass bearings ↔ human labels.
 *
 * Its own module because three unrelated consumers need it — the segment
 * metadata, the compass axis and the time table's direction column — and none
 * of them should have to import another's file to get it.
 */

/** The 16-point compass, starting at north and running clockwise. */
export const COMPASS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/**
 * Nearest 16-point compass label for a bearing in degrees clockwise from north.
 *
 * Always the 16-point rose regardless of how many sectors the chart bins into:
 * a table row wants a name a reader knows, and the 4- and 8-point names are
 * subsets of these, so an 8-sector rose still labels exactly N/NE/E/…
 */
export function bearingLabel(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.round(norm / 22.5) % 16;
  return COMPASS_16[idx]!;
}

/** Degrees clockwise from north, normalized to `[0, 360)`. */
export function degreesFromRadians(rad: number): number {
  const deg = (rad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}
