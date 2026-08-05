import { describe, expect, it } from 'vitest';
import { resolveFps } from '../../core/chrome/fps.js';
import type { BarChartConfig } from './types.js';

const base: BarChartConfig = { data: { points: [] } };

describe('resolveFps', () => {
  it('is off by default', () => {
    const r = resolveFps(base);
    expect(r.show).toBe(false);
  });

  it('is off when position is "off"', () => {
    const r = resolveFps({ ...base, fps: { position: 'off' } });
    expect(r.show).toBe(false);
  });

  it('shows and keeps the requested position', () => {
    for (const position of ['left', 'right', 'top', 'bottom'] as const) {
      const r = resolveFps({ ...base, fps: { position } });
      expect(r.show).toBe(true);
      expect(r.position).toBe(position);
    }
  });

  it('applies a custom color', () => {
    const r = resolveFps({ ...base, fps: { position: 'top', color: '#f00' } });
    expect(r.color).toBe('#f00');
  });
});
