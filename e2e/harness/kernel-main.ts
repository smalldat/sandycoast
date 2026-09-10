import { BarChart } from '../../src/index.js';
import { FIVE_BARS } from '../scenarios/data.js';

/**
 * Harness for the chart kernel: the cancellable events and drawing layers in
 * `core/chart/`. Deliberately not a scenario — the scenario runner drives
 * chart *behavior*, whereas what is under test here is the API surface every
 * chart inherits, so it runs one scripted sequence and publishes the outcome.
 */
export interface KernelProbe {
  ready: boolean;
  /** Outcome of each scripted check, asserted one by one in the spec. */
  checks: Record<string, unknown>;
  /** `click` events recorded from real pointer input driven by the spec. */
  clicks: { meta: string | null; button: number }[];
  /** Painted fraction of the topmost (layer) canvas. */
  layerInk(): number;
  /** Undo the scripted pan/zoom, so hit-tests use the plain layout positions. */
  resetView(): void;
}

declare global {
  interface Window {
    __scKernel?: KernelProbe;
  }
}

const host = document.querySelector<HTMLElement>('#host');
if (!host) throw new Error('no #host');

const chart = new BarChart(host, {
  data: { points: FIVE_BARS },
  grainDensity: 0.6,
  colors: ['#e8b96a'],
  fps: { position: 'off' },
  panZoom: { enabled: true, controls: { show: false } },
  backend: 'canvas2d',
});

await chart.whenReady();

const checks: Record<string, unknown> = {};
const clicks: { meta: string | null; button: number }[] = [];

chart.on('click', (e) => {
  clicks.push({ meta: e.meta ? String(e.meta.xValue) : null, button: e.button });
});

// --- drawing layers -------------------------------------------------------
// A declarative element in data space plus a raw layer, so both entry points
// are exercised against a real canvas.
chart.addElement({
  kind: 'line',
  from: [0, 0.5],
  to: [1, 0.5],
  stroke: '#ff3b6b',
  lineWidth: 3,
});
chart.addLayer((c) => {
  const p = c.toDevice(0.5, 0.75);
  c.ctx.fillStyle = '#38bdf8';
  c.ctx.fillRect(p.x - 40, p.y - 40, 80, 80);
});
checks.layerCount = chart.getLayerCount();

// --- cancellable data events ----------------------------------------------
const offAdd = chart.on('dataAdd', (e) => e.preventDefault());
const before = chart.getData().points.length;
chart.add({ x: 'F', y: 42 });
checks.pointsAfterCancelledAdd = chart.getData().points.length;
checks.pointsBefore = before;
offAdd();
chart.add({ x: 'F', y: 42 });
checks.pointsAfterAllowedAdd = chart.getData().points.length;

// The payload must describe the pending change, not the applied one.
let addPayload: unknown = null;
const offPayload = chart.on('dataAdd', (e) => {
  addPayload = { action: e.action, items: e.items.length, cancelable: e.cancelable };
});
chart.add({ x: 'G', y: 10 });
offPayload();
checks.addPayload = addPayload;

// --- cancellable zoom ------------------------------------------------------
const offZoom = chart.on('zoom', (e) => e.preventDefault());
chart.zoomBy(2);
checks.scaleAfterCancelledZoom = chart.getView().scale[0];
offZoom();
chart.zoomBy(2);
checks.scaleAfterAllowedZoom = chart.getView().scale[0];

// --- cancellable pan -------------------------------------------------------
const offPan = chart.on('pan', (e) => e.preventDefault());
const offsetBefore = chart.getView().offset[0];
chart.panBy(-0.2, 0);
checks.offsetAfterCancelledPan = chart.getView().offset[0] === offsetBefore;
offPan();
chart.panBy(-0.2, 0);
checks.offsetMovedAfterAllowedPan = chart.getView().offset[0] !== offsetBefore;

// --- drawFinished ----------------------------------------------------------
let frames = 0;
let lastFrameNumber = 0;
chart.on('drawFinished', (e) => {
  frames++;
  lastFrameNumber = e.frame;
});
// Give the RAF loop a few frames before the spec reads the counter.
await new Promise<void>((resolve) => setTimeout(resolve, 200));
checks.drawFinishedFired = frames > 0;
checks.frameCounterAdvances = lastFrameNumber >= frames;

window.__scKernel = {
  ready: true,
  checks,
  clicks,
  layerInk(): number {
    // The layer canvas is the last one the kernel appended to the host.
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('#host canvas')];
    const c = canvases[canvases.length - 1];
    if (!c) return -1;
    const ctx = c.getContext('2d');
    if (!ctx) return -1;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) painted++;
    return painted / (c.width * c.height);
  },
  resetView(): void {
    chart.resetView();
  },
};
