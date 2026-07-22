/**
 * Grain buffer (Structure-of-Arrays). All coordinates are in normalized
 * layout space `[0, 1]` with the origin at bottom-left and +y up.
 *
 * The buffer is uploaded to the GPU once (or on data change); per-frame the
 * shader derives each grain's live position from these fields plus a `now`
 * uniform — no per-grain CPU work in steady state.
 */
export interface GrainBuffer {
  count: number;
  startX: Float32Array;
  startY: Float32Array;
  targetX: Float32Array;
  targetY: Float32Array;
  /** Animation start delay per grain, seconds. */
  delay: Float32Array;
  /** Per-grain random seed in [0,1) for shader-side jitter. */
  seed: Float32Array;
  /** Series/color index (into the palette). */
  colorIdx: Uint16Array;
  /** Bar id for hover hit-testing / highlight. */
  barId: Uint16Array;
}

export function allocGrains(count: number): GrainBuffer {
  return {
    count,
    startX: new Float32Array(count),
    startY: new Float32Array(count),
    targetX: new Float32Array(count),
    targetY: new Float32Array(count),
    delay: new Float32Array(count),
    seed: new Float32Array(count),
    colorIdx: new Uint16Array(count),
    barId: new Uint16Array(count),
  };
}
