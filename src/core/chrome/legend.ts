import type { RGBA } from '../render/types.js';
import type { ResolvedLegend } from './chrome.js';

export interface LegendEntry {
  label: string;
  color: RGBA;
}

function rgbaCss(c: RGBA): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;
}

const ALIGN: Record<ResolvedLegend['align'], string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/**
 * DOM legend layered over the chart. Positionable on any edge; its measured
 * extent is fed back into the plot margins so grains never overlap it.
 */
export class Legend {
  private root: HTMLDivElement;
  private cfg: ResolvedLegend;

  constructor(host: HTMLElement, cfg: ResolvedLegend) {
    this.cfg = cfg;
    this.root = document.createElement('div');
    const s = this.root.style;
    s.position = 'absolute';
    s.pointerEvents = 'none';
    s.font = '12px system-ui, sans-serif';
    s.color = 'rgba(205,211,222,0.9)';
    s.display = cfg.show ? 'flex' : 'none';
    s.gap = '6px 14px';
    s.padding = '4px 6px';
    s.boxSizing = 'border-box';
    host.appendChild(this.root);
  }

  /** Rebuild items (series may change on data update). */
  setEntries(entries: LegendEntry[]): void {
    this.root.replaceChildren();
    for (const e of entries) {
      const item = document.createElement('span');
      item.style.display = 'inline-flex';
      item.style.alignItems = 'center';
      item.style.gap = '5px';
      item.style.whiteSpace = 'nowrap';

      const sw = document.createElement('span');
      sw.style.width = '10px';
      sw.style.height = '10px';
      sw.style.flex = '0 0 auto';
      sw.style.background = rgbaCss(e.color);
      sw.style.borderRadius = this.cfg.swatch === 'disc' ? '50%' : '2px';

      const label = document.createElement('span');
      label.textContent = e.label;

      item.append(sw, label);
      this.root.appendChild(item);
    }
    this.applyPosition();
  }

  private applyPosition(): void {
    const s = this.root.style;
    s.display = this.cfg.show ? 'flex' : 'none';
    // reset edges
    s.top = s.right = s.bottom = s.left = 'auto';
    const horizontal = this.cfg.position === 'top' || this.cfg.position === 'bottom';
    s.flexDirection = horizontal ? 'row' : 'column';
    s.flexWrap = horizontal ? 'wrap' : 'nowrap';
    if (horizontal) {
      s.left = '0';
      s.right = '0';
      s.justifyContent = ALIGN[this.cfg.align];
      s.alignItems = 'center';
      if (this.cfg.position === 'top') s.top = '0';
      else s.bottom = '0';
    } else {
      s.top = '0';
      s.bottom = '0';
      s.justifyContent = 'center';
      s.alignItems = ALIGN[this.cfg.align];
      if (this.cfg.position === 'left') s.left = '0';
      else s.right = '0';
    }
  }

  /** Extent on its edge in CSS px: height for top/bottom, width for left/right. */
  measure(): number {
    if (!this.cfg.show) return 0;
    const r = this.root.getBoundingClientRect();
    return this.cfg.position === 'top' || this.cfg.position === 'bottom' ? r.height : r.width;
  }

  dispose(): void {
    this.root.remove();
  }
}
