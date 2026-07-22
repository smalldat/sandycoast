import type { Easing } from '../particles/anim.js';
import type { GrainBuffer } from '../particles/grains.js';

export type GrainShape = 'quad' | 'disc';

/** RGBA in 0..1. */
export type RGBA = [number, number, number, number];

/** Per-frame state driving the shader; cheap to update each rAF tick. */
export interface FrameUniforms {
  /** Seconds since animation start. */
  now: number;
  /** Total per-grain animation duration, seconds. */
  duration: number;
  easing: Easing;
  /** Grain size in device pixels. */
  grainSizePx: number;
  grainShape: GrainShape;
  /** Palette, one RGBA per series/color index. */
  palette: RGBA[];
  /** Device-pixel viewport [w, h]. */
  viewport: [number, number];
  /** Per-bar hover weight in [0,1] (index = barId), eased for smooth enter/leave. */
  hoverWeights: Float32Array;
  /** Multiply color of hovered grains at full weight (highlight effect). */
  highlightGain: number;
  /** Extra noisy motion amplitude for hovered grains (layout units). */
  hoverJitterAmp: number;
  /**
   * Target opacity for hovered grains at full weight (opacity effect): hovered
   * grains lerp their alpha from {@link grainFade} up to this as their hover
   * weight rises, so they pop even after the reveal has faded the sand. `-1`
   * disables the effect (alpha stays at `grainFade`).
   */
  hoverOpacity: number;
  /** Baseline settle jitter amplitude (layout units). */
  settleJitterAmp: number;
  /** Background clear color. */
  background: RGBA;
  /**
   * Global grain opacity multiplier in [0,1]. 1 = fully opaque (default), 0 =
   * grains invisible. Drives the particle fade-out during the bar reveal.
   */
  grainFade: number;
  /**
   * Inset rectangle the layout `[0,1]` box maps into, normalized `[x0,y0,x1,y1]`
   * with y-up (y0 = bottom). Default `[0,0,1,1]` = fill the whole viewport (v0).
   * Gutters here make room for axes/labels/legend drawn on the overlay.
   */
  plotRect: [number, number, number, number];
}

export type BackendKind = 'webgpu' | 'webgl2' | 'canvas2d';

/** Rendering backend contract. All backends implement the same lerp+jitter. */
export interface Renderer {
  readonly kind: BackendKind;
  init(canvas: HTMLCanvasElement): Promise<void>;
  /** Upload grain buffer to the GPU (once, or on data change). */
  upload(grains: GrainBuffer): void;
  /** Draw one frame. */
  frame(u: FrameUniforms): void;
  resize(widthPx: number, heightPx: number): void;
  dispose(): void;
}
