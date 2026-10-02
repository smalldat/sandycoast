import { type MouseHook, runMouseHook } from '../interaction/mouse.js';
import type { PanZoomHooks, ViewChangeIntent } from '../view/controller.js';
import { IDENTITY_VIEW, type ViewTransform } from '../view/types.js';
import {
  type ChartCoreEvents,
  type ChartEvent,
  ChartEventBus,
  type ChartPointerPx,
  type EmitOptions,
} from './events.js';
import {
  type ChartDrawContext,
  type ChartElement,
  type ChartLayer,
  type LayerDraw,
  type LayerOptions,
  type LayerSpace,
  LayerStack,
  drawElement,
} from './layers.js';

/**
 * Every event a chart exposes: the standard set plus whatever that chart adds.
 *
 * `M` is its mark metadata, `T` the union of items its data methods accept, and
 * `X` its own extra events (`hover`, `select`, `seriesChange`, …).
 */
export type ChartEvents<
  M = unknown,
  T = unknown,
  X extends Record<string, object> = Record<never, object>,
> = ChartCoreEvents<M, T> & X;

/** What the kernel needs from the chart to project and paint a frame. */
export interface ChartFrameInfo {
  /** Element the chart was mounted into. */
  host: HTMLElement;
  /** The chart's own (grain) canvas, whose device size layers match. */
  canvas: HTMLCanvasElement;
  /**
   * Box the chart's marks are laid out in, `[x0,y0,x1,y1]` canvas fractions,
   * y-up: the plot rect for cartesian charts, the disc rect for radial ones.
   */
  rect: [number, number, number, number];
  /** Device pixel ratio the chart is rendering at. */
  dpr: number;
  /** Live pan/zoom transform, or {@link IDENTITY_VIEW} where there is none. */
  view: ViewTransform;
  /** Seconds since the current animation started. */
  now: number;
}

/**
 * The behavior every chart in this package inherits: a cancellable event bus
 * and caller-owned drawing layers.
 *
 * A chart subclasses this, declares its mark/item/extra-event types, and
 * implements {@link chartFrame}. In exchange it gets `on()`, `addLayer()`,
 * `addElement()`, the standard `click`/`drag`/`pan`/`zoom`/`drawFinished`/
 * `data*` events, and the dispatch helpers that keep the
 * *listener → hook → built-in* order identical everywhere.
 *
 * The kernel deliberately owns **no** chart state — no data, no renderer, no
 * chrome. Charts differ too much there to share an implementation, and a base
 * class that reached into those would make every chart harder to read, not
 * easier.
 */
export abstract class ChartKernel<
  M = unknown,
  T = unknown,
  X extends Record<string, object> = Record<never, object>,
