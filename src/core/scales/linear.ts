import type { Scale } from './types.js';

/** Round a step to a "nice" 1/2/5 * 10^k value. */
function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

export class LinearScale implements Scale<number> {
  private min: number;
  private max: number;

  constructor(domain: [number, number]) {
    let [a, b] = domain;
    if (a === b) {
      // Degenerate domain: pad so scale stays finite.
      const pad = a === 0 ? 1 : Math.abs(a) * 0.5;
      a -= pad;
      b += pad;
    }
    this.min = a;
    this.max = b;
  }

  /** Build from raw values, optionally forcing the axis to include zero. */
  static fromValues(values: number[], includeZero = true): LinearScale {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo === Number.POSITIVE_INFINITY) {
      lo = 0;
      hi = 1;
    }
    if (includeZero) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    return new LinearScale([lo, hi]);
  }

  scale(v: number): number {
    return (v - this.min) / (this.max - this.min);
  }

  domain(): [number, number] {
    return [this.min, this.max];
  }

  ticks(count = 5): number[] {
    const span = this.max - this.min;
    const step = niceStep(span / Math.max(1, count));
    const start = Math.ceil(this.min / step) * step;
    const out: number[] = [];
    for (let v = start; v <= this.max + step * 1e-9; v += step) {
      // Guard float drift.
      out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return out;
  }
}
