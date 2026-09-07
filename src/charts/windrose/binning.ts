import type { WindObservation } from '../../core/data/wind.js';

/**
 * Direction binning and petal segmentation — the wind rose's one genuinely new
 * algorithm, kept free of angles-on-screen, rects and canvas so it can be
 * tested as a function of numbers.
 *
 * Both petal modes come out of here as the **same `Segment[]`**, so nothing
 * downstream (layout, packing, hit-testing, overlay, animation) ever branches
 * on which mode produced them.
 */

const TAU = Math.PI * 2;

/** What one stacked segment of a petal represents. */
export type PetalMode =
  /** Segments are intensity bands — the classic meteorological rose (default). */
  | 'bands'
  /** Segments are individual observations, each addressable on its own. */
  | 'observations';

/** What a petal's length measures. */
export type RadialMeasure = 'count' | 'percent' | 'intensitySum' | 'intensityMax';

/** Whether a sector is centered on its compass point or starts there. */
export type SectorAlign = 'centered' | 'edge';

/** Inner→outer ordering of segments within a petal (`'observations'` mode). */
export type SegmentOrder = 'intensity' | 'time';

export interface BandConfig {
  /** Explicit interior thresholds, ascending. Overrides `derive`/`count`. */
  thresholds?: number[] | undefined;
  /** How to derive thresholds when none are given. Default 'equal'. */
  derive?: 'quantile' | 'equal';
  /** How many bands to derive. Default 4. */
  count?: number;
}

export interface BinOptions {
  /** Direction sectors around the compass, >= 2. Default 16. */
  sectors: number;
  sectorAlign: SectorAlign;
  mode: PetalMode;
  measure: RadialMeasure;
  order: SegmentOrder;
  /** Cap on segments per sector before the tail is merged. */
  maxSegmentsPerSector: number;
  /** Observations with intensity strictly below this are "calm" (no direction). */
  calmBelow: number;
  bands: BandConfig;
}

/** One stacked piece of a petal. */
export interface Segment {
  /** Stable identity for morph, hit-testing and table linkage. */
  key: string;
  /** Contribution to the petal's extent, in the radial measure's own units. */
  weight: number;
  /** Indices into the observation array passed to {@link binDirections}. */
  members: number[];
  /** Band index in `'bands'` mode; `-1` in `'observations'` mode. */
  band: number;
  /** True when this is the merged tail of a capped sector. */
  aggregated: boolean;
  intensityMin: number;
  intensityMax: number;
  /** Newest member's time (epoch ms) — how the latest-value highlight lands. */
  latestT: number;
}

export interface Bin {
  /** Sector index, 0 = the sector owning due north. */
  sector: number;
  /** Sector start angle, radians clockwise from north. */
  a0: number;
  /** Sector end angle (`> a0`), radians clockwise from north. */
  a1: number;
  /** Bearing of the sector's center, radians clockwise from north. */
  center: number;
  /** Inner → outer. */
  segments: Segment[];
  /** The petal's extent: summed weights, or the max for `'intensityMax'`. */
  total: number;
}

export interface BinResult {
  /** One bin per sector, always full length — the compass axis labels them all. */
  bins: Bin[];
  /** Observations below the calm threshold; they have no meaningful direction. */
  calm: { members: number[]; weight: number };
  /** Largest bin total — the auto value for the radial axis maximum. */
  maxTotal: number;
  /** Every observation's weight summed, calm included; the `'percent'` divisor. */
  grandTotal: number;
  /** Interior band thresholds actually used; empty in `'observations'` mode. */
  edges: number[];
}

/** Whether segments of this measure stack outward or overlay from the center. */
export function stacks(measure: RadialMeasure): boolean {
  return measure !== 'intensityMax';
}

/** One observation's contribution under `measure`. */
function memberWeight(measure: RadialMeasure, o: WindObservation): number {
  return measure === 'intensitySum' || measure === 'intensityMax' ? o.intensity : 1;
}

