/**
 * Polar layout helpers shared by every disc-shaped visual (pie/donut, wind
 * rose).
 *
 * Angles are **radians clockwise from 12 o'clock** throughout, so a point at
 * `(a, r)` around center `(cx, cy)` sits at `(cx + sin a · r, cy + cos a · r)`
 * in layout space (y-up). Canvas' own arc angles run clockwise from 3 o'clock,
 * so drawing code subtracts a quarter turn — that conversion belongs to the
 * overlay, not here.
 */

const TAU = Math.PI * 2;

/** Center of the disc in layout space; disc charts map their box to a square. */
export const CENTER = 0.5;
/** Half-extent of the layout box — the largest radius that still fits. */
export const MAX_RADIUS = 0.5;

/** A rect in normalized device coords, `[x0, y0, x1, y1]`, y-up. */
export type Rect = [number, number, number, number];

/**
 * The largest **square** centered inside `rect`, given the pixel dimensions the
 * normalized rect is measured against.
 *
 * Squaring the *rect* rather than the geometry is what keeps a disc circular in
 * a non-square plot area. The alternative — baking the pixel aspect into packed
 * grain targets — would force a repack on every resize; this way a resize is a
 * uniform update.
 */
export function squareRect(rect: Rect, deviceW: number, deviceH: number): Rect {
  const W = Math.max(1, deviceW);
  const H = Math.max(1, deviceH);
  const [x0, y0, x1, y1] = rect;
  const side = Math.min((x1 - x0) * W, (y1 - y0) * H);
  const halfW = side / 2 / W;
  const halfH = side / 2 / H;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
}

/** Layout-space position of the polar point `(a, r)` about `(cx, cy)`. */
export function polarToLayout(
  cx: number,
  cy: number,
  a: number,
  r: number,
): { x: number; y: number } {
  return { x: cx + Math.sin(a) * r, y: cy + Math.cos(a) * r };
}

/**
 * Angle of `(dx, dy)` measured clockwise from 12 o'clock, in `[0, 2π)` — the
 * inverse of {@link polarToLayout}'s angle.
 */
export function layoutToAngle(dx: number, dy: number): number {
  const a = Math.atan2(dx, dy);
  return a < 0 ? a + TAU : a;
}

/** Wrap an angle into `[0, 2π)`. */
export function normalizeAngle(a: number): number {
  const m = a % TAU;
  return m < 0 ? m + TAU : m;
}

/**
 * Whether `a` falls inside the sweep `[a0, a1]`.
 *
 * Sweeps may start at any rotation and wrap past a full turn, so the angle is
 * tested in every equivalent revolution rather than only the one `a` happens to
 * be expressed in. A point exactly on a seam belongs to both neighbours; the
 * caller's iteration order decides which one wins, consistently.
 */
export function angleInWedge(a: number, a0: number, a1: number): boolean {
  for (let turn = -1; turn <= 1; turn++) {
    const t = a + turn * TAU;
    if (t >= a0 && t <= a1) return true;
  }
  return false;
}

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
