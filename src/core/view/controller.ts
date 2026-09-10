import type { PanZoomable, ResolvedPanZoom, ViewTransform } from './types.js';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalized plot rect `[x0,y0,x1,y1]` (y-up) the chart currently renders into. */
type PlotRectFn = () => [number, number, number, number];

/** What moved the view: user input on an axis, or a programmatic call. */
export type ViewCause = 'pan' | 'zoom' | 'set' | 'reset';

/** The move a controller is about to make, handed to {@link ViewChangeHook}. */
export interface ViewChangeIntent {
  /** Where the view would land (already axis-gated and clamped). */
  next: ViewTransform;
  /** Where it is now. */
  prev: ViewTransform;
  cause: ViewCause;
  /** DOM event that caused it, or `null` when called programmatically. */
  native: Event | null;
  /** Zoom anchor in plot-local fractions; plot center for non-zoom causes. */
  center: [number, number];
  /** Scale multiplier against `prev` — `1` for a pure pan. */
  factor: number;
}

/** One phase of a drag-to-pan gesture. */
export interface DragIntent {
  phase: 'start' | 'move' | 'end';
  /** Pointer position in CSS px, relative to the canvas. */
  px: { x: number; y: number };
  /** Movement since the previous phase, in CSS px. Zero on `'start'`. */
  dx: number;
  dy: number;
  native: PointerEvent;
}

/**
 * Veto hooks. Returning `false` cancels; returning anything else (including
 * nothing) lets the move proceed — the same contract as
 * `core/interaction/mouse.ts`, so a caller learns it once.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: the void arm is what lets a hook body simply not return
export type ViewChangeHook = (intent: ViewChangeIntent) => boolean | void;
// biome-ignore lint/suspicious/noConfusingVoidType: as above
export type DragHook = (intent: DragIntent) => boolean | void;

export interface PanZoomHooks {
  /** Runs before every view change, whatever caused it. */
  beforeChange?: ViewChangeHook;
  /** Runs at each drag phase; vetoing `'start'` abandons the gesture. */
  drag?: DragHook;
}

/**
 * Holds the live {@link ViewTransform} and translates pointer input (wheel zoom,
 * drag pan) plus programmatic calls into clamped scale/offset updates, firing
 * `onChange` whenever the view moves. Pure of any chart specifics: it only needs
 * the canvas to attach to and a getter for the current plot rect (so pointer
 * math accounts for the axes/legend gutters). Implements {@link PanZoomable}.
 *
 * Every mutation — user or programmatic — funnels through {@link commit}, which
 * is the single point where {@link PanZoomHooks.beforeChange} can veto. Charts
 * use that to expose cancellable `pan` / `zoom` events without each of them
 * re-deriving where a view change can originate.
 */
export class PanZoomController implements PanZoomable {
  private scaleX = 1;
  private scaleY = 1;
  private offX = 0;
  private offY = 0;

  private canvas: HTMLCanvasElement | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private moved = false;

  constructor(
    private cfg: ResolvedPanZoom,
    private plotRect: PlotRectFn,
    private onChange: () => void,
    private hooks: PanZoomHooks = {},
  ) {}

  // --- PanZoomable ---------------------------------------------------------

  getView(): ViewTransform {
    return { scale: [this.scaleX, this.scaleY], offset: [this.offX, this.offY] };
  }

  setView(view: Partial<ViewTransform>): void {
    const scale: [number, number] = view.scale
      ? [
          this.cfg.axisX ? this.limitScale(view.scale[0]) : 1,
          this.cfg.axisY ? this.limitScale(view.scale[1]) : 1,
        ]
      : [this.scaleX, this.scaleY];
    const offset: [number, number] = view.offset
      ? [this.cfg.axisX ? view.offset[0] : 0, this.cfg.axisY ? view.offset[1] : 0]
      : [this.offX, this.offY];
    this.commit(scale, offset, 'set', null);
  }

  panBy(dx: number, dy: number, native: Event | null = null): void {
    const offset: [number, number] = [
      this.offX + (this.cfg.axisX ? dx : 0),
      this.offY + (this.cfg.axisY ? dy : 0),
    ];
    this.commit([this.scaleX, this.scaleY], offset, 'pan', native);
  }

  panTo(x: number, y: number): void {
    // Put data fraction (x,y) at the plot origin: 0 = x*scale + offset.
    const offset: [number, number] = [
      this.cfg.axisX ? -x * this.scaleX : this.offX,
      this.cfg.axisY ? -y * this.scaleY : this.offY,
    ];
    this.commit([this.scaleX, this.scaleY], offset, 'pan', null);
  }

  zoomBy(factor: number, cx = 0.5, cy = 0.5, native: Event | null = null): void {
    this.applyScale(this.scaleX * factor, this.scaleY * factor, cx, cy, native);
  }

  zoomTo(scale: number, cx = 0.5, cy = 0.5): void {
    this.applyScale(scale, scale, cx, cy, null);
  }

  resetView(): void {
    this.commit([1, 1], [0, 0], 'reset', null);
  }

  isPanZoomEnabled(): boolean {
    return this.cfg.enabled;
  }

