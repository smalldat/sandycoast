// Public API for @smalldat/sandycoast.

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
export { resolveBarStyle } from './charts/bar/barStyle.js';
export type { ResolvedBarStyle } from './charts/bar/barStyle.js';

// Pie / donut chart (one series at a time, picked by the series slider)
export { PieChart } from './charts/pie/PieChart.js';
export { hitSlice, layoutPie } from './charts/pie/layout.js';
export type { PieLayout, PieLayoutOptions } from './charts/pie/layout.js';
export { resolvePieStyle } from './charts/pie/pieStyle.js';
export type { ResolvedPieStyle, ResolvedSliceBorder } from './charts/pie/pieStyle.js';
export {
  fractionAtPx,
  indexAt,
  resolveSlider,
  sliderBandPx,
  sliderTicks,
  sliderTrack,
  trackPos,
} from './charts/pie/slider.js';
export type { ResolvedSlider, SliderTrack } from './charts/pie/slider.js';
export { DEFAULT_MAX_SERIES, DEFAULT_MAX_SLICES } from './charts/pie/types.js';
export type {
  PieChartConfig,
  PieStyleConfig,
  SeriesChangePayload,
  SliceMeta,
  SliderConfig,
  TitleConfig,
} from './charts/pie/types.js';

// Shared chrome (axes, legend, title, current value, FPS) — used by every chart
export { FpsMeter, resolveFps } from './core/chrome/fps.js';
export type { ResolvedFps } from './core/chrome/fps.js';
export { Legend } from './core/chrome/legend.js';
export type { LegendEntry } from './core/chrome/legend.js';
export { Title } from './core/chrome/title.js';
export {
  axisMargins,
  marginsToPlotRect,
  resolveChrome,
} from './core/chrome/chrome.js';
export type {
  ChromeInput,
  Margins,
  ResolvedAxis,
  ResolvedChrome,
  ResolvedCurrentValue,
  ResolvedLegend,
  ResolvedTitle,
} from './core/chrome/chrome.js';
export { formatNumber, formatValue } from './core/chrome/format.js';
export type { AxisTick } from './core/chrome/format.js';
export { resolveReveal, revealFactor } from './core/chrome/reveal.js';
export type { ResolvedFill, ResolvedReveal, RevealConfig } from './core/chrome/reveal.js';
export { PLOT_HEIGHT } from './core/layout/plot.js';

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

// Scatter chart (continuous x/y, explicit series array; marker in place of line/border)
export { ScatterChart } from './charts/scatter/ScatterChart.js';
export { layoutScatter } from './charts/scatter/layout.js';
export type { ScatterLayout } from './charts/scatter/layout.js';
export {
  resolveApproximation,
  computeApproximationPaths,
} from './charts/scatter/approximation.js';
export type {
  ResolvedApproximation,
  ApproximationPath,
} from './charts/scatter/approximation.js';
export { resolveMarkerStyle, shapeForSeries, sizeForSeries } from './charts/scatter/markerStyle.js';
export type { ResolvedMarkerStyle } from './charts/scatter/markerStyle.js';
export type {
  HoverPayload as ScatterHoverPayload,
  MarkerShape,
  MarkerStyleConfig,
  ScatterApproximationConfig,
  ScatterChartConfig,
  ScatterMeta,
} from './charts/scatter/types.js';

// Mesh/scatter data model (additive sibling of Point/DataSet — see core/data/mesh.ts)
export { meshPoints, resolveMeshTypes, validateMesh } from './core/data/dataset.js';
export type { MeshDataSet, MeshPoint, MeshSeries, MeshValue } from './core/data/mesh.js';

// Swappable point-cloud approximation strategies
export { LeastSquaresApproximation } from './core/approx/leastSquares.js';
export { NoneApproximation } from './core/approx/none.js';
export { SplineApproximation } from './core/approx/spline.js';
export { StraightApproximation } from './core/approx/straight.js';
export type { Approximation, FitPoint } from './core/approx/types.js';

// Shared curve tracing (extracted from the line chart; reused by scatter's approximations)
export { catmullRomToBezier, tracePolylinePath } from './core/geometry/curve.js';
export type { BezierSegment, CurveStyle, Vec2 } from './core/geometry/curve.js';

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
export {
  blobArea,
  blobGrainCounts,
  grainCounts,
  lineGrainCounts,
  packBars,
  packBlobs,
  packLine,
} from './core/particles/pack.js';
export type {
  BarRect,
  LinePackOptions,
  LineSeg,
  PackOptions,
  PackTarget,
  PointBlob,
} from './core/particles/pack.js';

// Pan & zoom (shared abstraction across all visuals)
export { PanZoomController } from './core/view/controller.js';
export { ZoomControls } from './core/view/controls.js';
export {
  IDENTITY_VIEW,
  type PanZoomable,
  type PanZoomConfig,
  type PanZoomControlsConfig,
  resolvePanZoom,
  type ResolvedPanZoom,
  type ViewTransform,
  type ZoomCorner,
} from './core/view/types.js';

// Utils
export { cssRGBA, DEFAULT_PALETTE, parseColor } from './core/util/color.js';
