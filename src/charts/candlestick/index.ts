// Public surface of the candlestick chart component. Everything it needs from
// the rest of the library comes from `src/core`; it never reaches into another
// chart.

export { CandlestickChart } from './CandlestickChart.js';
export { hitCandle, layoutCandles } from './layout.js';
export type { CandleLayout, CandleLayoutOptions, XSlot } from './layout.js';
export { resolveDirection } from './direction.js';
export {
  DEFAULT_FALLING,
  DEFAULT_RISING,
  resolveActual,
  resolveCandleStyle,
  revealFactor,
} from './candleStyle.js';
export type {
  ResolvedActual,
  ResolvedCandleBorder,
  ResolvedCandleStyle,
  ResolvedWick,
} from './candleStyle.js';
export { buildAxes } from './axis.js';
export type { AxisModel } from './axis.js';
export { DEFAULT_MAX_CANDLES, DEFAULT_MAX_SERIES } from './types.js';
export type {
  ActualConfig,
  CandleBody,
  CandleDirection,
  CandleDirectionFn,
  CandleMeta,
  CandleSpacing,
  CandleStyleConfig,
  CandlestickChartConfig,
  ClickPayload,
  HoverPayload,
  MouseConfig,
  SeriesChangePayload,
} from './types.js';
