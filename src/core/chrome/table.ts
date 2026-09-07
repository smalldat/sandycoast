import type { RGBA } from '../render/types.js';
import { cssRGBA } from '../util/color.js';
import type { Side, TableConfig } from './types.js';

/**
 * One row, already formatted by the chart. `core` never learns what the values
 * mean — it lays them out, styles them and reports clicks.
 */
export interface TableRow {
  /** Stable identity, used to keep the selection across rebuilds. */
  id: string;
  cells: string[];
  /** Swatch color; omitted rows get no swatch. */
  color?: RGBA;
}

export interface ResolvedTable {
  show: boolean;
  position: Side;
  align: 'start' | 'center' | 'end';
  maxRows: number;
  interactive: boolean;
  stickyHeader: boolean;
  followSelection: boolean;
  maxHeight: string;
  maxWidth: string;
  fontPx: number;
  fontFamily: string;
  color: string;
}

const TABLE_COLOR = 'rgba(205,211,222,0.9)';

/** Resolve a `table` block with the shared defaults. */
export function resolveTable(cfg: TableConfig | undefined): ResolvedTable {
  return {
    show: cfg?.show ?? false,
    position: cfg?.position ?? 'right',
    align: cfg?.align ?? 'center',
    maxRows: Math.max(1, Math.floor(cfg?.maxRows ?? 500)),
    interactive: cfg?.interactive ?? true,
    stickyHeader: cfg?.stickyHeader ?? true,
    followSelection: cfg?.followSelection ?? true,
    maxHeight: cfg?.maxHeight ?? '100%',
    maxWidth: cfg?.maxWidth ?? '220px',
    fontPx: cfg?.fontPx ?? 11,
    fontFamily: cfg?.fontFamily ?? 'system-ui, sans-serif',
    color: cfg?.color ?? TABLE_COLOR,
  };
}

const ALIGN: Record<ResolvedTable['align'], string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/**
 * DOM data table layered over the chart — a {@link Legend} sibling.
 *
 * Built as a sibling rather than as part of any one chart because the thing it
 * replaces (a legend) is shared, and because a table of rows is not specific to
 * wind: any chart with more to say per mark than a color swatch can mount one.
 */
export class Table {
  private root: HTMLDivElement;
  private head: HTMLDivElement;
  private body: HTMLDivElement;
  private cfg: ResolvedTable;
  private onRowClick: ((index: number, e: MouseEvent) => void) | undefined;
  private rows: HTMLDivElement[] = [];
  private selected: number | null = null;
  private columns: string[] = [];
  /** How far in another layer on this edge already pushed, CSS px. */
  private edgeOffset = 0;

  constructor(
    host: HTMLElement,
    cfg: ResolvedTable,
    onRowClick?: (index: number, e: MouseEvent) => void,
  ) {
    this.cfg = cfg;
    this.onRowClick = onRowClick;

    this.root = document.createElement('div');
    const s = this.root.style;
    s.position = 'absolute';
    s.display = cfg.show ? 'flex' : 'none';
    s.flexDirection = 'column';
    s.font = `${cfg.fontPx}px ${cfg.fontFamily}`;
    s.color = cfg.color;
    s.boxSizing = 'border-box';
    s.padding = '2px 4px';
    s.gap = '2px';
    // Only the rows take pointer events, so the chart still receives hover
    // everywhere the table is not actually covering.
    s.pointerEvents = 'none';
    s.overflow = 'hidden';

    this.head = document.createElement('div');
    this.head.style.display = 'flex';
    this.head.style.gap = '8px';
    this.head.style.opacity = '0.65';
    this.head.style.fontWeight = '600';
    this.head.style.padding = '0 4px 2px';
    this.head.style.flex = '0 0 auto';
    if (cfg.stickyHeader) this.head.style.borderBottom = '1px solid rgba(255,255,255,0.12)';

    this.body = document.createElement('div');
    this.body.style.display = 'flex';
    this.body.style.flexDirection = 'column';
    this.body.style.overflowY = 'auto';
    this.body.style.overflowX = 'hidden';
    this.body.style.flex = '1 1 auto';
    this.body.style.minHeight = '0';
    if (cfg.interactive && onRowClick) this.body.style.pointerEvents = 'auto';

    this.root.append(this.head, this.body);
    host.appendChild(this.root);
    this.applyPosition();
  }

