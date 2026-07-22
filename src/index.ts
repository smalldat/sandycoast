// Public API for @smalldat/visual.

// Bar chart
export { BarChart } from './charts/bar/BarChart.js';
export { layoutBars } from './charts/bar/layout.js';
export type {
  AxisConfig,
  BarChartConfig,
  BarMeta,
  BarStyleConfig,
  CurrentValueConfig,
  FpsConfig,
  FpsPosition,
  HoverEffect,
  HoverPayload,
  LegendConfig,
  Side,
} from './charts/bar/types.js';
export { resolveBarStyle, revealFactor } from './charts/bar/barStyle.js';
export type { ResolvedBarStyle } from './charts/bar/barStyle.js';
export { FpsMeter, resolveFps } from './charts/bar/fps.js';
export type { ResolvedFps } from './charts/bar/fps.js';

// Line chart (mirrors the bar chart's config surface; line style in place of border)
export { LineChart } from './charts/line/LineChart.js';
export { layoutLine } from './charts/line/layout.js';
export type { LineLayout, SeriesPath } from './charts/line/layout.js';
export type {
  LineChartConfig,
  LineMeta,
  LineShape,
  LineStyleConfig,
} from './charts/line/types.js';
export { resolveLineStyle } from './charts/line/lineStyle.js';
export type { ResolvedLineStyle } from './charts/line/lineStyle.js';

// Generic data model (shared by all visuals)
export {
  appendPoints,
  DataError,
  fromRows,
  inferType,
  patchPoints,
  removePoints,
  resolveTypes,
  seriesKeys,
  toNumeric,
  validate,
} from './core/data/dataset.js';
export type {
  Accessor,
  AccessorSpec,
  DataSet,
  FieldType,
  Point,
  PointPatch,
  PointRef,
  Scalar,
} from './core/data/types.js';

// Scales
export { BandScale, LinearScale, makeScale, TimeScale } from './core/scales/index.js';
export type { Scale } from './core/scales/types.js';

// Rendering
export { pickRenderer } from './core/render/pick.js';
export type { BackendPreference } from './core/render/pick.js';
export type {
  BackendKind,
  FrameUniforms,
  GrainShape,
  Renderer,
  RGBA,
} from './core/render/types.js';

// Particles (advanced / custom visuals)
export { ease, evalGrain, scatterStarts } from './core/particles/anim.js';
export type { Easing } from './core/particles/anim.js';
export { allocGrains } from './core/particles/grains.js';
export type { GrainBuffer } from './core/particles/grains.js';
export { grainCounts, lineGrainCounts, packBars, packLine } from './core/particles/pack.js';
export type {
  BarRect,
  LinePackOptions,
  LineSeg,
  PackOptions,
  PackTarget,
} from './core/particles/pack.js';

// Utils
export { cssRGBA, DEFAULT_PALETTE, parseColor } from './core/util/color.js';
