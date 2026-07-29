import type { PanZoomable, ResolvedControls, ZoomCorner } from './types.js';

/** Per-corner CSS anchor. Extra inset (legend/FPS clearance) is added on top. */
const ANCHORS: Record<ZoomCorner, { v: 'top' | 'bottom'; h: 'left' | 'right' }> = {
  'top-left': { v: 'top', h: 'left' },
  'top-right': { v: 'top', h: 'right' },
  'bottom-left': { v: 'bottom', h: 'left' },
  'bottom-right': { v: 'bottom', h: 'right' },
};

/**
 * On-chart zoom buttons (`+`, `−`, reset), pinned to a plot corner. A thin DOM
 * layer over the chart element that drives the {@link PanZoomable} target — the
 * same programmatic API available to callers. Its inset is set by the chart so
 * it stays clear of the legend and FPS meter.
 */
export class ZoomControls {
  private root: HTMLDivElement;

  constructor(host: HTMLElement, target: PanZoomable, cfg: ResolvedControls) {
    const root = document.createElement('div');
    const s = root.style;
    s.position = 'absolute';
    s.zIndex = '3';
    s.display = cfg.show ? 'flex' : 'none';
    s.flexDirection = 'column';
    s.gap = '4px';
    this.root = root;

    root.append(
      this.button('+', cfg, () => target.zoomBy(cfg.step), 'Zoom in'),
      this.button('−', cfg, () => target.zoomBy(1 / cfg.step), 'Zoom out'),
      this.button('⤢', cfg, () => target.resetView(), 'Reset view'),
    );

    const a = ANCHORS[cfg.position];
    root.dataset.v = a.v;
    root.dataset.h = a.h;
    host.appendChild(root);
    this.setInset(6, 6);
  }

  private button(
    glyph: string,
    cfg: ResolvedControls,
    onClick: () => void,
    title: string,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = title;
    const s = b.style;
    s.width = '26px';
    s.height = '26px';
    s.font = '15px system-ui, sans-serif';
    s.lineHeight = '1';
    s.cursor = 'pointer';
    s.color = cfg.color;
    s.background = 'rgba(16,20,28,0.62)';
    s.border = '1px solid rgba(205,211,222,0.22)';
    s.borderRadius = '6px';
    s.padding = '0';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return b;
  }

  /** Position from its anchored corner, in CSS px (chart supplies the clearance). */
  setInset(vInset: number, hInset: number): void {
    const s = this.root.style;
    s.top = s.bottom = s.left = s.right = 'auto';
    s[this.root.dataset.v as 'top' | 'bottom'] = `${vInset}px`;
    s[this.root.dataset.h as 'left' | 'right'] = `${hInset}px`;
  }

  dispose(): void {
    this.root.remove();
  }
}
