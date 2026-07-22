import { Canvas2DRenderer } from './canvas2d/renderer.js';
import type { BackendKind, Renderer } from './types.js';
import { WebGPURenderer } from './webgpu/renderer.js';

export type BackendPreference = BackendKind | 'auto';

/**
 * Pick a rendering backend. `auto` prefers WebGPU, falls back to Canvas2D.
 *
 * WebGL2 is a planned intermediate fallback (milestone M6); until it lands
 * `auto` skips straight to Canvas2D when WebGPU is unavailable.
 */
export async function pickRenderer(pref: BackendPreference = 'auto'): Promise<Renderer> {
  if (pref === 'canvas2d') return new Canvas2DRenderer();
  if (pref === 'webgpu') return new WebGPURenderer();

  if (await WebGPURenderer.isSupported()) return new WebGPURenderer();
  if (Canvas2DRenderer.isSupported()) return new Canvas2DRenderer();
  throw new Error('No supported rendering backend found');
}
