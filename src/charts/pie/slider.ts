// The series slider now lives in `core/chrome` — the candlestick chart needs
// the same control, and anything two charts share belongs in core rather than
// being imported chart-to-chart. This module stays as a thin re-export so the
// pie chart's public surface (`src/charts/pie/index.ts`) is unchanged.

export {
  drawSlider,
  fractionAtPx,
  indexAt,
  resolveSlider,
  sliderBandPx,
  sliderTicks,
  sliderTrack,
  trackPos,
} from '../../core/chrome/slider.js';
export type { ResolvedSlider, SliderRender, SliderTrack } from '../../core/chrome/slider.js';
