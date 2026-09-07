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
  /**
   * Layout this demo opens in before the user has ever touched the layout
   * toggle themselves. Default `'tb'`. Once touched, the toggle's choice is a
   * global preference (see `chrome.ts`) and this stops applying.
   */
  preferredLayout?: 'tb' | 'lr';
}

import { barChartDemo } from './barchart.demo.js';
import { candlestickChartDemo } from './candlestickchart.demo.js';
import { lineChartDemo } from './linechart.demo.js';
import { pieChartDemo } from './piechart.demo.js';
import { scatterChartDemo } from './scatterchart.demo.js';
import { windRoseChartDemo } from './windrosechart.demo.js';

export const COMPONENTS: DemoComponent[] = [
  barChartDemo,
  lineChartDemo,
  pieChartDemo,
  scatterChartDemo,
  windRoseChartDemo,
  candlestickChartDemo,
  { id: 'area', label: 'Area chart', disabled: true, mount() {}, unmount() {} },
];
