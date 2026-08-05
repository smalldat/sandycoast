import { type Easing, ease } from '../particles/anim.js';

/**
 * Reveal factor in [0,1] at time `now` (seconds). 0 before `start`, eased ramp
 * across `duration` seconds, 1 after. Drives both the grain fade-out and the
 * solid layer's fade-in for every visual. `duration <= 0` snaps to a step at
 * `start`.
 */
export function revealFactor(now: number, start: number, duration: number, easing: Easing): number {
  if (now <= start) return 0;
  if (duration <= 0) return 1;
  const p = (now - start) / duration;
  return ease(p, easing);
}

export interface ResolvedFill {
  on: boolean;
  opacity: number;
}

export interface ResolvedReveal {
  /** Fade start: 'afterPour' or absolute seconds from animation start. */
  start: 'afterPour' | number;
  /** Fade window in seconds. */
  duration: number;
  ease: Easing;
  /** Grain end-opacity in [0,1]. */
  grainsTo: number;
}

/** Shape of the `reveal` config block, identical across visuals. */
export interface RevealConfig {
  /**
   * When the fade begins. `'afterPour'` = once pour+settle finishes
   * (animation duration + stagger). A number = absolute seconds from start.
   * Default `'afterPour'`.
   */
  start?: 'afterPour' | number;
  /** Fade window length in ms. Default 500. */
  duration?: number;
  /** Fade easing. Default 'easeOutCubic'. */
  ease?: Easing;
  /** Grain end-opacity 0..1 (0 = disappear). Default 0. */
  grainsTo?: number;
}

/** Resolve a `reveal` block (ms → seconds) with the shared defaults. */
export function resolveReveal(cfg: RevealConfig | undefined): ResolvedReveal {
  return {
    start: cfg?.start ?? 'afterPour',
    duration: (cfg?.duration ?? 500) / 1000,
    ease: cfg?.ease ?? 'easeOutCubic',
    grainsTo: cfg?.grainsTo ?? 0,
  };
}