  /** Column headers. Called separately from rows: they change far less often. */
  setColumns(labels: string[]): void {
    this.columns = labels;
    this.head.replaceChildren();
    labels.forEach((label, i) => {
      const cell = document.createElement('span');
      cell.textContent = label;
      cell.style.flex = i === 0 ? '0 0 auto' : '1 1 auto';
      cell.style.whiteSpace = 'nowrap';
      if (i > 0) cell.style.textAlign = 'right';
      this.head.appendChild(cell);
    });
  }

  setRows(rows: TableRow[]): void {
    const capped = rows.slice(0, this.cfg.maxRows);
    this.body.replaceChildren();
    this.rows = [];
    capped.forEach((row, i) => {
      const el = document.createElement('div');
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '8px';
      el.style.padding = '1px 4px';
      el.style.borderRadius = '3px';
      el.style.whiteSpace = 'nowrap';
      el.style.transition = 'background-color 120ms ease, opacity 120ms ease';
      el.dataset.rowId = row.id;

      if (row.color) {
        const sw = document.createElement('span');
        sw.style.width = '6px';
        sw.style.height = '6px';
        sw.style.flex = '0 0 auto';
        sw.style.borderRadius = '50%';
        sw.style.background = cssRGBA(row.color, 1);
        el.appendChild(sw);
      }

      row.cells.forEach((text, ci) => {
        const cell = document.createElement('span');
        cell.textContent = text;
        cell.style.flex = ci === 0 ? '0 0 auto' : '1 1 auto';
        if (ci > 0) cell.style.textAlign = 'right';
        el.appendChild(cell);
      });

      if (this.cfg.interactive && this.onRowClick) {
        el.style.cursor = 'pointer';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.addEventListener('click', (e) => this.onRowClick?.(i, e));
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            this.onRowClick?.(i, new MouseEvent('click'));
          }
        });
      }

      this.rows.push(el);
      this.body.appendChild(el);
    });
    this.applySelection();
  }

  /**
   * Reflect the selected row (or `null`). Kept apart from `setRows` so a
   * selection change does not rebuild the list — and so the scroll position
   * survives one.
   */
  setSelected(index: number | null): void {
    this.selected = index;
    this.applySelection();
    if (this.cfg.followSelection && index !== null) {
      this.rows[index]?.scrollIntoView({ block: 'nearest' });
    }
  }

  private applySelection(): void {
    this.rows.forEach((el, i) => {
      const on = this.selected === i;
      el.style.background = on ? 'rgba(255,255,255,0.14)' : 'transparent';
      el.style.opacity = this.selected === null || on ? '1' : '0.55';
      if (el.getAttribute('role') === 'button') el.setAttribute('aria-pressed', String(on));
    });
  }

  /**
   * Inset this layer by `px` on its own edge, so it stacks under a legend or
   * title already occupying that edge instead of drawing on top of it.
   */
  setEdgeOffset(px: number): void {
    this.edgeOffset = px;
    this.applyPosition();
  }

  private applyPosition(): void {
    const s = this.root.style;
    s.display = this.cfg.show ? 'flex' : 'none';
    s.top = s.right = s.bottom = s.left = 'auto';
    const off = `${this.edgeOffset}px`;
    const horizontal = this.cfg.position === 'top' || this.cfg.position === 'bottom';
    if (horizontal) {
      s.left = '0';
      s.right = '0';
      s.alignItems = ALIGN[this.cfg.align];
      s.maxHeight = this.cfg.maxHeight === '100%' ? '40%' : this.cfg.maxHeight;
      s.maxWidth = 'none';
      if (this.cfg.position === 'top') s.top = off;
      else s.bottom = off;
    } else {
      s.top = '0';
      s.bottom = '0';
      s.justifyContent = ALIGN[this.cfg.align];
      s.maxHeight = this.cfg.maxHeight;
      s.maxWidth = this.cfg.maxWidth;
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

  /** Column headers currently shown (mainly for tests). */
  getColumns(): string[] {
    return [...this.columns];
  }

  dispose(): void {
    this.root.remove();
  }
}
