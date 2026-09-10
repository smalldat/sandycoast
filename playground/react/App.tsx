import { type ComponentType, useState } from 'react';
import { CodePanel } from './CodePanel.js';
import { BarExample } from './examples/BarExample.js';
import barSource from './examples/BarExample.tsx?raw';
import { CandlestickExample } from './examples/CandlestickExample.js';
import candlestickSource from './examples/CandlestickExample.tsx?raw';
import { LineExample } from './examples/LineExample.js';
import lineSource from './examples/LineExample.tsx?raw';
import { PieExample } from './examples/PieExample.js';
import pieSource from './examples/PieExample.tsx?raw';
import { ScatterExample } from './examples/ScatterExample.js';
import scatterSource from './examples/ScatterExample.tsx?raw';
import { WindRoseExample } from './examples/WindRoseExample.js';
import windRoseSource from './examples/WindRoseExample.tsx?raw';

interface Tab {
  id: string;
  label: string;
  Component: ComponentType;
  source: string;
}

// Each tab's `source` is the *literal file content* of its example (Vite's
// `?raw` import), not a hand-copied string — so the code panel can never
// drift from what's actually rendered above it.
const TABS: Tab[] = [
  { id: 'bar', label: 'Bar', Component: BarExample, source: barSource },
  { id: 'line', label: 'Line', Component: LineExample, source: lineSource },
  { id: 'pie', label: 'Pie', Component: PieExample, source: pieSource },
  { id: 'scatter', label: 'Scatter', Component: ScatterExample, source: scatterSource },
  { id: 'windrose', label: 'Wind rose', Component: WindRoseExample, source: windRoseSource },
  {
    id: 'candlestick',
    label: 'Candlestick',
    Component: CandlestickExample,
    source: candlestickSource,
  },
];

export function App() {
  const [activeId, setActiveId] = useState(TABS[0]!.id);
  const tab = TABS.find((t) => t.id === activeId) ?? TABS[0]!;
  const { Component } = tab;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 560 }}
    >
      <p style={{ fontSize: 13, opacity: 0.75, margin: 0, maxWidth: 680 }}>
        Each tab renders a chart via <code>@smalldat/sandycoast/react</code>. The panel below is the
        exact source for that example — copy it into your app as a starting point.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveId(t.id)}
            style={{
              background: t.id === activeId ? 'var(--surface-hover)' : 'var(--surface)',
              color: 'var(--fg)',
              border: `1px solid ${t.id === activeId ? 'var(--border)' : 'transparent'}`,
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        style={{
          width: '100%',
          height: 340,
          flexShrink: 0,
          border: '1px solid var(--line)',
          borderRadius: 10,
          background: 'var(--sunken)',
          overflow: 'hidden',
        }}
      >
        <Component />
      </div>

      <div style={{ flex: 1, minHeight: 200, display: 'flex' }}>
        <CodePanel code={tab.source} />
      </div>
    </div>
  );
}
