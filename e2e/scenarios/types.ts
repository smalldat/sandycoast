// Scenario model. These files are imported by BOTH the browser harness and the
// Node-side specs, so they must stay free of any runtime import from `src/` —
// type-only imports are fine (they are erased). Chart construction lives in
// `harness/charts.ts` instead, keyed by `Scenario.chart`.

/** Which chart factory the harness should use for this scenario. */
export type ChartKind = 'bar' | 'line' | 'pie';

/** One scripted action against the mounted chart. */
export type Act =
  /**
   * Move the pointer to a fraction of the chart host box, origin top-left.
   * Fractions (not pixels) so a host resize doesn't invalidate scenarios.
   */
  | { kind: 'hoverFrac'; x: number; y: number }
  /** Move the pointer off the chart entirely. */
  | { kind: 'leave' }
  /** Advance the fake clock, running the animation frames it covers. */
  | { kind: 'advance'; ms: number }
  /** Click the nth legend entry (DOM order) — requires `legend.interactive`. */
  | { kind: 'clickLegend'; index: number };

/** Assertions checked after an action. All fields are optional. */
export interface Expectation {
  /**
   * The most recent event of `type` must exist and match `payload` as a deep
   * subset (`payload: null` asserts the event carried a null payload — e.g. a
   * hover that left every bar).
   */
  event?: { type: string; payload: Record<string, unknown> | null };
  /** No event of this type may have fired since the previous step. */
  noEvent?: string;
  /** Minimum fraction of painted (non-transparent) pixels on the chart canvas. */
  minInk?: number;
}

export interface Step {
  name: string;
  act: Act;
  expect?: Expectation;
}

export interface Scenario {
  id: string;
  chart: ChartKind;
  /** Chart config, minus `backend` — the test project supplies that. */
  config: Record<string, unknown>;
  /**
   * Fake-clock time to run before the scripted steps, in ms. Must exceed the
   * pour animation (`duration + stagger`, 1400 ms by default) for the chart to
   * be in its settled state.
   */
  settleMs: number;
  steps: Step[];
}

/** Event captured by the harness probe. */
export interface ProbeEvent {
  type: string;
  payload: unknown;
}
