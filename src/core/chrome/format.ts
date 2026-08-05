import type { Scalar } from '../data/types.js';

/** One rendered tick: its value, layout position [0,1], and formatted label. */
export interface AxisTick {
  value: Scalar;
  /** Layout position along the axis, [0,1]. */
  pos: number;
  label: string;
}

/** Compact number format: trims trailing zeros, keeps big/small readable. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString('en-US');
  if (abs < 0.001) return v.toExponential(1);
  return String(Math.round(v * 1000) / 1000);
}

/** Default label for any scalar: compact number, locale date, or the string. */
export function formatValue(v: Scalar): string {
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Date) return v.toLocaleDateString('en-US');
  return String(v);
}
