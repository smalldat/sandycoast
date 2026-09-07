import type { NormalizedWind, WindObservation } from '../../core/data/wind.js';
import { CENTER, MAX_RADIUS, angleInWedge, clamp, layoutToAngle } from '../../core/layout/polar.js';
import type { Wedge } from '../../core/particles/pack.js';
import type { RGBA } from '../../core/render/types.js';
import { colorRamp } from '../../core/util/color.js';
import {
  type BandConfig,
  type Bin,
  type PetalMode,
  type RadialMeasure,
  type SectorAlign,
  type SegmentOrder,
  bandOf,
  bandRanges,
  binDirections,
  segmentKeyByObservation,
} from './binning.js';
import { bearingLabel, degreesFromRadians } from './compass.js';
import type { SegmentMeta } from './types.js';

const TAU = Math.PI * 2;

/** Share of the radial span the calm circle may take, however calm the data. */
const MAX_CALM_SPAN = 0.5;

export interface WindRoseLayoutOptions {
  // Binning
  sectors: number;
  sectorAlign: SectorAlign;
  mode: PetalMode;
  measure: RadialMeasure;
  order: SegmentOrder;
  maxSegmentsPerSector: number;
  calmBelow: number;
  calmShow: boolean;
  bands: BandConfig;
  // Geometry
  /** Outer radius as a fraction of {@link MAX_RADIUS}, 0..1. */
  radius: number;
  /** Minimum hole as a fraction of the outer radius, 0..0.95. */
  innerRadius: number;
  /** Rotation of due north, radians clockwise. */
  north: number;
  clockwise: boolean;
  /** Petal sweep as a fraction of its sector, 0..1. */
  petalWidth: number;
  /** Gap trimmed from each petal's sweep, radians. */
  padAngle: number;
  /** Explicit radial axis maximum, in the measure's units. */
  radialMax?: number | undefined;
  /** Steps the intensity ramp is quantized to for grain coloring. */
  rampSteps: number;
  /** Calm circle color; defaults to the first palette entry. */
  calmColor?: RGBA | undefined;
}

export interface WindRoseLayout {
  wedges: Wedge[];
  /** Petal segments, plus the calm circle last when there is one. */
  metas: SegmentMeta[];
  calm: SegmentMeta | null;
  bins: Bin[];
  edges: number[];
  /**
   * Palette the **grains** index into. Band colors in `'bands'` mode; the
   * quantized intensity ramp in `'observations'` mode, with the calm color
   * appended. Kept small on purpose — the canvas2d renderer batches grains once
   * per palette entry, so one entry per segment would cost a full pass over
   * every grain for every segment.
   */
  grainPalette: RGBA[];
  /** Axis maximum in the measure's units (already percent-scaled). */
  radialMax: number;
  /** Every reading's weight summed, calm included, in the measure's units. */
  grandTotal: number;
  /** Radius petals grow from — the calm circle's edge, or the configured hole. */
  rInner: number;
  rOuter: number;
  observations: WindObservation[];
  segmentKeyByObservation: Map<number, string>;
  /** Intensity range the color ramp spans. */
  intensityDomain: [number, number];
  /** Label/unit for the intensity indicator, carried from the dataset. */
  intensityLabel: string;
  intensityUnit: string;
}

/**
 * Turn normalized observations into annular petal segments (layout space,
 * angles clockwise from 12 o'clock) plus per-segment metadata for hover,
 * selection and the table.
 *
 * The wedges are the **same primitive the pie packs**, so `wedgeGrainCounts` /
 * `packWedges` are reused unchanged — a wind rose needs no packing code of its
 * own.
 */