> {
  /** Typed, cancellable listener registry backing {@link on}. */
  protected readonly bus = new ChartEventBus<ChartEvents<M, T, X>>();
  private readonly layers = new LayerStack();
  private layerCanvas: HTMLCanvasElement | null = null;
  private frameCount = 0;
  private kernelDisposed = false;

  /**
   * Per-frame geometry, supplied by the chart. Called only when something is
   * listening or drawing, so charts need not make it cheap.
   */
  protected abstract chartFrame(): ChartFrameInfo;

  // --- events ---------------------------------------------------------------

  /**
   * Listen for `type`. The handler receives the payload's fields plus
   * `preventDefault()`, which suppresses the chart's built-in reaction on the
   * cancellable events (`click`, `dblclick`, `drag` start, `pan`, `zoom`, and
   * the three `data*` events). Returns an unsubscribe function.
   */
  on<K extends keyof ChartEvents<M, T, X> & string>(
    type: K,
    fn: (e: ChartEvent<ChartEvents<M, T, X>[K]>) => void,
  ): () => void {
    return this.bus.on(type, fn);
  }

  /** Dispatch and hand back the event, for callers that need the payload back. */
  protected emit<K extends keyof ChartEvents<M, T, X> & string>(
    type: K,
    payload: ChartEvents<M, T, X>[K],
    opts?: EmitOptions,
  ): ChartEvent<ChartEvents<M, T, X>[K]> {
    return this.bus.emit(type, payload, opts);
  }

  /** Dispatch and report whether the built-in reaction may run. */
  protected allows<K extends keyof ChartEvents<M, T, X> & string>(
    type: K,
    payload: ChartEvents<M, T, X>[K],
    opts?: EmitOptions,
  ): boolean {
    return this.bus.allows(type, payload, opts);
  }

  /**
   * The shared pointer path: dispatch the cancellable event, then run the
   * config-level {@link MouseHook}, then the chart's built-in behavior. Each
   * layer can stop the ones below it, and no chart has to re-derive that order.
   */
  protected dispatchClick(
    type: 'click' | 'dblclick',
    meta: M | null,
    native: PointerEvent | MouseEvent,
    px: ChartPointerPx,
    // The meta type varies by call site — a background click carries none — so
    // this accepts either shape and re-narrows for `runMouseHook` below.
    hook:
      | MouseHook<M, PointerEvent>
      | MouseHook<M, MouseEvent>
      | MouseHook<null, PointerEvent>
      | MouseHook<null, MouseEvent>
      | undefined,
    fallback: () => void,
  ): void {
    const payload = { meta, px, button: native.button } as ChartEvents<M, T, X>[typeof type];
    if (!this.allows(type, payload, { native })) return;
    runMouseHook(hook as MouseHook<M, Event> | undefined, meta, native, px, fallback);
  }

  /**
   * Announce a pending data mutation. Returns `false` once a listener has
   * vetoed it, in which case the caller must leave the dataset untouched.
   */
  protected allowsData(
    type: 'dataAdd' | 'dataUpdate' | 'dataRemove',
    action: 'add' | 'update' | 'replace' | 'remove',
    items: readonly T[],
  ): boolean {
    const payload = { action, items } as ChartEvents<M, T, X>[typeof type];
    return this.allows(type, payload);
  }

  /** Report one phase of a drag. Returns `false` when the gesture is vetoed. */
  protected allowsDrag(
    phase: 'start' | 'move' | 'end',
    target: 'view' | 'slider',
    px: ChartPointerPx,
    dx: number,
    dy: number,
    native: Event | null,
  ): boolean {
    const payload = { phase, target, dx, dy, px } as ChartEvents<M, T, X>['drag'];
    // Only the start is a decision point; by 'move' the gesture is already
    // under way and by 'end' there is nothing left to stop.
    return this.allows('drag', payload, { native, cancelable: phase === 'start' });
  }

  /**
   * Hooks to hand {@link PanZoomController}, turning every view change and drag
   * phase into the corresponding cancellable event. A chart with pan/zoom wires
   * this in one line and inherits the whole behavior.
   */
  protected panZoomHooks(): PanZoomHooks {
    return {
      beforeChange: (i) => this.allowsViewChange(i),
      drag: (i) => this.allowsDrag(i.phase, 'view', i.px, i.dx, i.dy, i.native),
    };
  }

  /**
   * Map a pending view change onto `zoom` or `pan`. A move that changes scale
   * is a zoom (it carries an offset correction to keep the anchor pinned, but
   * calling that a pan would make `pan` fire on every wheel tick).
   */
  private allowsViewChange(i: ViewChangeIntent): boolean {
    const scaled = i.next.scale[0] !== i.prev.scale[0] || i.next.scale[1] !== i.prev.scale[1];
    if (scaled) {
      const payload = {
        scale: i.next.scale,
        factor: i.factor,
        center: i.center,
      } as ChartEvents<M, T, X>['zoom'];
      return this.allows('zoom', payload, { native: i.native });
    }
    const payload = {
      offset: i.next.offset,
      delta: [i.next.offset[0] - i.prev.offset[0], i.next.offset[1] - i.prev.offset[1]],
    } as ChartEvents<M, T, X>['pan'];
    return this.allows('pan', payload, { native: i.native });
  }

  // --- drawing layers -------------------------------------------------------

  /**
   * Draw into the chart every frame. `draw` receives a 2D context sized in
   * device px plus projections from data/plot/canvas space, and paints above
   * the chart's own axes and legend.
   */
  addLayer(draw: LayerDraw, opts?: LayerOptions): ChartLayer {
    return this.layers.add(draw, opts);
  }

  /**
   * Add a declarative annotation — a rule, band, marker or label — without
   * writing canvas code. Positions default to data space, so the element
   * tracks the marks under pan and zoom.
   */
  addElement(element: ChartElement): ChartLayer {
    const opts: LayerOptions = {};
    if (element.id !== undefined) opts.id = element.id;
    if (element.z !== undefined) opts.z = element.z;
    if (element.visible !== undefined) opts.visible = element.visible;
    return this.layers.add((c) => drawElement(c, element), opts);
  }

  /** Remove every layer and element added by the caller. */
  clearLayers(): void {
    this.layers.clear();
    // Leave nothing of the last frame behind on a canvas nothing will repaint.
    const c = this.layerCanvas;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }

  /** How many layers are currently registered. */
  getLayerCount(): number {
    return this.layers.size;
  }

  /**
   * Called by the chart at the end of each rendered frame: repaints the
   * caller's layers and fires `drawFinished`.
   *
   * Cheap when unused — it returns before touching geometry if no layer is
   * registered and nothing is listening.
   */
  protected afterDraw(): void {
    this.frameCount++;
    const paint = this.layers.size > 0;
    const notify = this.bus.hasListeners('drawFinished');
    if (this.kernelDisposed || (!paint && !notify)) return;
    const frame = this.chartFrame();
    if (paint) this.paintLayers(frame);
    if (notify) {
      this.emit(
        'drawFinished',
        { now: frame.now, frame: this.frameCount } as ChartEvents<M, T, X>['drawFinished'],
        { cancelable: false },
      );
    }
  }

  private paintLayers(frame: ChartFrameInfo): void {
    const canvas = this.ensureLayerCanvas(frame.host);
    const w = frame.canvas.width;
    const h = frame.canvas.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    this.layers.paint(this.drawContext(ctx, frame, w, h));
  }

  private drawContext(
    ctx: CanvasRenderingContext2D,
    frame: ChartFrameInfo,
    deviceW: number,
    deviceH: number,
  ): ChartDrawContext {
    const [x0, y0, x1, y1] = frame.rect;
    const spanX = x1 - x0 || 1;
    const spanY = y1 - y0 || 1;
    const { view, dpr } = frame;
    return {
      ctx,
      deviceW,
      deviceH,
      dpr,
      plotRect: frame.rect,
      view,
      now: frame.now,
      toDevice(x: number, y: number, space: LayerSpace = 'data') {
        if (space === 'canvas') return { x: x * dpr, y: y * dpr };
        // Data space rides the pan/zoom transform; plot space is pinned to the box.
        const plx = space === 'data' ? x * view.scale[0] + view.offset[0] : x;
        const ply = space === 'data' ? y * view.scale[1] + view.offset[1] : y;
        const cx = x0 + plx * spanX;
        const cy = y0 + ply * spanY;
        // Canvas y runs down, layout y runs up.
        return { x: cx * deviceW, y: (1 - cy) * deviceH };
      },
      toSpace(x: number, y: number, space: LayerSpace = 'data') {
        if (space === 'canvas') return { x: x / dpr, y: y / dpr };
        const cx = x / (deviceW || 1);
        const cy = 1 - y / (deviceH || 1);
        const plx = (cx - x0) / spanX;
        const ply = (cy - y0) / spanY;
        if (space === 'plot') return { x: plx, y: ply };
        return {
          x: (plx - view.offset[0]) / (view.scale[0] || 1),
          y: (ply - view.offset[1]) / (view.scale[1] || 1),
        };
      },
    };
  }

  private ensureLayerCanvas(host: HTMLElement): HTMLCanvasElement {
    if (this.layerCanvas) return this.layerCanvas;
    this.ensureRelative(host);
    const c = document.createElement('canvas');
    c.style.position = 'absolute';
    c.style.top = '0';
    c.style.left = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.display = 'block';
    // Layers are decoration: the chart underneath must keep receiving pointers.
    c.style.pointerEvents = 'none';
    host.appendChild(c);
    this.layerCanvas = c;
    return c;
  }

  /** Make `host` a positioning context so absolute overlays anchor to it. */
  protected ensureRelative(host: HTMLElement): void {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  }

  /** Identity view, for charts without pan/zoom to hand to {@link chartFrame}. */
  protected get identityView(): ViewTransform {
    return IDENTITY_VIEW;
  }

  /**
   * Release kernel-owned resources. Charts override `dispose()` to tear down
   * their own renderer and chrome, and call `super.dispose()`.
   */
  dispose(): void {
    this.kernelDisposed = true;
    this.bus.clear();
    this.layers.clear();
    this.layerCanvas?.remove();
    this.layerCanvas = null;
  }
}
