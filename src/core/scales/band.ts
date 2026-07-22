import type { Scalar } from '../data/types.js';
import type { Scale } from './types.js';

/**
 * Ordinal band scale: maps each category key to a slot start in `[0, 1]`.
 * `scale(key)` returns the slot's left edge; `bandwidth()` its width.
 * `padding` is the fraction of a step left as gap (0..1).
 */
export class BandScale<T extends Scalar> implements Scale<T> {
  private index = new Map<string, number>();
  private domainKeys: T[];
  private step: number;
  private band: number;
  private pad: number;

  constructor(domain: T[], padding = 0.2) {
    this.domainKeys = domain;
    this.pad = Math.min(Math.max(padding, 0), 0.99);
    const n = Math.max(1, domain.length);
    this.step = 1 / n;
    this.band = this.step * (1 - this.pad);
    domain.forEach((k, i) => this.index.set(String(k), i));
  }

  private slot(v: T): number {
    return this.index.get(String(v)) ?? 0;
  }

  scale(v: T): number {
    // Left edge of the band, centered within its step.
    return this.slot(v) * this.step + (this.step - this.band) / 2;
  }

  /** Center of the band (useful for axis labels). */
  center(v: T): number {
    return this.scale(v) + this.band / 2;
  }

  bandwidth(): number {
    return this.band;
  }

  ticks(): T[] {
    return this.domainKeys;
  }
}
