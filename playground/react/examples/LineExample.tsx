import { LineChart } from '@smalldat/sandycoast/react';
import { useState } from 'react';

const data = {
  points: [
    { x: 0, y: 12, z: 'A' },
    { x: 1, y: 18, z: 'A' },
    { x: 2, y: 15, z: 'A' },
    { x: 3, y: 24, z: 'A' },
    { x: 0, y: 8, z: 'B' },
    { x: 1, y: 10, z: 'B' },
    { x: 2, y: 17, z: 'B' },
    { x: 3, y: 14, z: 'B' },
  ],
};

const options = {
  colors: ['#8bc4e8', '#e8c45a'],
  legend: { show: true, position: 'bottom' as const },
  axes: { x: { show: true }, y: { show: true } },
};

export function LineExample() {
  const [hover, setHover] = useState('hover the line…');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <LineChart
        data={data}
        options={options}
        style={{ flex: 1, minHeight: 0 }}
        onHover={({ point }) =>
          setHover(
            point ? `${point.xValue} · ${point.seriesKey} = ${point.yValue}` : 'hover the line…',
          )
        }
      />
      <p style={{ fontSize: 12, opacity: 0.65, margin: '6px 2px 0' }}>{hover}</p>
    </div>
  );
}
