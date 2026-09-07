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
  DimConfig,
  FpsConfig,
  FpsPosition,
  HoverEffect,
  HoverPayload,
  LegendConfig,
  SeriesFocusPayload,
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
export { drawSlider } from './core/chrome/slider.js';
export type { SliderRender } from './core/chrome/slider.js';
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
export { Table, resolveTable } from './core/chrome/table.js';
export type { ResolvedTable, TableRow } from './core/chrome/table.js';
export type { TableConfig } from './core/chrome/types.js';
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

// Wind rose (two indicators over one time dimension; petals aggregate readings)
export { WindRoseChart } from './charts/windrose/WindRoseChart.js';
export { hitSegment, layoutWindRose } from './charts/windrose/layout.js';
export type { WindRoseLayout, WindRoseLayoutOptions } from './charts/windrose/layout.js';
export {
  bandEdges,
  bandOf,
  bandRanges,
  binDirections,
  sectorBounds,
  sectorOf,
  segmentKeyByObservation,
  stacks,
} from './charts/windrose/binning.js';
export type {
  BandConfig,
  Bin,
  PetalMode,
  RadialMeasure,
  SectorAlign,
  Segment,
  SegmentOrder,
} from './charts/windrose/binning.js';
export { buildRoseAxes, compassTicks, niceStep, radialRings } from './charts/windrose/axis.js';
export type { CompassTick, RadialRing, RoseAxes } from './charts/windrose/axis.js';
export { COMPASS_16, bearingLabel, degreesFromRadians } from './charts/windrose/compass.js';
export {
  highlightTargets,
  resolveHighlight,
  resolveRoseStyle,
} from './charts/windrose/roseStyle.js';
export type {
  HighlightTarget,
  ResolvedHighlight,
  ResolvedRoseStyle,
  ResolvedSegmentBorder,
} from './charts/windrose/roseStyle.js';
export {
  DEFAULT_MAX_SEGMENTS,
  DEFAULT_RAMP_STEPS,
  DEFAULT_SECTORS,
} from './charts/windrose/types.js';
export type {
  BandsConfig,
  CalmConfig,
  HighlightConfig,
  HighlightPayload,
  MouseConfig,
  ObservationMeta,
  PetalConfig,
  RadialConfig,
  RoseStyleConfig,
  SectorConfig,
  SegmentMeta,
  SelectPayload,
  HoverPayload as WindRoseHoverPayload,
  WindRoseChartConfig,
  WindRoseTableConfig,
} from './charts/windrose/types.js';

// Wind data model (additive sibling of Point/DataSet — see core/data/wind.ts)
export { normalizeWind, validateWind } from './core/data/dataset.js';
export type {
  NormalizedWind,
  WindDataSet,
  WindObservation,
  WindPoint,
} from './core/data/wind.js';

// Overridable pointer behavior, shared across visuals
export { runMouseHook } from './core/interaction/mouse.js';
export type { MouseHook, MouseHookContext, MouseHookResult } from './core/interaction/mouse.js';

// Shared polar layout helpers (disc-shaped visuals: pie/donut, wind rose)
export {
  CENTER,
  MAX_RADIUS,
  angleInWedge,
  layoutToAngle,
  normalizeAngle,
  polarToLayout,
  squareRect,
} from './core/layout/polar.js';

// Candlestick chart (OHLC + live price; rising/falling color rule, series slider)
export { CandlestickChart } from './charts/candlestick/CandlestickChart.js';
export { hitCandle, layoutCandles } from './charts/candlestick/layout.js';
export type {
  CandleLayout,
  CandleLayoutOptions,
  XSlot as CandleXSlot,
} from './charts/candlestick/layout.js';
export { resolveDirection } from './charts/candlestick/direction.js';
export {
  DEFAULT_FALLING,
  DEFAULT_RISING,
  resolveActual,
  resolveCandleStyle,
} from './charts/candlestick/candleStyle.js';
export type {
  ResolvedActual,
  ResolvedCandleBorder,
  ResolvedCandleStyle,
  ResolvedWick,
} from './charts/candlestick/candleStyle.js';
export {
  DEFAULT_MAX_CANDLES,
  DEFAULT_MAX_SERIES as DEFAULT_MAX_INSTRUMENTS,
} from './charts/candlestick/types.js';
export type {
  ActualConfig,
  CandleBody,
  CandleDirection,
  CandleDirectionFn,
  CandleMeta,
  CandleSpacing,
  CandleStyleConfig,
  CandlestickChartConfig,
  ClickPayload as CandleClickPayload,
  HoverPayload as CandleHoverPayload,
  MouseConfig as CandleMouseConfig,
  SeriesChangePayload as CandleSeriesChangePayload,
} from './charts/candlestick/types.js';

// OHLC data model (additive sibling of Point/DataSet — see core/data/ohlc.ts)
export {
  allCandles,
  appendCandles,
  patchCandles,
  removeCandles,
  resolveOhlcTypes,
  validateOhlc,
} from './core/data/dataset.js';
export type {
  Candle,
  CandlePatch,
  CandleRef,
  CandleSeries,
  OhlcDataSet,
} from './core/data/ohlc.js';
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
  boxArea,
  boxGrainCounts,
  grainCounts,
  lineGrainCounts,
  packBars,
  packBlobs,
  packBoxes,
  packLine,
} from './core/particles/pack.js';
export type {
  BarRect,
  BoxRect,
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
