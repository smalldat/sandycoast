import { barBasic } from './bar-basic.scenario.js';
import { lineStack } from './line-stack.scenario.js';
import type { Scenario } from './types.js';

/** Every scenario, keyed by id. Adding a chart = adding one file here. */
export const SCENARIOS: Record<string, Scenario> = {
  [barBasic.id]: barBasic,
  [lineStack.id]: lineStack,
};

export const SCENARIO_LIST: Scenario[] = Object.values(SCENARIOS);
