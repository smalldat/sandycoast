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
  /**
   * Per-bar dim weight in [0,1] (index = barId), eased for smooth enter/leave —
   * independent of {@link hoverWeights}, so isolating a series via the legend
   * composes with hover rather than replacing it. `1` = fully dimmed.
   */
  dimWeights: Float32Array;
  /**
   * Alpha multiplier for a fully-dimmed grain (`dimWeights` = 1), lerped from
   * `1` at weight `0`. `-1` disables the effect entirely (alpha unaffected
   * regardless of `dimWeights`), the same sentinel convention as
   * {@link hoverOpacity}.
   */
  dimOpacity: number;
  /**
   * Per-bar emphasis weight in [0,1] (index = barId): **brightness only** — no
   * jitter, no opacity change.
   *
   * Separate from {@link hoverWeights} because that channel also drives
   * {@link hoverJitterAmp}, and a *persistent* emphasis (the wind rose's
   * latest-reading glow) would then shimmer forever. Hover is transient, so its
   * shimmer reads as a cursor; a permanent one just reads as noise. The two
   * compose: gains add, so hovering an emphasised mark is brighter still.
   * Omitted (or an empty array) = no effect.
   */
  emphasisWeights?: Float32Array;
  /** Color multiplier for a fully-emphasised grain. Default `1` (no effect). */
  emphasisGain?: number;
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
  /**
   * Pan/zoom transform applied to layout coords before the plot mapping:
   * `p' = p * viewScale + viewOffset`. Default `[1,1]` / `[0,0]` (identity).
   */
  viewScale?: [number, number];
  viewOffset?: [number, number];
  /**
   * Clip grains to the plot rect (scissor). Enabled with pan/zoom so panned
   * content never spills into the axis/legend gutters. Default `false` so the
   * pour-in from above the plot stays visible when pan/zoom is off.
   */
  clipToPlot?: boolean;
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
