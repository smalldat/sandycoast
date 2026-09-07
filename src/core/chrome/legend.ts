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
  private onEntryClick: ((index: number) => void) | undefined;
  private items: HTMLSpanElement[] = [];
  private focused: number | null = null;
  /** How far in another layer on this edge already pushed, CSS px. */
  private edgeOffset = 0;

  constructor(host: HTMLElement, cfg: ResolvedLegend, onEntryClick?: (index: number) => void) {
    this.cfg = cfg;
    this.onEntryClick = onEntryClick;
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
    this.items = [];
    const interactive = this.cfg.interactive && !!this.onEntryClick;
    entries.forEach((e, i) => {
      const item = document.createElement('span');
      item.style.display = 'inline-flex';
      item.style.alignItems = 'center';
      item.style.gap = '5px';
      item.style.whiteSpace = 'nowrap';
      item.style.transition = 'opacity 120ms ease';

      const sw = document.createElement('span');
      sw.style.width = '10px';
      sw.style.height = '10px';
      sw.style.flex = '0 0 auto';
      sw.style.background = rgbaCss(e.color);
      sw.style.borderRadius = this.cfg.swatch === 'disc' ? '50%' : '2px';

      const label = document.createElement('span');
      label.textContent = e.label;

      item.append(sw, label);

      if (interactive) {
        item.style.pointerEvents = 'auto';
        item.style.cursor = 'pointer';
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-pressed', 'false');
        item.addEventListener('click', () => this.onEntryClick?.(i));
        item.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            this.onEntryClick?.(i);
          }
        });
      }

      this.items.push(item);
      this.root.appendChild(item);
    });
    this.applyFocusStyles();
    this.applyPosition();
  }

  /**
   * Reflect the currently isolated entry (or `null` for none) on the legend's
   * own DOM — dims every other entry's label the same way the chart dims its
   * grains. Survives independent of `setEntries` so a focus change doesn't
   * need to rebuild the whole entry list.
   */
  setFocus(index: number | null): void {
    this.focused = index;
    this.applyFocusStyles();
  }

  private applyFocusStyles(): void {
    this.items.forEach((item, i) => {
      const isFocused = this.focused === null || this.focused === i;
      item.style.opacity = isFocused ? '1' : '0.4';
      item.style.fontWeight = this.focused === i ? '600' : 'normal';
      if (item.getAttribute('role') === 'button') {
        item.setAttribute('aria-pressed', String(this.focused === i));
      }
    });
  }

  /**
   * Inset this layer by `px` on its own edge, so it stacks under a title or
   * table already occupying that edge instead of drawing on top of it.
   *
   * The plot margins have always summed both layers' extents, but each layer
   * pinned itself at `edge: 0` — correct inset, overlapping layers.
   */
  setEdgeOffset(px: number): void {
    this.edgeOffset = px;
    this.applyPosition();
  }

  private applyPosition(): void {
    const s = this.root.style;
    s.display = this.cfg.show ? 'flex' : 'none';
    // reset edges
    s.top = s.right = s.bottom = s.left = 'auto';
    const off = `${this.edgeOffset}px`;
    const horizontal = this.cfg.position === 'top' || this.cfg.position === 'bottom';
    s.flexDirection = horizontal ? 'row' : 'column';
    s.flexWrap = horizontal ? 'wrap' : 'nowrap';
    if (horizontal) {
      s.left = '0';
      s.right = '0';
      s.justifyContent = ALIGN[this.cfg.align];
      s.alignItems = 'center';
      if (this.cfg.position === 'top') s.top = off;
      else s.bottom = off;
    } else {
      s.top = '0';
      s.bottom = '0';
      s.justifyContent = 'center';
      s.alignItems = ALIGN[this.cfg.align];
      if (this.cfg.position === 'left') s.left = off;
      else s.right = off;
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