/** Combine member contributions the way `measure` combines them. */
function combine(measure: RadialMeasure, values: number[]): number {
  if (values.length === 0) return 0;
  if (measure === 'intensityMax') return Math.max(...values);
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

/**
 * Interior band thresholds, ascending and strictly increasing.
 *
 * Explicit `thresholds` win. Otherwise `count` bands are derived across the
 * intensity range, either by equal width or by quantile. Duplicates are
 * collapsed: heavy ties in the data would otherwise produce bands that can
 * never hold an observation.
 */
export function bandEdges(points: WindObservation[], cfg: BandConfig): number[] {
  if (cfg.thresholds && cfg.thresholds.length > 0) {
    return dedupeAscending([...cfg.thresholds].sort((a, b) => a - b));
  }
  const count = Math.max(1, Math.floor(cfg.count ?? 4));
  if (count < 2 || points.length === 0) return [];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.intensity < min) min = p.intensity;
    if (p.intensity > max) max = p.intensity;
  }
  if (!(max > min)) return [];

  const edges: number[] = [];
  if ((cfg.derive ?? 'equal') === 'quantile') {
    const sorted = points.map((p) => p.intensity).sort((a, b) => a - b);
    for (let i = 1; i < count; i++) {
      const pos = (i / count) * (sorted.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(sorted.length - 1, lo + 1);
      edges.push(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
    }
  } else {
    const step = (max - min) / count;
    for (let i = 1; i < count; i++) edges.push(min + step * i);
  }

  // A derived edge at or below the minimum can only ever produce an empty band
  // (quantiles do this whenever the data ties heavily), and an empty band still
  // claims a legend entry and a color. Explicit thresholds are left alone —
  // there, an empty band is the caller's deliberate scale.
  return dedupeAscending(edges).filter((e) => e > min && e <= max);
}

function dedupeAscending(sorted: number[]): number[] {
  const out: number[] = [];
  for (const v of sorted) {
    if (!Number.isFinite(v)) continue;
    if (out.length === 0 || v > out[out.length - 1]!) out.push(v);
  }
  return out;
}

/**
 * Band index for an intensity: band 0 is `(-∞, edges[0])`, band `k` is
 * `[edges[k-1], edges[k])`, and the last is `[edges[n-1], ∞)`.
 */
export function bandOf(edges: number[], intensity: number): number {
  let band = 0;
  while (band < edges.length && intensity >= edges[band]!) band++;
  return band;
}

/** Inclusive-exclusive value range of each band, for legend labels. */
export function bandRanges(edges: number[]): { lo: number; hi: number }[] {
  const out: { lo: number; hi: number }[] = [];
  for (let i = 0; i <= edges.length; i++) {
    out.push({
      lo: i === 0 ? 0 : edges[i - 1]!,
      hi: i === edges.length ? Number.POSITIVE_INFINITY : edges[i]!,
    });
  }
  return out;
}

/**
 * Sector index owning `direction` (radians clockwise from north).
 *
 * Bins are half-open `[lo, hi)`, so a heading landing exactly on a boundary
 * belongs to exactly one sector and a heading just shy of a full turn wraps
 * into the north bin rather than falling off the end.
 */
export function sectorOf(direction: number, sectors: number, align: SectorAlign): number {
  const sweep = TAU / sectors;
  // 'centered' puts the compass point in the middle of its sector, so the bin
  // starts half a sweep before it — that is what makes N span -11.25°..+11.25°.
  const shifted = align === 'centered' ? direction + sweep / 2 : direction;
  const idx = Math.floor((((shifted % TAU) + TAU) % TAU) / sweep);
  return idx >= sectors ? 0 : idx;
}

/** Angular bounds of a sector, radians clockwise from north. */
export function sectorBounds(
  sector: number,
  sectors: number,
  align: SectorAlign,
): { a0: number; a1: number; center: number } {
  const sweep = TAU / sectors;
  const center = sector * sweep;
  const a0 = align === 'centered' ? center - sweep / 2 : center;
  return { a0, a1: a0 + sweep, center: align === 'centered' ? center : center + sweep / 2 };
}

/**
 * Bin observations by direction and split each petal into stacked segments.
 *
 * Every sector is present in the result even when empty, because the compass
 * axis labels all of them and an absent bin would silently renumber the rest.
 */
export function binDirections(points: WindObservation[], opts: BinOptions): BinResult {
  const sectors = Math.max(2, Math.floor(opts.sectors));
  const cap = Math.max(1, Math.floor(opts.maxSegmentsPerSector));
  const edges = opts.mode === 'bands' ? bandEdges(points, opts.bands) : [];

  const bins: Bin[] = [];
  const buckets: number[][] = [];
  for (let s = 0; s < sectors; s++) {
    const { a0, a1, center } = sectorBounds(s, sectors, opts.sectorAlign);
    bins.push({ sector: s, a0, a1, center, segments: [], total: 0 });
    buckets.push([]);
  }

  const calmMembers: number[] = [];
  let grandTotal = 0;

  for (let i = 0; i < points.length; i++) {
    const o = points[i]!;
    grandTotal += memberWeight(opts.measure, o);
    // A calm reading has no meaningful direction, so it belongs in the middle
    // rather than in whichever sector the vane happened to be pointing at.
    if (o.intensity < opts.calmBelow) {
      calmMembers.push(i);
      continue;
    }
    buckets[sectorOf(o.direction, sectors, opts.sectorAlign)]!.push(i);
  }

  for (let s = 0; s < sectors; s++) {
    const members = buckets[s]!;
    const segments =
      opts.mode === 'bands'
        ? bandSegments(points, members, edges, s, opts)
        : observationSegments(points, members, opts);
    bins[s]!.segments = capSegments(segments, cap, s, opts.measure);
    bins[s]!.total = combine(
      opts.measure,
      bins[s]!.segments.map((seg) => seg.weight),
    );
  }

  let maxTotal = 0;
  for (const b of bins) if (b.total > maxTotal) maxTotal = b.total;

  return {
    bins,
    calm: {
      members: calmMembers,
      weight: combine(
        opts.measure,
        calmMembers.map((i) => memberWeight(opts.measure, points[i]!)),
      ),
    },
    maxTotal,
    grandTotal,
    edges,
  };
}

/** One segment per observation, ordered inner → outer by `opts.order`. */
function observationSegments(
  points: WindObservation[],
  members: number[],
  opts: BinOptions,
): Segment[] {
  const sorted = [...members].sort((a, b) => {
    const pa = points[a]!;
    const pb = points[b]!;
    const primary = opts.order === 'time' ? pa.t - pb.t : pa.intensity - pb.intensity;
    return primary || pa.id - pb.id;
  });
  return sorted.map((i) => {
    const o = points[i]!;
    return {
      key: `o${o.id}`,
      weight: memberWeight(opts.measure, o),
      members: [i],
      band: -1,
      aggregated: false,
      intensityMin: o.intensity,
      intensityMax: o.intensity,
      latestT: o.t,
    };
  });
}

/** One segment per non-empty band, ordered inner → outer by band index. */
function bandSegments(
  points: WindObservation[],
  members: number[],
  edges: number[],
  sector: number,
  opts: BinOptions,
): Segment[] {
  const byBand = new Map<number, number[]>();
  for (const i of members) {
    const band = bandOf(edges, points[i]!.intensity);
    const list = byBand.get(band);
    if (list) list.push(i);
    else byBand.set(band, [i]);
  }
  const out: Segment[] = [];
  for (const band of [...byBand.keys()].sort((a, b) => a - b)) {
    const list = byBand.get(band)!;
    out.push(makeSegment(`s${sector}b${band}`, points, list, band, false, opts.measure));
  }
  return out;
}

/**
 * Enforce the per-sector segment cap by **merging** the outermost tail into one
 * aggregated segment.
 *
 * Deliberately unlike the pie's slice cap, which drops: dropping observations
 * would shorten a frequency petal and misstate how often the wind blew that
 * way. Merging keeps the petal honest and costs only individual addressability
 * for the readings in the tail — which the hover text says outright.
 */
function capSegments(
  segments: Segment[],
  cap: number,
  sector: number,
  measure: RadialMeasure,
): Segment[] {
  if (segments.length <= cap) return segments;
  const kept = segments.slice(0, cap - 1);
  const tail = segments.slice(cap - 1);
  const members: number[] = [];
  for (const s of tail) members.push(...s.members);
  kept.push({
    key: `s${sector}agg`,
    weight: combine(
      measure,
      tail.map((s) => s.weight),
    ),
    members,
    band: -1,
    aggregated: true,
    intensityMin: Math.min(...tail.map((s) => s.intensityMin)),
    intensityMax: Math.max(...tail.map((s) => s.intensityMax)),
    latestT: Math.max(...tail.map((s) => s.latestT)),
  });
  return kept;
}

function makeSegment(
  key: string,
  points: WindObservation[],
  members: number[],
  band: number,
  aggregated: boolean,
  measure: RadialMeasure,
): Segment {
  let intensityMin = Number.POSITIVE_INFINITY;
  let intensityMax = Number.NEGATIVE_INFINITY;
  let latestT = Number.NEGATIVE_INFINITY;
  for (const i of members) {
    const o = points[i]!;
    if (o.intensity < intensityMin) intensityMin = o.intensity;
    if (o.intensity > intensityMax) intensityMax = o.intensity;
    if (o.t > latestT) latestT = o.t;
  }
  return {
    key,
    weight: combine(
      measure,
      members.map((i) => memberWeight(measure, points[i]!)),
    ),
    members,
    band,
    aggregated,
    intensityMin,
    intensityMax,
    latestT,
  };
}

/**
 * Map each observation index to the key of the segment that holds it — how a
 * table row click, and the latest-value highlight, find their mark.
 */
export function segmentKeyByObservation(bins: Bin[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const bin of bins) {
    for (const seg of bin.segments) {
      for (const m of seg.members) out.set(m, seg.key);
    }
  }
  return out;
}
