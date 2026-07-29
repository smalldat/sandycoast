// Shared pan & zoom abstraction, backend- and chart-agnostic. Every visual
// maps its layout `[0,1]` box through a {@link ViewTransform} before the plot
// rect, so pan/zoom is a single transform applied uniformly to grains (shader /
// canvas2d) and chrome (overlay). Kept in `core` so the bar and line charts —
// and any future visual — reuse the exact same code.

/**
 * A 2D affine transform in layout space: a point `p` in `[0,1]` (y-up) is mapped
 * to `p' = p * scale + offset`. Identity (`scale [1,1]`, `offset [0,0]`) renders
 * exactly as a chart with no pan/zoom.
 */
export interface ViewTransform {
  /** Layout-space zoom `[sx, sy]`; `1` = no zoom (fit), `>1` = zoomed in. */
  scale: [number, number];
  /** Layout-space translation `[ox, oy]` applied after scale (plot-local units). */
  offset: [number, number];
}

/** The no-op transform: charts render identically to having no pan/zoom. */
export const IDENTITY_VIEW: ViewTransform = { scale: [1, 1], offset: [0, 0] };

/** Which corner of the plot the on-chart zoom controls pin to. */
export type ZoomCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** On-chart UI (zoom in / out / reset) for pointer-free control. */
export interface PanZoomControlsConfig {
  /** Draw the buttons. Default `true` when pan/zoom is enabled. */
  show?: boolean;
  /**
   * Corner to pin to. Anchored to the **plot** corner (inside the axes/legend),
   * and nudged clear of the FPS meter, so legend / FPS / zoom never overlap.
   * Default `'top-right'`.
   */
  position?: ZoomCorner;
  /** Zoom factor per `+`/`−` click. Default `1.4`. */
  step?: number;
  /** Button text/border color (CSS). Default a subdued light gray. */
  color?: string;
}

/**
 * Pan & zoom configuration. Off by default; a config without `panZoom` renders
 * exactly as before. When enabled, the plot can be panned (drag) and zoomed
 * (wheel + UI), and the same transform is applied programmatically via the
 * chart's {@link PanZoomable} methods.
 */
export interface PanZoomConfig {
  /** Master switch. Default `false`. */
  enabled?: boolean;
  /** Which axes may pan/zoom. Default `'both'`. */
  axes?: 'x' | 'y' | 'both';
  /** Minimum zoom (fit). Default `1` — can't zoom out past the data extent. */
  minZoom?: number;
  /** Maximum zoom. Default `10`. */
  maxZoom?: number;
  /** Zoom on mouse wheel / trackpad. Default `true`. */
  wheel?: boolean;
  /** Pan on pointer drag. Default `true`. */
  drag?: boolean;
  /** On-chart zoom buttons. */
  controls?: PanZoomControlsConfig;
}

export interface ResolvedControls {
  show: boolean;
  position: ZoomCorner;
  step: number;
  color: string;
}

export interface ResolvedPanZoom {
  enabled: boolean;
  axisX: boolean;
  axisY: boolean;
  minZoom: number;
  maxZoom: number;
  wheel: boolean;
  drag: boolean;
  controls: ResolvedControls;
}

const CONTROLS_COLOR = 'rgba(232,236,242,0.95)';

/** Resolve the `panZoom` config block into concrete values. */
export function resolvePanZoom(cfg: PanZoomConfig | undefined): ResolvedPanZoom {
  const enabled = cfg?.enabled ?? false;
  const axes = cfg?.axes ?? 'both';
  return {
    enabled,
    axisX: axes === 'x' || axes === 'both',
    axisY: axes === 'y' || axes === 'both',
    minZoom: cfg?.minZoom ?? 1,
    maxZoom: cfg?.maxZoom ?? 10,
    wheel: cfg?.wheel ?? true,
    drag: cfg?.drag ?? true,
    controls: {
      show: cfg?.controls?.show ?? enabled,
      position: cfg?.controls?.position ?? 'top-right',
      step: cfg?.controls?.step ?? 1.4,
      color: cfg?.controls?.color ?? CONTROLS_COLOR,
    },
  };
}

/**
 * Unified programmatic pan/zoom interface. Implemented by every visual so pan
 * and zoom can be driven from code identically regardless of chart type. All
 * coordinates are **plot-local fractions** in `[0,1]` (y-up): `(0,0)` = bottom
 * left of the plot, `(1,1)` = top right.
 */
export interface PanZoomable {
  /** Current transform (cloned; safe to keep). */
  getView(): ViewTransform;
  /** Replace part or all of the transform (clamped to the configured limits). */
  setView(view: Partial<ViewTransform>): void;
  /** Pan by a plot-local delta (positive `dx` moves the data right). */
  panBy(dx: number, dy: number): void;
  /** Pan so the given data fraction sits at the plot's bottom-left origin. */
  panTo(x: number, y: number): void;
  /** Multiply the current zoom by `factor` about `(cx, cy)` (default plot center). */
  zoomBy(factor: number, cx?: number, cy?: number): void;
  /** Set the absolute zoom about `(cx, cy)` (default plot center). */
  zoomTo(scale: number, cx?: number, cy?: number): void;
  /** Reset to the identity view (fully zoomed out, no pan). */
  resetView(): void;
  /** Whether pan/zoom is enabled for this instance. */
  isPanZoomEnabled(): boolean;
}
