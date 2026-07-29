import type { GrainBuffer } from './grains.js';
import { mulberry32 } from './rng.js';

export type Easing = 'linear' | 'easeOutCubic' | 'easeOutQuint';

export function ease(t: number, kind: Easing): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (kind) {
    case 'linear':
      return x;
    case 'easeOutQuint':
      return 1 - (1 - x) ** 5;
    default:
      return 1 - (1 - x) ** 3;
  }
}

export interface ScatterOptions {
  /** Total animation duration per grain, seconds. */
  duration: number;
  /** Max stagger added to delay, seconds (pour effect). */
  stagger: number;
  /** RNG seed. */
  seed?: number;
}

/**
 * Fill start positions by scattering grains above the chart (y > 1) with a
 * random x, and assign staggered delays so higher grains arrive later — a
 * pour-from-above look. Targets/seed must already be populated.
 */
export function scatterStarts(g: GrainBuffer, opts: ScatterOptions): void {
  const rng = mulberry32(opts.seed ?? 7);
  for (let i = 0; i < g.count; i++) {
    g.startX[i] = rng();
    g.startY[i] = 1 + rng() * 0.6; // above the top edge
    // Grains destined higher in the bar pour later.
    g.delay[i] = opts.stagger * (g.targetY[i]! * 0.6 + rng() * 0.4);
  }
}

/**
 * CPU position eval for the Canvas2D fallback. Writes live x/y for grain `i`
 * into `out`. GPU backends do this in the vertex shader instead.
 */
export function evalGrain(
  g: GrainBuffer,
  i: number,
  now: number,
  duration: number,
  easing: Easing,
  jitterAmp: number,
  out: { x: number; y: number },
  viewX = 1,
  viewY = 1,
): void {
  const t = (now - g.delay[i]!) / duration;
  const te = ease(t, easing);
  const settle = 1 - te;
  const s = g.seed[i]!;
  // Cheap wobble that fades as the grain settles.
  const nx = Math.sin((now + s * 6.283) * 3.0 + s * 100) * jitterAmp * settle;
  const ny = Math.cos((now + s * 6.283) * 3.3 + s * 55) * jitterAmp * settle;
  // Shrink the baked scatter offset by the view scale so on-screen spread stays
  // constant under zoom (mirrors the GPU shader; no-op at identity zoom).
  const tx = g.targetX[i]! - g.offX[i]! * (1 - 1 / viewX);
  const ty = g.targetY[i]! - g.offY[i]! * (1 - 1 / viewY);
  out.x = g.startX[i]! + (tx - g.startX[i]!) * te + nx;
  out.y = g.startY[i]! + (ty - g.startY[i]!) * te + ny;
}
