/**
 * Caller-owned drawing on top of any chart.
 *
 * Two ways in, sharing one coordinate model:
 *
 * - `addLayer(draw)` hands you a `CanvasRenderingContext2D` once per frame,
 *   for anything the declarative form cannot express;
 * - `addElement({ kind: 'line', … })` covers the common annotations — a
 *   threshold rule, a target band, a callout — without writing canvas code.
 *
 * Layers paint onto a dedicated canvas above the chart's own chrome, so they
 * never fight the chart for the overlay it repaints on its own schedule, and
 * they survive frames where the chart itself has nothing to redraw.
 */

import type { ViewTransform } from '../view/types.js';

/**
 * Which coordinate system a layer's numbers are in.
 *
 * - `'data'` — the chart's layout space, `[0,1]` per axis, y-up, **following
 *   pan/zoom**. Mark metadata (`BarMeta.x0`, `SliceMeta` angles, …) is in this
 *   space, so an annotation pinned to a mark belongs here.
 * - `'plot'` — the plot box, `[0,1]` per axis, y-up, ignoring pan/zoom. Use for
 *   things anchored to the frame rather than the data, like a corner badge.
 * - `'canvas'` — CSS px from the element's top-left, y-down, like the DOM.
 */
export type LayerSpace = 'data' | 'plot' | 'canvas';

/** What a layer's `draw` receives once per painted frame. */
export interface ChartDrawContext {
  /** Destination context, sized in device px and already cleared. */
  ctx: CanvasRenderingContext2D;
  /** Canvas size in device px. */
  deviceW: number;
  deviceH: number;
  /** Device pixel ratio — multiply CSS px by this before drawing. */
  dpr: number;
  /** Plot box within the canvas, `[x0,y0,x1,y1]` fractions, y-up. */
  plotRect: readonly [number, number, number, number];
  /** Live pan/zoom transform (identity on charts without pan/zoom). */
  view: ViewTransform;
  /** Seconds since the chart's current animation started. */
  now: number;
  /** Map a point in `space` to device px (y-down), ready to draw. */
  toDevice(x: number, y: number, space?: LayerSpace): { x: number; y: number };
  /** Inverse of {@link toDevice}, for hit-testing against a layer's own marks. */
  toSpace(x: number, y: number, space?: LayerSpace): { x: number; y: number };
}

/** A caller's per-frame paint callback. */
export type LayerDraw = (c: ChartDrawContext) => void;

export interface LayerOptions {
  /** Stable id; adding a layer with an existing id replaces it. */
  id?: string;
  /** Paint order among layers, low to high. Default `0`. */
  z?: number;
  /** Start hidden. Default `true` (visible). */
  visible?: boolean;
}

/** Handle to a registered layer. */
export interface ChartLayer {
  readonly id: string;
  z: number;
  visible: boolean;
  /** Swap the paint callback, keeping id and order. */
  setDraw(draw: LayerDraw): void;
  /** Detach the layer; it stops painting from the next frame. */
  remove(): void;
}

// --- declarative elements ---------------------------------------------------

/** Styling shared by every element kind. */
export interface ElementStyle {
  /** Stroke color, any CSS color. Omit for no stroke. */
  stroke?: string;
  /** Fill color, any CSS color. Omit for no fill. */
  fill?: string;
  /** Stroke width in CSS px. Default `1`. */
  lineWidth?: number;
  /** Dash pattern in CSS px, e.g. `[4, 4]`. */
  lineDash?: number[];
  /** Global alpha in `[0,1]`. Default `1`. */
  opacity?: number;
}

interface ElementBase extends ElementStyle, LayerOptions {
  /** Coordinate system for this element's numbers. Default `'data'`. */
  space?: LayerSpace;
}

export interface LineElement extends ElementBase {
  kind: 'line';
  from: [number, number];
  to: [number, number];
}

export interface RectElement extends ElementBase {
  kind: 'rect';
  /** Lower-left corner in `'data'`/`'plot'`; top-left in `'canvas'`. */
  at: [number, number];
  width: number;
  height: number;
  /** Corner radius in CSS px. Default `0`. */
  radius?: number;
}

export interface CircleElement extends ElementBase {
  kind: 'circle';
  center: [number, number];
  /** Radius in **CSS px** — a data-space radius would go elliptical under a
   *  non-uniform zoom, which is never what a callout dot wants. */
  radius: number;
}

export interface TextElement extends ElementBase {
  kind: 'text';
  at: [number, number];
  text: string;
  /** CSS font shorthand, sized in CSS px. Default `'12px system-ui'`. */
  font?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
}