export function layoutWindRose(
  norm: NormalizedWind,
  palette: RGBA[],
  opts: WindRoseLayoutOptions,
): WindRoseLayout {
  const points = norm.points;
  const result = binDirections(points, {
    sectors: opts.sectors,
    sectorAlign: opts.sectorAlign,
    mode: opts.mode,
    measure: opts.measure,
    order: opts.order,
    maxSegmentsPerSector: opts.maxSegmentsPerSector,
    calmBelow: opts.calmBelow,
    bands: opts.bands,
  });

  // 'percent' is the same geometry as 'count' read against the whole, so it is
  // a unit conversion here rather than a second path through the binning.
  const unit = opts.measure === 'percent' && result.grandTotal > 0 ? 100 / result.grandTotal : 1;

  const grandTotal = result.grandTotal * unit;
  const autoMax = result.maxTotal * unit;
  const radialMax = opts.radialMax != null && opts.radialMax > 0 ? opts.radialMax : autoMax || 1;

  const rOuter = MAX_RADIUS * clamp(opts.radius, 0, 1);
  const hole = rOuter * clamp(opts.innerRadius, 0, 0.95);

  // The calm circle sits on the same radial scale as the petals, so its size is
  // readable against the rings — but it is capped, because an overwhelmingly
  // calm dataset would otherwise swallow the rose it is supposed to sit inside.
  const calmWeight = result.calm.weight * unit;
  const hasCalm = opts.calmShow && result.calm.members.length > 0 && calmWeight > 0;
  const calmSpan = hasCalm ? clamp(calmWeight / radialMax, 0, MAX_CALM_SPAN) : 0;
  const rInner = hole + calmSpan * (rOuter - hole);
  const span = Math.max(0, rOuter - rInner);

  const intensityDomain = intensityRange(points);
  const grainPalette = opts.mode === 'bands' ? [...palette] : quantizeRamp(palette, opts.rampSteps);
  // The calm disc's color lives at the end of the grain palette so petal color
  // indices keep meaning what they mean in each mode. It defaults to the first
  // palette entry, which in bands mode is also band 0's color — hence the
  // `calm.color` knob, so the calm disc can be told apart from the weakest band.
  const calmColor = opts.calmColor ?? palette[0] ?? [1, 1, 1, 1];
  const calmColorIdx = grainPalette.length;
  grainPalette.push(calmColor);

  const ranges = bandRanges(result.edges);
  const sectorSweep = TAU / Math.max(2, Math.floor(opts.sectors));
  const sweep = Math.max(0, sectorSweep * clamp(opts.petalWidth, 0, 1) - opts.padAngle);

  const wedges: Wedge[] = [];
  const metas: SegmentMeta[] = [];

  for (const bin of result.bins) {
    if (bin.segments.length === 0) continue;

    const petalValue = bin.total * unit;
    const petalOuter = rInner + clamp(petalValue / radialMax, 0, 1) * span;
    // Segments subdivide the petal in proportion to their weight. For the
    // stacking measures that is exactly a running sum; for 'intensityMax' the
    // petal's length is the strongest reading and the segments share it out, so
    // a segment's own length carries no independent meaning there.
    let weightSum = 0;
    for (const seg of bin.segments) weightSum += seg.weight * unit;

    // Bearings are data; the drawn angle applies the caller's compass framing.
    const center = opts.north + (opts.clockwise ? bin.center : -bin.center);
    const a0 = center - sweep / 2;
    const a1 = center + sweep / 2;

    let r = rInner;
    for (const seg of bin.segments) {
      const value = seg.weight * unit;
      const frac = weightSum > 0 ? value / weightSum : 1 / bin.segments.length;
      const segOuter = r + frac * (petalOuter - rInner);
      const band = seg.band >= 0 ? seg.band : bandOf(result.edges, seg.intensityMax);
      const range = ranges[band] ?? { lo: 0, hi: Number.POSITIVE_INFINITY };
      const colorIdx =
        opts.mode === 'bands'
          ? band % Math.max(1, palette.length)
          : rampIndex(seg.intensityMax, intensityDomain, opts.rampSteps);
      const color =
        opts.mode === 'bands'
          ? (palette[band % Math.max(1, palette.length)] ?? [1, 1, 1, 1])
          : colorRamp(palette, normalizeInto(seg.intensityMax, intensityDomain));

      const segmentId = metas.length;
      wedges.push({
        cx: CENTER,
        cy: CENTER,
        a0,
        a1,
        rInner: r,
        rOuter: segOuter,
        colorIdx,
        barId: segmentId,
      });
      metas.push({
        segmentId,
        key: seg.key,
        sector: bin.sector,
        bearingDeg: degreesFromRadians(bin.center),
        bearing: bearingLabel(degreesFromRadians(bin.center)),
        band: seg.band,
        bandLo: range.lo,
        bandHi: range.hi,
        aggregated: seg.aggregated,
        calm: false,
        observationIds: seg.members.map((m) => points[m]!.id),
        count: seg.members.length,
        value,
        petalValue,
        intensityMin: seg.intensityMin,
        intensityMax: seg.intensityMax,
        latestT: seg.latestT,
        a0,
        a1,
        rInner: r,
        rOuter: segOuter,
        color,
      });
      r = segOuter;
    }
  }

  let calm: SegmentMeta | null = null;
  if (hasCalm && rInner > 0) {
    const segmentId = metas.length;
    const members = result.calm.members;
    wedges.push({
      cx: CENTER,
      cy: CENTER,
      a0: 0,
      a1: TAU,
      rInner: 0,
      rOuter: rInner,
      colorIdx: calmColorIdx,
      barId: segmentId,
    });
    calm = {
      segmentId,
      key: 'calm',
      sector: -1,
      bearingDeg: Number.NaN,
      bearing: 'Calm',
      band: -1,
      bandLo: 0,
      bandHi: opts.calmBelow,
      aggregated: members.length > 1,
      calm: true,
      observationIds: members.map((m) => points[m]!.id),
      count: members.length,
      value: calmWeight,
      petalValue: calmWeight,
      intensityMin: minOf(members.map((m) => points[m]!.intensity)),
      intensityMax: maxOf(members.map((m) => points[m]!.intensity)),
      latestT: maxOf(members.map((m) => points[m]!.t)),
      a0: 0,
      a1: TAU,
      rInner: 0,
      rOuter: rInner,
      color: calmColor,
    };
    metas.push(calm);
  }

  // Observation → segment, including the calm members, so a table row click
  // always finds a mark even when the reading has no direction.
  const byObservation = new Map<number, string>();
  for (const [memberIdx, key] of segmentKeyByObservation(result.bins)) {
    byObservation.set(points[memberIdx]!.id, key);
  }
  if (calm) {
    for (const m of result.calm.members) byObservation.set(points[m]!.id, 'calm');
  }

  return {
    wedges,
    metas,
    calm,
    bins: result.bins,
    edges: result.edges,
    grainPalette,
    radialMax,
    grandTotal,
    rInner,
    rOuter,
    observations: points,
    segmentKeyByObservation: byObservation,
    intensityDomain,
    intensityLabel: norm.intensityLabel,
    intensityUnit: norm.intensityUnit,
  };
}

