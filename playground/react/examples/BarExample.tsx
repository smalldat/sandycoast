import { BarChart } from '@smalldat/sandycoast/react';
import { useState } from 'react';

const data = {
  points: [
    { x: 'Q1', y: 42, z: 'EU' },
    { x: 'Q1', y: 28, z: 'US' },
    { x: 'Q2', y: 55, z: 'EU' },
    { x: 'Q2', y: 34, z: 'US' },
    { x: 'Q3', y: 61, z: 'EU' },
    { x: 'Q3', y: 40, z: 'US' },
  ],
};

const options = {
  colors: ['#e8598b', '#8bc4e8'],
  legend: { show: true, position: 'bottom' as const },
  axes: { y: { show: true, label: 'revenue' } },
};

export function BarExample() {
  const [hover, setHover] = useState('hover a bar…');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <BarChart
        data={data}
        options={options}
        style={{ flex: 1, minHeight: 0 }}
        onHover={({ bar }) =>
          setHover(bar ? `${bar.xValue} · ${bar.seriesKey} = ${bar.yValue}` : 'hover a bar…')
        }
      />
      <p style={{ fontSize: 12, opacity: 0.65, margin: '6px 2px 0' }}>{hover}</p>
    </div>
  );
}
