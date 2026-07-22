import type { FpsConfig, Side } from './types.js';

/** Default subdued readout color (legible on dark backgrounds). */
const FPS_COLOR = 'rgba(232,236,242,0.95)';
/** Repaint interval in ms — the DOM text updates a few times a second, not every frame. */
const PAINT_MS = 250;
/** EMA smoothing factor; higher = steadier, slower to react. */
const SMOOTH = 0.9;

export interface ResolvedFps {
  /** Whether the meter is drawn. */
  show: boolean;
  /** Edge/corner to pin to (meaningful only when `show`). */
  position: Side;
  /** Text color (CSS). */
  color: string;
}

/** Resolve the `fps` config block into concrete values. `'off'` disables it. */
export function resolveFps(cfg: { fps?: FpsConfig }): ResolvedFps {
  const position = cfg.fps?.position ?? 'off';
  return {
    show: position !== 'off',
    position: position === 'off' ? 'top' : position,
    color: cfg.fps?.color ?? FPS_COLOR,
  };
}

/**
 * Frames-per-second badge. A small absolutely-positioned `<div>` overlaid on the
 * chart element, fed one frame delta per animation tick. Kept off the overlay
 * canvas on purpose: that canvas only redraws on reveal/hover/resize, and a
 * per-frame clear + axis repaint just to show FPS would defeat the point of the
 * measurement. The DOM text is repainted at most every {@link PAINT_MS} ms.
 */
export class FpsMeter {
  private el: HTMLDivElement;
  /** Exponential moving average of instantaneous FPS (0 until first sample). */
  private ema = 0;
  /** Timestamp (ms) of the last text repaint. */
  private lastPaint = 0;

  constructor(parent: HTMLElement, position: Side, color: string) {
    const el = document.createElement('div');
    const s = el.style;
    s.position = 'absolute';
    s.zIndex = '2';
    s.pointerEvents = 'none';
    s.font = '11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    s.color = color;
    s.background = 'rgba(16,20,28,0.62)';
    s.border = '1px solid rgba(205,211,222,0.18)';
    s.padding = '3px 7px';
    s.borderRadius = '6px';
    s.lineHeight = '1';
    s.whiteSpace = 'nowrap';
    applyPosition(s, position);
    el.textContent = '– FPS';
    parent.appendChild(el);
    this.el = el;
  }

  /**
   * Feed one frame. `dtSeconds` is the delta since the previous frame; `nowMs`
   * is `performance.now()`. Updates the smoothed average every frame but only
   * repaints the DOM text on the throttle interval.
   */
  sample(dtSeconds: number, nowMs: number): void {
    if (dtSeconds > 0) {
      const fps = 1 / dtSeconds;
      this.ema = this.ema > 0 ? this.ema * SMOOTH + fps * (1 - SMOOTH) : fps;
    }
    if (nowMs - this.lastPaint >= PAINT_MS && this.ema > 0) {
      this.lastPaint = nowMs;
      this.el.textContent = `${Math.round(this.ema)} FPS`;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}

/** Pin the badge to the requested edge; left/right go to the top corner. */
function applyPosition(s: CSSStyleDeclaration, position: Side): void {
  switch (position) {
    case 'left':
      s.top = '4px';
      s.left = '4px';
      break;
    case 'right':
      s.top = '4px';
      s.right = '4px';
      break;
    case 'bottom':
      s.bottom = '4px';
      s.left = '50%';
      s.transform = 'translateX(-50%)';
      break;
    default: // 'top'
      s.top = '4px';
      s.left = '50%';
      s.transform = 'translateX(-50%)';
      break;
  }
}
