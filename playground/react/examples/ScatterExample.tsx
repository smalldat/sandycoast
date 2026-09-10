import { ScatterChart } from '@smalldat/sandycoast/react';
import { useState } from 'react';

function cluster(cx: number, cy: number, n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, () => ({
    x: cx + (Math.random() - 0.5) * 2,
    y: cy + (Math.random() - 0.5) * 2,
  }));
}

const data = {
  series: [
    { key: 'A', points: cluster(3, 3, 30) },
    { key: 'B', points: cluster(7, 6, 30) },
  ],
};

const options = {
  colors: ['#e8598b', '#8bc4e8'],
  legend: { show: true, position: 'bottom' as const },
};

export function ScatterExample() {
  const [hover, setHover] = useState('hover a point…');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScatterChart
        data={data}
        options={options}
        style={{ flex: 1, minHeight: 0 }}
        onHover={({ point }) =>
          setHover(
            point ? `${point.seriesKey}: (${point.xValue}, ${point.yValue})` : 'hover a point…',
          )
        }
      />
      <p style={{ fontSize: 12, opacity: 0.65, margin: '6px 2px 0' }}>{hover}</p>
    </div>
  );
}
