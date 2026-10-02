/**
 * Test probe published on `window.__scReact` once the React-bound chart
 * reports ready. Shared ambient declaration for `react-main.ts` (source) and
 * `react-main.dist.ts` (packaged) — see `boot.ts`'s `window.__sc` for the
 * non-React equivalent.
 */
export interface ReactProbe {
  ready: boolean;
  backend: string | null;
  /** How many times the wind rose's `onHighlight` prop has fired. */
  highlights: number;
  /** Marks delivered to the bar chart's `onClick` prop, newest last. */
  clicks: (string | null)[];
  /** Painted share of the bar chart's layer canvas; -1 when unreadable. */
  layerInk?: () => number;
}

declare global {
  interface Window {
    __scReact?: ReactProbe;
  }
}
