import type { ResolvedTitle } from './chrome.js';

const ALIGN: Record<ResolvedTitle['align'], string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/**
 * DOM title layered over the chart. Deliberately built like {@link Legend}:
 * same edge/alignment vocabulary and the same measure-then-inset contract, so a
 * title and a legend placed on the same edge stack and align with each other,
 * and neither ever overlaps the plot.
 */
export class Title {
  private root: HTMLDivElement;
  private cfg: ResolvedTitle;

  constructor(host: HTMLElement, cfg: ResolvedTitle) {
    this.cfg = cfg;
    this.root = document.createElement('div');
    const s = this.root.style;
    s.position = 'absolute';
    s.pointerEvents = 'none';
    s.boxSizing = 'border-box';
    s.padding = '4px 6px';
    s.display = 'flex';
    s.alignItems = 'center';
    host.appendChild(this.root);
    this.setText(cfg.text);
  }

  /** Replace the title text (empty hides the layer). */
  setText(text: string): void {
    this.cfg = { ...this.cfg, text, show: text.length > 0 };
    this.root.textContent = text;
    this.applyStyle();
  }

  private applyStyle(): void {
    const c = this.cfg;
    const s = this.root.style;
    s.display = c.show ? 'flex' : 'none';
    s.color = c.color;
    s.font = `${c.fontWeight} ${c.fontPx}px ${c.fontFamily}`;
    s.top = s.right = s.bottom = s.left = 'auto';
    const horizontal = c.position === 'top' || c.position === 'bottom';
    if (horizontal) {
      s.left = '0';
      s.right = '0';
      s.justifyContent = ALIGN[c.align];
      s.writingMode = 'horizontal-tb';
      s.transform = 'none';
      if (c.position === 'top') s.top = '0';
      else s.bottom = '0';
    } else {
      // Side titles read vertically, mirroring a rotated Y-axis label.
      s.top = '0';
      s.bottom = '0';
      s.justifyContent = ALIGN[c.align];
      s.writingMode = 'vertical-rl';
      s.transform = c.position === 'left' ? 'rotate(180deg)' : 'none';
      if (c.position === 'left') s.left = '0';
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
