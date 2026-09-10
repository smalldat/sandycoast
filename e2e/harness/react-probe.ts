/**
 * Test probe published on `window.__scReact` once the React-bound chart
 * reports ready. Shared ambient declaration for `react-main.ts` (source) and
 * `react-main.dist.ts` (packaged) — see `boot.ts`'s `window.__sc` for the
 * non-React equivalent.
 */
export interface ReactProbe {
  ready: boolean;
  backend: string | null;
}

declare global {
  interface Window {
    __scReact?: ReactProbe;
  }
}
