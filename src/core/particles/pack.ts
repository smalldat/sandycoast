import { mulberry32 } from './rng.js';

/** A bar in normalized layout space `[0,1]`, origin bottom-left, +y up. */
export interface BarRect {
  /** Left edge, [0,1]. */
  x: number;
  /** Width, [0,1]. */
  width: number;
  /** Height (grows up from y=0), [0,1]. */
  height: number;
  colorIdx: number;
  barId: number;
}

export interface PackOptions {
  /**
   * Grains per unit area of layout space. Total grains for a bar ≈
   * density * (width * height). Clamped by `maxGrains` across all bars.
   */
  density: number;
  /** Global grain ceiling (default 100k). Bars share it proportionally. */
  maxGrains?: number;
  /** Jitter as a fraction of cell size (0 = perfect grid, 1 = full cell). */
  jitter?: number;
  /** RNG seed for reproducible packing. */
  seed?: number;
}

/** Result of packing: per-grain target positions written into `out`. */
export interface PackTarget {
  targetX: Float32Array;
  targetY: Float32Array;
  colorIdx: Uint16Array;
  barId: Uint16Array;
  seed: Float32Array;
}

const DEFAULT_MAX = 100_000;

/** Compute how many grains each bar gets, respecting the global ceiling. */
export function grainCounts(bars: BarRect[], opts: PackOptions): number[] {
  const density = Math.max(0, opts.density);
  const raw = bars.map((b) => Math.max(0, Math.round(density * b.width * b.height * 1e4)));
  const total = raw.reduce((a, b) => a + b, 0);
  const max = opts.maxGrains ?? DEFAULT_MAX;
  if (total <= max || total === 0) return raw;
  const scale = max / total;
  // Scale strictly (floor to 0 when a bar's share rounds out) so the total
  // honors `maxGrains` no matter how many bars there are — grain cost stays
  // bounded by the ceiling, not by the bar count.
  return raw.map((n) => Math.max(0, Math.floor(n * scale)));
}

/**
 * Pack grains into each bar rect on a jittered grid and write target
 * positions/attributes into `out` starting at `offset`. Returns grains written.
 */
export function packBars(
  bars: BarRect[],
  counts: number[],
  out: PackTarget,
  opts: PackOptions,
  offset = 0,
): number {
  const jitter = opts.jitter ?? 0.6;
  const rng = mulberry32(opts.seed ?? 1);
  let w = offset;

  for (let bi = 0; bi < bars.length; bi++) {
    const bar = bars[bi]!;
    const n = counts[bi]!;
    if (n <= 0 || bar.width <= 0 || bar.height <= 0) continue;

    // Choose grid dims to match the bar's aspect ratio.
    const aspect = bar.width / bar.height;
    let cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
    const rows = Math.max(1, Math.ceil(n / cols));
    cols = Math.max(1, Math.ceil(n / rows));

    const cellW = bar.width / cols;
    const cellH = bar.height / rows;

    let placed = 0;
    for (let r = 0; r < rows && placed < n; r++) {
      for (let c = 0; c < cols && placed < n; c++) {
        const jx = (rng() - 0.5) * jitter * cellW;
        const jy = (rng() - 0.5) * jitter * cellH;
        const px = bar.x + (c + 0.5) * cellW + jx;
        const py = (r + 0.5) * cellH + jy; // bottom-anchored (y up from 0)

        out.targetX[w] = clamp01(px);
        out.targetY[w] = Math.max(0, py);
        out.colorIdx[w] = bar.colorIdx;
        out.barId[w] = bar.barId;
        out.seed[w] = rng();
        w++;
        placed++;
      }
    }
  }
  return w - offset;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * A straight segment of a line chart's path in normalized layout space `[0,1]`,
 * origin bottom-left, +y up. Grains are scattered in a thin ribbon along it.
 */
export interface LineSeg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  colorIdx: number;
  /** Meta id of this segment's left endpoint (hover hit-test / highlight). */
  pointId: number;
}

/** Packing options for {@link packLine}. */
export interface LinePackOptions extends PackOptions {
  /** Ribbon thickness (full width) around the path centerline, layout units. */
  thickness: number;
}

/**
 * Grains per segment, proportional to its length × ribbon thickness, respecting
 * the global ceiling. Mirrors {@link grainCounts} for line paths.
 */
export function lineGrainCounts(segs: LineSeg[], opts: LinePackOptions): number[] {
  const density = Math.max(0, opts.density);
  const thickness = Math.max(0, opts.thickness);
  const raw = segs.map((s) => {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    // Grains per segment ∝ its ribbon area (length × thickness). No per-segment
    // floor: total ≈ density × totalPathLength × thickness, which depends on the
    // *shape* of the line, not on how many points sample it. A zero-length
    // segment (lone vertex) still gets a small dab so it renders.
    if (len === 0) return Math.max(1, Math.round(density * thickness * thickness * 1e4));
    return Math.round(density * len * thickness * 1e4);
  });
  const total = raw.reduce((a, b) => a + b, 0);
  const max = opts.maxGrains ?? DEFAULT_MAX;
  if (total <= max || total === 0) return raw;
  const scale = max / total;
  return raw.map((n) => Math.max(0, Math.floor(n * scale)));
}

/**
 * Pack grains into a thin ribbon along each segment and write target
 * positions/attributes into `out` starting at `offset`. Grains are spread evenly
 * along the segment with a jittered perpendicular offset (± half `thickness`),
 * so the settled sand reads as a fuzzy line. Returns grains written.
 */
export function packLine(
  segs: LineSeg[],
  counts: number[],
  out: PackTarget,
  opts: LinePackOptions,
  offset = 0,
): number {
  const jitter = opts.jitter ?? 0.6;
  const thickness = Math.max(0, opts.thickness);
  const rng = mulberry32(opts.seed ?? 1);
  let w = offset;

  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si]!;
    const n = counts[si]!;
    if (n <= 0) continue;

    const dxs = seg.x1 - seg.x0;
    const dys = seg.y1 - seg.y0;
    const len = Math.hypot(dxs, dys) || 1;
    // Unit perpendicular to the segment direction (rotate dir by 90°).
    const nx = -dys / len;
    const ny = dxs / len;

    for (let k = 0; k < n; k++) {
      // Even spacing along the segment plus a small along-axis jitter.
      const t = (k + 0.5) / n + (rng() - 0.5) * (jitter / n);
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      // Perpendicular spread across the ribbon, scaled by jitter: 0 = crisp
      // centerline, 1 = full `thickness` fuzz.
      const perp = (rng() - 0.5) * thickness * jitter;
      const px = seg.x0 + dxs * tc + nx * perp;
      const py = seg.y0 + dys * tc + ny * perp;

      out.targetX[w] = clamp01(px);
      out.targetY[w] = Math.max(0, py);
      out.colorIdx[w] = seg.colorIdx;
      out.barId[w] = seg.pointId;
      out.seed[w] = rng();
      w++;
    }
  }
  return w - offset;
}
