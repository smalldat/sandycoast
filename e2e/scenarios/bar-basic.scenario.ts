import type { BarChartConfig } from '../../src/index.js';
import { FIVE_BARS } from './data.js';
import type { Scenario } from './types.js';

// Layout reference (see `layoutBars`): 5 slots, one series, so slot i occupies
// x ∈ [i*0.2 + 0.032, i*0.2 + 0.168] and its center sits at 0.1 + 0.2*i.
// Anything at y-fraction 0.95 (near the base) is inside every bar; the gaps
// between slots hit nothing.

const config: Omit<BarChartConfig, 'backend'> = {
  data: { points: FIVE_BARS },
  grainDensity: 0.6,
  colors: ['#e8b96a'],
  // FPS text repaints every frame — pure screenshot noise, and irrelevant here.
  fps: false,
  interaction: { hover: { effects: ['highlight'] } },
};

export const barBasic: Scenario = {
  id: 'bar-basic',
  chart: 'bar',
  config: config as Record<string, unknown>,
  settleMs: 2000,
  steps: [
    {
      name: 'hover the third bar',
      act: { kind: 'hoverFrac', x: 0.5, y: 0.95 },
      expect: { event: { type: 'hover', payload: { xValue: 'C', yValue: 55, barId: 2 } } },
    },
    {
      name: 'move into the gap between slots',
      act: { kind: 'hoverFrac', x: 0.2, y: 0.95 },
      expect: { event: { type: 'hover', payload: null } },
    },
    {
      name: 'move above the bars, still nothing hovered',
      act: { kind: 'hoverFrac', x: 0.5, y: 0.05 },
      // Already un-hovered, so the chart must not re-emit.
      expect: { noEvent: 'hover' },
    },
    {
      name: 'hover the fourth bar',
      act: { kind: 'hoverFrac', x: 0.7, y: 0.95 },
      expect: { event: { type: 'hover', payload: { xValue: 'D', yValue: 90, barId: 3 } } },
    },
    {
      name: 'leave the chart',
      act: { kind: 'leave' },
      expect: { event: { type: 'hover', payload: null } },
    },
  ],
};
