// Component registry drives the left nav. Only the bar chart is live today;
// future components register here and light up automatically.

export interface DemoComponent {
  id: string;
  label: string;
  /** Mount the demo into `host` (chart column) and `panel` (right controls). */
  mount(host: HTMLElement, panel: HTMLElement): void;
  /** Tear down: dispose chart, clear listeners. */
  unmount(): void;
  /** Present but not yet implemented — shown grayed in the nav. */
  disabled?: boolean;
}

import { barChartDemo } from './barchart.demo.js';
import { lineChartDemo } from './linechart.demo.js';
import { pieChartDemo } from './piechart.demo.js';
import { scatterChartDemo } from './scatterchart.demo.js';

export const COMPONENTS: DemoComponent[] = [
  barChartDemo,
  lineChartDemo,
  pieChartDemo,
  scatterChartDemo,
  { id: 'area', label: 'Area chart', disabled: true, mount() {}, unmount() {} },
];
