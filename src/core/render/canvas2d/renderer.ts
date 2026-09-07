import { evalGrain } from '../../particles/anim.js';
import type { GrainBuffer } from '../../particles/grains.js';
import type { BackendKind, FrameUniforms, RGBA, Renderer } from '../types.js';

const tmp = { x: 0, y: 0 };

function rgbaCss(c: RGBA, gain = 1, fade = 1): string {
  const r = Math.round(Math.min(1, c[0] * gain) * 255);
  const g = Math.round(Math.min(1, c[1] * gain) * 255);
  const b = Math.round(Math.min(1, c[2] * gain) * 255);
  return `rgba(${r},${g},${b},${c[3] * fade})`;
}

/**
 * Canvas2D fallback. Correct on every browser but CPU-bound — the Chart caps
 * grain count for this backend. Mirrors the GPU lerp+jitter via {@link evalGrain}.
 */
export class Canvas2DRenderer implements Renderer {
  readonly kind: BackendKind = 'canvas2d';
  private ctx!: CanvasRenderingContext2D;
  private grains: GrainBuffer | null = null;
  private w = 0;
  private h = 0;

  static isSupported(): boolean {
    return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d');
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D context unavailable');
    this.ctx = ctx;
    this.w = canvas.width;
    this.h = canvas.height;
  }

  upload(grains: GrainBuffer): void {
    this.grains = grains;
  }

  resize(widthPx: number, heightPx: number): void {
    this.w = widthPx;
    this.h = heightPx;
  }

  frame(u: FrameUniforms): void {
    const g = this.grains;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = rgbaCss(u.background);
    ctx.fillRect(0, 0, this.w, this.h);
    if (!g) return;

    const size = u.grainSizePx;
    const half = size / 2;
    const fade = u.grainFade;
    const opOn = u.hoverOpacity >= 0;
    // Hovered grains can lift their opacity above the base fade, so don't bail
    // on a fully-faded steady state when the opacity effect is armed.
    if (fade <= 0 && !opOn) return; // grains fully faded out; nothing to draw
    const weights = u.hoverWeights;
    const [px0, py0, px1, py1] = u.plotRect;
    const pw = px1 - px0;
    const ph = py1 - py0;
    const vsx = u.viewScale?.[0] ?? 1;
    const vsy = u.viewScale?.[1] ?? 1;
    const vox = u.viewOffset?.[0] ?? 0;
    const voy = u.viewOffset?.[1] ?? 0;
    // Clip grains to the plot rect under pan/zoom (mirrors the GPU scissor).
    if (u.clipToPlot) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px0 * this.w, (1 - py1) * this.h, pw * this.w, ph * this.h);
      ctx.clip();
    }
    const dimW = u.dimWeights;
    const dimOn = u.dimOpacity >= 0;
    // Emphasis brightens without jittering — see FrameUniforms.emphasisWeights.
    const emphW = u.emphasisWeights;
    const emphGain = u.emphasisGain ?? 1;
    const emphOn = !!emphW && emphW.length > 0 && emphGain !== 1;
    // Group draws by color to cut fillStyle churn; hovered/dimmed grains
    // (weight>0) fall out of the group with a per-grain (eased) style.
    for (let ci = 0; ci < u.palette.length; ci++) {
      const color = u.palette[ci]!;
      let plainSet = false;
      for (let i = 0; i < g.count; i++) {
        if (g.colorIdx[i] !== ci) continue;
        const barId = g.barId[i]!;
        const w = weights[barId] ?? 0;
        const dw = dimW[barId] ?? 0;
        const ew = emphOn ? (emphW![barId] ?? 0) : 0;
        evalGrain(g, i, u.now, u.duration, u.easing, u.settleJitterAmp, tmp);
        // Hover jitter, matching the GPU: settle-independent, and left in layout
        // space so it scales with zoom along with the rest of the geometry.
        let jx = tmp.x;
        let jy = tmp.y;
        if (w > 0 && u.hoverJitterAmp > 0) {
          const s = g.seed[i]!;
          const hAmp = u.hoverJitterAmp * w;
          jx += Math.sin(u.now * 9.0 + s * 220.0) * hAmp;
          jy += Math.cos(u.now * 8.3 + s * 190.0) * hAmp;
        }
        // layout [0,1] y-up -> pan/zoom -> plot rect -> device px (y-down)
        const vx = jx * vsx + vox;
        const vy = jy * vsy + voy;
        const px = (px0 + vx * pw) * this.w;
        const py = (1 - (py0 + vy * ph)) * this.h;

        const dimMul = dimOn ? 1 + (Math.max(u.dimOpacity, 0) - 1) * dw : 1;
        if (w > 0.001 || dw > 0.001 || ew > 0.001) {
          const alpha = (opOn ? fade + (u.hoverOpacity - fade) * w : fade) * dimMul;
          // Hover and emphasis gains add, so hovering an emphasised mark reads
          // brighter still rather than the two overwriting each other.
          const gain = 1 + (u.highlightGain - 1) * w + (emphGain - 1) * ew;
          ctx.fillStyle = rgbaCss(color, gain, alpha);
          plainSet = false;
        } else if (!plainSet) {
          ctx.fillStyle = rgbaCss(color, 1, fade);
          plainSet = true;
        }
        // Faded, un-hovered, un-dimmed and un-emphasised → nothing to draw.
        if (fade <= 0 && !(w > 0.001) && !(dw > 0.001) && !(ew > 0.001)) continue;

        if (u.grainShape === 'disc') {
          ctx.beginPath();
          ctx.arc(px, py, half, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(px - half, py - half, size, size);
        }
      }
    }
    if (u.clipToPlot) ctx.restore();
  }

  dispose(): void {
    this.grains = null;
  }
}