/**
 * Segment under a point in layout space, or null. `lx`/`ly` are layout coords
 * (y-up) inside the same square box the wedges were built in.
 *
 * The calm circle is tested last: it spans every angle, so testing it first
 * would swallow the root of every petal.
 */
export function hitSegment(metas: SegmentMeta[], lx: number, ly: number): SegmentMeta | null {
  const dx = lx - CENTER;
  const dy = ly - CENTER;
  const r = Math.hypot(dx, dy);
  const a = layoutToAngle(dx, dy);
  let calm: SegmentMeta | null = null;
  for (const m of metas) {
    if (m.calm) {
      calm = m;
      continue;
    }
    if (r < m.rInner || r > m.rOuter) continue;
    if (angleInWedge(a, m.a0, m.a1)) return m;
  }
  if (calm && r <= calm.rOuter) return calm;
  return null;
}

/** Intensity range across every reading, widened when the data has no spread. */
function intensityRange(points: WindObservation[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.intensity < lo) lo = p.intensity;
    if (p.intensity > hi) hi = p.intensity;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (!(hi > lo)) return [lo, lo + 1];
  return [lo, hi];
}

function normalizeInto(v: number, [lo, hi]: [number, number]): number {
  return hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0;
}

/** Quantized ramp bucket for an intensity — the grain palette index. */
function rampIndex(v: number, domain: [number, number], steps: number): number {
  const n = Math.max(2, Math.floor(steps));
  return Math.min(n - 1, Math.floor(normalizeInto(v, domain) * n));
}

/** The ramp sampled at `steps` even points, each bucket's midpoint color. */
function quantizeRamp(stops: RGBA[], steps: number): RGBA[] {
  const n = Math.max(2, Math.floor(steps));
  const out: RGBA[] = [];
  for (let i = 0; i < n; i++) out.push(colorRamp(stops, (i + 0.5) / n));
  return out;
}

function minOf(values: number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function maxOf(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}
