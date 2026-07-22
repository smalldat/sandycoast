import type { RGBA } from '../render/types.js';

/** Parse a CSS hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or rgb()/rgba() to RGBA 0..1. */
export function parseColor(css: string): RGBA {
  const s = css.trim();
  if (s.startsWith('#')) return parseHex(s);
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1]!.split(',').map((p) => p.trim());
    const r = num(parts[0]) / 255;
    const g = num(parts[1]) / 255;
    const b = num(parts[2]) / 255;
    const a = parts[3] !== undefined ? num(parts[3]) : 1;
    return [r, g, b, a];
  }
  return [0, 0, 0, 1];
}

/** RGBA (0..1) back to a CSS `rgba()` string, with an optional alpha multiplier. */
export function cssRGBA(c: RGBA, alphaMul = 1): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  const a = Math.max(0, Math.min(1, c[3] * alphaMul));
  return `rgba(${r},${g},${b},${a})`;
}

function num(s: string | undefined): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseHex(s: string): RGBA {
  let h = s.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = Number.parseInt(h.slice(0, 2), 16) / 255;
  const g = Number.parseInt(h.slice(2, 4), 16) / 255;
  const b = Number.parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

export const DEFAULT_PALETTE = ['#e8598b', '#8bc4e8', '#e8c45a', '#5ae89a', '#b98be8', '#e8895a'];
