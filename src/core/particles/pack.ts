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
   * Grain budget multiplier. The chart's total grain count is
   * `density * GRAINS_AT_UNIT_DENSITY`, clamped to `maxGrains` — it does *not*
   * depend on how many bars/points the data has. Geometry (bar area, segment
   * length) only decides how that fixed budget is shared out.
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

/**
 * Total grains a chart draws at `grainDensity === 1`. The grain budget is a
 * function of density alone, so a series sampled by 10 points and the same
 * series sampled by 10,000 points get the same amount of sand.
 */
export const GRAINS_AT_UNIT_DENSITY = 20_000;

/** Grain budget for a whole chart: density-driven, clamped by the ceiling. */
export function grainBudget(opts: PackOptions): number {
  const density = Math.max(0, opts.density);
  const max = Math.max(0, opts.maxGrains ?? DEFAULT_MAX);
  return Math.min(max, Math.round(density * GRAINS_AT_UNIT_DENSITY));
}

/**
 * Split `total` into integer per-slot counts proportional to `weights`, using
 * largest-remainder apportionment: floor every share, then hand the leftover
 * units to the largest fractional remainders.
 *
 * Why not `Math.floor(weight * scale)` per slot: with many slots each share is
 * well below 1, so flooring zeroes nearly all of them and the chart draws a
 * small, lopsided fraction of its budget (grains bunch onto whichever slots
 * happen to round up). Largest-remainder guarantees `sum(result) === total`
 * exactly and spreads the shortfall evenly.
 */
export function distribute(total: number, weights: number[]): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return out;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.max(0, weights[i]!);
  // No geometry to weight by (all-zero widths/lengths) — spread evenly.
  if (sum <= 0) {
    for (let i = 0; i < n; i++) out[i] = Math.floor(total / n) + (i < total % n ? 1 : 0);
    return out;
  }

  const remainders: { i: number; frac: number }[] = [];
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const share = (Math.max(0, weights[i]!) / sum) * total;
    const whole = Math.floor(share);
    out[i] = whole;
    placed += whole;
    remainders.push({ i, frac: share - whole });
  }

  // Hand out what flooring left over, biggest fractional part first. Ties break
  // by index so packing stays deterministic for a given layout.
  remainders.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; placed < total; k++, placed++) out[remainders[k % n]!.i]!++;
  return out;
}

/**
 * Compute how many grains each bar gets. The total is the density-driven
 * {@link grainBudget}; bars share it in proportion to their area, so adding
 * bars subdivides the same sand rather than asking for more.
 */