  // --- internals -----------------------------------------------------------

  private limitScale(s: number): number {
    return clamp(s, this.cfg.minZoom, this.cfg.maxZoom);
  }

  /** Zoom about a plot-local anchor, keeping that point pinned on screen. */
  private applyScale(nsx: number, nsy: number, cx: number, cy: number, native: Event | null): void {
    const sx = this.cfg.axisX ? this.limitScale(nsx) : 1;
    const sy = this.cfg.axisY ? this.limitScale(nsy) : 1;
    // offsetNew = anchor - (anchor - offsetOld) * (scaleNew / scaleOld)
    const offset: [number, number] = [
      cx - (cx - this.offX) * (sx / this.scaleX),
      cy - (cy - this.offY) * (sy / this.scaleY),
    ];
    this.commit([sx, sy], offset, 'zoom', native, [cx, cy], sx / this.scaleX);
  }

  /**
   * The one place the view actually changes: clamp, offer the move to
   * `beforeChange`, then apply and notify. A move that lands exactly where the
   * view already is neither fires a hook nor repaints.
   */
  private commit(
    scale: [number, number],
    rawOffset: [number, number],
    cause: ViewCause,
    native: Event | null,
    center: [number, number] = [0.5, 0.5],
    factor = 1,
  ): void {
    const offset = this.clampOffsetFor(scale, rawOffset);
    const prev = this.getView();
    if (
      scale[0] === prev.scale[0] &&
      scale[1] === prev.scale[1] &&
      offset[0] === prev.offset[0] &&
      offset[1] === prev.offset[1]
    ) {
      return;
    }
    const next: ViewTransform = { scale, offset };
    if (this.hooks.beforeChange?.({ next, prev, cause, native, center, factor }) === false) return;
    this.scaleX = scale[0];
    this.scaleY = scale[1];
    this.offX = offset[0];
    this.offY = offset[1];
    this.onChange();
  }

  /** Keep the data `[0,1]` box covering the plot: offset ∈ [1-scale, 0]. */
  private clampOffsetFor(scale: [number, number], offset: [number, number]): [number, number] {
    return [
      clamp(offset[0], Math.min(0, 1 - scale[0]), 0),
      clamp(offset[1], Math.min(0, 1 - scale[1]), 0),
    ];
  }

  /** Pointer position in plot-local fractions (y-up), via the current plot rect. */
  private pointerPlot(e: { clientX: number; clientY: number }): { plx: number; ply: number } {
    const rect = this.canvas!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const cy = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
    const [x0, y0, x1, y1] = this.plotRect();
    return { plx: (cx - x0) / (x1 - x0 || 1), ply: (cy - y0) / (y1 - y0 || 1) };
  }

  /** Pointer position in CSS px relative to the canvas. */
  private pointerPx(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // --- input wiring --------------------------------------------------------

  /** Attach wheel/drag listeners to the grain canvas. No-op if disabled. */
  attach(canvas: HTMLCanvasElement): void {
    if (!this.cfg.enabled) return;
    this.canvas = canvas;
    canvas.style.touchAction = 'none';
    if (this.cfg.wheel) canvas.addEventListener('wheel', this.onWheel, { passive: false });
    if (this.cfg.drag) {
      canvas.addEventListener('pointerdown', this.onDown);
      canvas.addEventListener('pointermove', this.onMove);
      canvas.addEventListener('pointerup', this.onUp);
      canvas.addEventListener('pointercancel', this.onUp);
    }
  }

  detach(): void {
    const c = this.canvas;
    if (!c) return;
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.style.cursor = '';
    this.canvas = null;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { plx, ply } = this.pointerPlot(e);
    // Exponential so repeated ticks zoom smoothly and symmetrically.
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.zoomBy(factor, plx, ply, e);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (
      this.hooks.drag?.({ phase: 'start', px: this.pointerPx(e), dx: 0, dy: 0, native: e }) ===
      false
    ) {
      return;
    }
    this.dragging = true;
    this.moved = false;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas!.setPointerCapture(e.pointerId);
    this.canvas!.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const rect = this.canvas!.getBoundingClientRect();
    const [x0, y0, x1, y1] = this.plotRect();
    const dxPx = e.clientX - this.lastX;
    const dyPx = e.clientY - this.lastY;
    const dxFrac = dxPx / Math.max(1, rect.width) / (x1 - x0 || 1);
    // Screen y is down; plot y is up → negate.
    const dyFrac = -dyPx / Math.max(1, rect.height) / (y1 - y0 || 1);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (dxFrac !== 0 || dyFrac !== 0) this.moved = true;
    this.hooks.drag?.({ phase: 'move', px: this.pointerPx(e), dx: dxPx, dy: dyPx, native: e });
    this.panBy(dxFrac, dyFrac, e);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.hooks.drag?.({ phase: 'end', px: this.pointerPx(e), dx: 0, dy: 0, native: e });
    try {
      this.canvas!.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    this.canvas!.style.cursor = '';
  };

  /** Whether a drag just moved the view (charts use this to suppress a click). */
  didDrag(): boolean {
    return this.moved;
  }
}
