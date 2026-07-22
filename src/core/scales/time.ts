import type { Scale } from './types.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const STEPS = [
  SECOND,
  5 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  WEEK,
  MONTH,
  3 * MONTH,
  6 * MONTH,
  YEAR,
];

/** Time scale over epoch-millis; ticks snap to human-friendly intervals. */
export class TimeScale implements Scale<Date> {
  private min: number;
  private max: number;

  constructor(domain: [Date, Date]) {
    let a = domain[0].getTime();
    let b = domain[1].getTime();
    if (a === b) {
      a -= DAY / 2;
      b += DAY / 2;
    }
    this.min = a;
    this.max = b;
  }

  static fromValues(values: Date[]): TimeScale {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const d of values) {
      const t = d.getTime();
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (lo === Number.POSITIVE_INFINITY) {
      lo = 0;
      hi = DAY;
    }
    return new TimeScale([new Date(lo), new Date(hi)]);
  }

  scale(v: Date): number {
    return (v.getTime() - this.min) / (this.max - this.min);
  }

  domain(): [Date, Date] {
    return [new Date(this.min), new Date(this.max)];
  }

  ticks(count = 5): Date[] {
    const span = this.max - this.min;
    const target = span / Math.max(1, count);
    let step = STEPS[STEPS.length - 1]!;
    for (const s of STEPS) {
      if (s >= target) {
        step = s;
        break;
      }
    }
    const start = Math.ceil(this.min / step) * step;
    const out: Date[] = [];
    for (let t = start; t <= this.max; t += step) out.push(new Date(t));
    return out;
  }
}