export interface PathElement extends ElementBase {
  kind: 'path';
  points: [number, number][];
  closed?: boolean;
}

/** A declarative annotation — sugar over {@link LayerDraw}. */
export type ChartElement = LineElement | RectElement | CircleElement | TextElement | PathElement;

/** Paint one declarative element into `c`. */
export function drawElement(c: ChartDrawContext, el: ChartElement): void {
  const { ctx, dpr } = c;
  const space = el.space ?? 'data';
  const at = (p: [number, number]) => c.toDevice(p[0], p[1], space);

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.lineWidth = (el.lineWidth ?? 1) * dpr;
  if (el.lineDash) ctx.setLineDash(el.lineDash.map((d) => d * dpr));
  if (el.stroke) ctx.strokeStyle = el.stroke;
  if (el.fill) ctx.fillStyle = el.fill;

  switch (el.kind) {
    case 'line': {
      const a = at(el.from);
      const b = at(el.to);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (el.stroke) ctx.stroke();
      break;
    }
    case 'rect': {
      // Take both corners through the projection rather than scaling the size:
      // width/height in data space are not a fixed number of px once zoomed.
      const p0 = at(el.at);
      const p1 = at([el.at[0] + el.width, el.at[1] + el.height]);
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x);
      const h = Math.abs(p1.y - p0.y);
      const r = Math.min((el.radius ?? 0) * dpr, w / 2, h / 2);
      ctx.beginPath();
      if (r > 0) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
      if (el.fill) ctx.fill();
      if (el.stroke) ctx.stroke();
      break;
    }
    case 'circle': {
      const p = at(el.center);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0, el.radius * dpr), 0, Math.PI * 2);
      if (el.fill) ctx.fill();
      if (el.stroke) ctx.stroke();
      break;
    }
    case 'text': {
      const p = at(el.at);
      ctx.font = scaleFont(el.font ?? '12px system-ui', dpr);
      ctx.textAlign = el.align ?? 'left';
      ctx.textBaseline = el.baseline ?? 'alphabetic';
      if (el.fill) ctx.fillText(el.text, p.x, p.y);
      if (el.stroke) ctx.strokeText(el.text, p.x, p.y);
      break;
    }
    case 'path': {
      if (el.points.length === 0) break;
      ctx.beginPath();
      for (let i = 0; i < el.points.length; i++) {
        const p = at(el.points[i]!);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      if (el.closed) ctx.closePath();
      if (el.fill) ctx.fill();
      if (el.stroke) ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * Scale a CSS font shorthand's px size to device px, so `'12px system-ui'`
 * reads as 12 CSS px on a retina canvas rather than half that.
 */
function scaleFont(font: string, dpr: number): string {
  if (dpr === 1) return font;
  return font.replace(/(\d*\.?\d+)px/, (_, n: string) => `${Number(n) * dpr}px`);
}

// --- stack ------------------------------------------------------------------

interface Entry {
  id: string;
  z: number;
  visible: boolean;
  draw: LayerDraw;
  /** Insertion order, to keep equal-`z` layers stable under sorting. */
  seq: number;
}

/**
 * Ordered set of layers, painted low `z` first. Owns nothing about the canvas
 * — {@link ChartKernel} supplies the context — so it is straightforward to test
 * against a stub 2D context.
 */
export class LayerStack {
  private entries: Entry[] = [];
  private seq = 0;
  private autoId = 0;

  add(draw: LayerDraw, opts: LayerOptions = {}): ChartLayer {
    const id = opts.id ?? `layer-${++this.autoId}`;
    const existing = this.entries.findIndex((e) => e.id === id);
    const entry: Entry = {
      id,
      z: opts.z ?? 0,
      visible: opts.visible ?? true,
      draw,
      seq: this.seq++,
    };
    if (existing >= 0) this.entries[existing] = entry;
    else this.entries.push(entry);

    const stack = this;
    return {
      id,
      get z() {
        return entry.z;
      },
      set z(v: number) {
        entry.z = v;
      },
      get visible() {
        return entry.visible;
      },
      set visible(v: boolean) {
        entry.visible = v;
      },
      setDraw(next: LayerDraw) {
        entry.draw = next;
      },
      remove() {
        stack.entries = stack.entries.filter((e) => e !== entry);
      },
    };
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }

  /** Paint every visible layer in order. */
  paint(c: ChartDrawContext): void {
    const ordered = [...this.entries].sort((a, b) => a.z - b.z || a.seq - b.seq);
    for (const e of ordered) {
      if (!e.visible) continue;
      e.draw(c);
    }
  }
}
