import { barBasic } from './bar-basic.scenario.js';
import { barLegendDim } from './bar-legend-dim.scenario.js';
import { lineBasic } from './line-basic.scenario.js';
import { lineStack } from './line-stack.scenario.js';
import { pieBasic } from './pie-basic.scenario.js';
import type { Scenario } from './types.js';

/** Every scenario, keyed by id. Adding a chart = adding one file here. */
export const SCENARIOS: Record<string, Scenario> = {
  [barBasic.id]: barBasic,
  [barLegendDim.id]: barLegendDim,
  [lineBasic.id]: lineBasic,
  [lineStack.id]: lineStack,
  [pieBasic.id]: pieBasic,
};

export const SCENARIO_LIST: Scenario[] = Object.values(SCENARIOS);