export function grainCounts(bars: BarRect[], opts: PackOptions): number[] {
  return distribute(
    grainBudget(opts),
    bars.map((b) => Math.max(0, b.width) * Math.max(0, b.height)),
  );
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
 * An annular sector (pie/donut slice) in normalized layout space `[0,1]`,
 * origin bottom-left, +y up. Angles are radians measured **clockwise from the
 * +y axis** (12 o'clock), so a point at angle `a`, radius `r` sits at
 * `(cx + sin(a) * r, cy + cos(a) * r)`.
 *
 * Because the layout box is mapped onto a **square** rect by the pie chart, a
 * constant radius is a true circle on screen regardless of the host's aspect.
 */
export interface Wedge {
  /** Center, layout units (the pie chart uses `0.5, 0.5`). */
  cx: number;
  cy: number;
  /** Start angle, radians clockwise from 12 o'clock. */
  a0: number;
  /** End angle (`>= a0`), radians clockwise from 12 o'clock. */
  a1: number;
  /** Hole radius (0 for a full pie), layout units. */
  rInner: number;
  /** Outer radius, layout units. */
  rOuter: number;
  colorIdx: number;
  /** Slice id for hover hit-testing / highlight (shares the grain `barId` slot). */
  barId: number;
}

/** Area of an annular sector, used to weight its share of the grain budget. */
export function wedgeArea(w: Wedge): number {
  const sweep = Math.max(0, w.a1 - w.a0);
  const rOut = Math.max(0, w.rOuter);
  const rIn = Math.min(Math.max(0, w.rInner), rOut);
  return 0.5 * sweep * (rOut * rOut - rIn * rIn);
}

/**
 * Grains per slice: the density-driven {@link grainBudget} shared out in
 * proportion to sector area, so a donut's hole doesn't get sand and adding
 * slices subdivides the same budget. Mirrors {@link grainCounts} for pies.
 */
export function wedgeGrainCounts(wedges: Wedge[], opts: PackOptions): number[] {
  return distribute(grainBudget(opts), wedges.map(wedgeArea));
}

/**
 * Pack grains into each annular sector on a jittered polar grid and write target
 * positions/attributes into `out` starting at `offset`. Returns grains written.
 *
 * The radial coordinate is sampled as `r = sqrt(rIn² + v (rOut² - rIn²))` rather
 * than linearly in `v`: area grows with `r²`, so a linear ramp would bunch grains
 * against the hole and leave the rim sparse.
 */
export function packWedges(
  wedges: Wedge[],
  counts: number[],
  out: PackTarget,
  opts: PackOptions,
  offset = 0,
): number {
  const jitter = opts.jitter ?? 0.6;
  const rng = mulberry32(opts.seed ?? 1);
  let w = offset;

  for (let wi = 0; wi < wedges.length; wi++) {
    const wedge = wedges[wi]!;
    const n = counts[wi]!;
    const sweep = Math.max(0, wedge.a1 - wedge.a0);
    const rOut = Math.max(0, wedge.rOuter);
    const rIn = Math.min(Math.max(0, wedge.rInner), rOut);
    if (n <= 0 || sweep <= 0 || rOut <= 0) continue;

    // Grid dims follow the sector's on-screen proportions: arc length at the
    // mid radius across, ring thickness down. Keeps cells roughly square.
    const arc = sweep * ((rIn + rOut) / 2);
    const band = rOut - rIn;
    const aspect = band > 0 ? arc / band : n;
    let cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
    const rows = Math.max(1, Math.ceil(n / cols));
    cols = Math.max(1, Math.ceil(n / rows));

    const r2In = rIn * rIn;
    const r2Span = rOut * rOut - r2In;

    let placed = 0;
    for (let r = 0; r < rows && placed < n; r++) {
      for (let c = 0; c < cols && placed < n; c++) {
        const ja = (rng() - 0.5) * jitter;
        const jr = (rng() - 0.5) * jitter;
        const u = clamp01((c + 0.5 + ja) / cols);
        const v = clamp01((r + 0.5 + jr) / rows);
        const a = wedge.a0 + u * sweep;
        const rad = Math.sqrt(r2In + v * r2Span);

        out.targetX[w] = clamp01(wedge.cx + Math.sin(a) * rad);
        out.targetY[w] = clamp01(wedge.cy + Math.cos(a) * rad);
        out.colorIdx[w] = wedge.colorIdx;
        out.barId[w] = wedge.barId;
        out.seed[w] = rng();
        w++;
        placed++;
      }
    }
  }
  return w - offset;
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
 * Grains per segment: the density-driven {@link grainBudget} shared out along
 * the path in proportion to arc length, giving constant linear grain density
 * along the stroke. Mirrors {@link grainCounts} for line paths.
 *
 * Arc length is a *weight*, not a multiplier — resampling the same curve at ten
 * times the point count leaves the total unchanged, it only subdivides the
 * shares more finely. `thickness` likewise doesn't change the count: it spreads
 * the same grains over a wider ribbon.
 */
export function lineGrainCounts(segs: LineSeg[], opts: LinePackOptions): number[] {
  return distribute(
    grainBudget(opts),
    segs.map((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0)),
  );
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
      const tEven = (k + 0.5) / n;
      const t = tEven + (rng() - 0.5) * (jitter / n);
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
