// WGSL source for the sand renderer. Kept as a TS string so the bundler inlines
// it (no asset loader / fetch needed in the published package).
export const SAND_WGSL = /* wgsl */ `
struct Uniforms {
  // now, duration, grainSizePx, easingKind
  a : vec4<f32>,
  // viewport.x, viewport.y, shapeKind, grainFade
  b : vec4<f32>,
  // highlightGain, hoverJitterAmp, settleJitterAmp, paletteCount
  c : vec4<f32>,
  background : vec4<f32>,
  // plot rect the layout box maps into: x0, y0, x1, y1 (normalized, y-up)
  plot : vec4<f32>,
  // hoverOpacity (<0 = disabled), reserved, reserved, reserved
  d : vec4<f32>,
  // pan/zoom: scaleX, scaleY, offsetX, offsetY (layout space)
  view : vec4<f32>,
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> palette : array<vec4<f32>>;
// Per-bar hover weight in [0,1]; eased on the CPU for smooth enter/leave.
@group(0) @binding(2) var<storage, read> hoverW : array<f32>;

struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) color : vec4<f32>,
};

fn easeApply(t : f32, kind : f32) -> f32 {
  let x = clamp(t, 0.0, 1.0);
  if (kind < 0.5) { return x; }                 // linear
  if (kind < 1.5) { return 1.0 - pow(1.0 - x, 3.0); } // easeOutCubic
  return 1.0 - pow(1.0 - x, 5.0);               // easeOutQuint
}

@vertex
fn vs(
  @location(0) corner : vec2<f32>,   // quad corner in [-1,1]
  @location(1) start : vec2<f32>,
  @location(2) dst : vec2<f32>,
  @location(3) md : vec2<f32>,       // delay, seed
  @location(4) ids : vec2<f32>,      // colorIdx, barId
) -> VsOut {
  let now = U.a.x;
  let duration = U.a.y;
  let grainPx = U.a.z;
  let easingKind = U.a.w;
  let viewport = U.b.xy;
  let seed = md.y;
  let hw = hoverW[u32(ids.y)];

  let t = (now - md.x) / duration;
  let te = easeApply(t, easingKind);
  let settle = 1.0 - te;

  var p = mix(start, dst, te);

  // Settle wobble that fades as the grain arrives.
  let baseAmp = U.c.z;
  p.x += sin((now + seed * 6.283) * 3.0 + seed * 100.0) * baseAmp * settle;
  p.y += cos((now + seed * 6.283) * 3.3 + seed * 55.0) * baseAmp * settle;

  // Hover jitter: extra motion scaled by the (smoothly eased) hover weight.
  // Amplitude is layout-space, so it rides U.view.xy below and grows with zoom
  // — the shimmer stays the same size relative to the bar/line you zoomed into
  // rather than shrinking to a few fixed pixels.
  let hAmp = U.c.y * hw;
  p.x += sin(now * 9.0 + seed * 220.0) * hAmp;
  p.y += cos(now * 8.3 + seed * 190.0) * hAmp;

  // Pan/zoom in layout space, then Layout [0,1] (y up) -> plot rect -> clip.
  let pv = p * U.view.xy + U.view.zw;
  let plotOrigin = U.plot.xy;
  let plotSize = U.plot.zw - U.plot.xy;
  let inPlot = plotOrigin + pv * plotSize;
  let clip = vec2<f32>(inPlot.x * 2.0 - 1.0, inPlot.y * 2.0 - 1.0);
  // Corner offset in device px -> clip.
  let offset = corner * (grainPx / viewport) ;

  var vo : VsOut;
  vo.pos = vec4<f32>(clip + offset, 0.0, 1.0);
  vo.uv = corner;

  let count = U.c.w;
  let idx = clamp(ids.x, 0.0, max(0.0, count - 1.0));
  let base = palette[u32(idx)];
  // Highlight lerps from 1x to highlightGain by the hover weight.
  let gain = mix(1.0, U.c.x, hw);
  let grainFade = U.b.w;
  // Opacity effect: hovered grains lerp alpha up to hoverOpacity (U.d.x); a
  // negative value disables it so alpha stays at grainFade.
  let hoverOpacity = U.d.x;
  let opOn = select(0.0, 1.0, hoverOpacity >= 0.0);
  let alpha = mix(grainFade, max(hoverOpacity, 0.0), hw * opOn);
  vo.color = vec4<f32>(base.rgb * gain, base.a * alpha);
  return vo;
}

@fragment
fn fs(frag : VsOut) -> @location(0) vec4<f32> {
  let shapeKind = U.b.z;
  if (shapeKind > 0.5) {
    // disc: discard outside unit circle
    if (dot(frag.uv, frag.uv) > 1.0) { discard; }
  }
  return frag.color;
}
`;
