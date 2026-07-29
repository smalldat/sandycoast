import type { PanZoomable, ResolvedPanZoom, ViewTransform } from './types.js';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalized plot rect `[x0,y0,x1,y1]` (y-up) the chart currently renders into. */
type PlotRectFn = () => [number, number, number, number];

/**
 * Holds the live {@link ViewTransform} and translates pointer input (wheel zoom,
 * drag pan) plus programmatic calls into clamped scale/offset updates, firing
 * `onChange` whenever the view moves. Pure of any chart specifics: it only needs
 * the canvas to attach to and a getter for the current plot rect (so pointer
 * math accounts for the axes/legend gutters). Implements {@link PanZoomable}.
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
  ) {}

  // --- PanZoomable ---------------------------------------------------------

  getView(): ViewTransform {
    return { scale: [this.scaleX, this.scaleY], offset: [this.offX, this.offY] };
  }

  setView(view: Partial<ViewTransform>): void {
    if (view.scale) {
      this.scaleX = this.cfg.axisX ? this.limitScale(view.scale[0]) : 1;
      this.scaleY = this.cfg.axisY ? this.limitScale(view.scale[1]) : 1;
    }
    if (view.offset) {
      this.offX = this.cfg.axisX ? view.offset[0] : 0;
      this.offY = this.cfg.axisY ? view.offset[1] : 0;
    }
    this.clampOffset();
    this.onChange();
  }

  panBy(dx: number, dy: number): void {
    this.offX += this.cfg.axisX ? dx : 0;
    this.offY += this.cfg.axisY ? dy : 0;
    this.clampOffset();
    this.onChange();
  }

  panTo(x: number, y: number): void {
    // Put data fraction (x,y) at the plot origin: 0 = x*scale + offset.
    if (this.cfg.axisX) this.offX = -x * this.scaleX;
    if (this.cfg.axisY) this.offY = -y * this.scaleY;
    this.clampOffset();
    this.onChange();
  }

  zoomBy(factor: number, cx = 0.5, cy = 0.5): void {
    this.applyScale(this.scaleX * factor, this.scaleY * factor, cx, cy);
  }

  zoomTo(scale: number, cx = 0.5, cy = 0.5): void {
    this.applyScale(scale, scale, cx, cy);
  }

  resetView(): void {
    this.scaleX = this.scaleY = 1;
    this.offX = this.offY = 0;
    this.onChange();
  }

  isPanZoomEnabled(): boolean {
    return this.cfg.enabled;
  }

  // --- internals -----------------------------------------------------------

  private limitScale(s: number): number {
    return clamp(s, this.cfg.minZoom, this.cfg.maxZoom);
  }

  /** Zoom about a plot-local anchor, keeping that point pinned on screen. */
  private applyScale(nsx: number, nsy: number, cx: number, cy: number): void {
    const sx = this.cfg.axisX ? this.limitScale(nsx) : 1;
    const sy = this.cfg.axisY ? this.limitScale(nsy) : 1;
    // offsetNew = anchor - (anchor - offsetOld) * (scaleNew / scaleOld)
    this.offX = cx - (cx - this.offX) * (sx / this.scaleX);
    this.offY = cy - (cy - this.offY) * (sy / this.scaleY);
    this.scaleX = sx;
    this.scaleY = sy;
    this.clampOffset();
    this.onChange();
  }

  /** Keep the data `[0,1]` box covering the plot: offset ∈ [1-scale, 0]. */
  private clampOffset(): void {
    this.offX = clamp(this.offX, Math.min(0, 1 - this.scaleX), 0);
    this.offY = clamp(this.offY, Math.min(0, 1 - this.scaleY), 0);
  }

  /** Pointer position in plot-local fractions (y-up), via the current plot rect. */
  private pointerPlot(e: { clientX: number; clientY: number }): { plx: number; ply: number } {
    const rect = this.canvas!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const cy = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
    const [x0, y0, x1, y1] = this.plotRect();
    return { plx: (cx - x0) / (x1 - x0 || 1), ply: (cy - y0) / (y1 - y0 || 1) };
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
    this.zoomBy(factor, plx, ply);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
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
    const dxFrac = (e.clientX - this.lastX) / Math.max(1, rect.width) / (x1 - x0 || 1);
    // Screen y is down; plot y is up → negate.
    const dyFrac = -(e.clientY - this.lastY) / Math.max(1, rect.height) / (y1 - y0 || 1);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (dxFrac !== 0 || dyFrac !== 0) this.moved = true;
    this.panBy(dxFrac, dyFrac);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
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
