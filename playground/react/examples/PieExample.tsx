import { PieChart } from '@smalldat/sandycoast/react';
import { useState } from 'react';

const data = {
  points: [
    { x: 'Direct', y: 38, z: 'Traffic' },
    { x: 'Search', y: 27, z: 'Traffic' },
    { x: 'Social', y: 19, z: 'Traffic' },
    { x: 'Referral', y: 16, z: 'Traffic' },
  ],
};

const options = {
  colors: ['#e8598b', '#8bc4e8', '#e8c45a', '#5ae89a'],
  legend: { show: true, position: 'right' as const },
};

export function PieExample() {
  const [hover, setHover] = useState('hover a slice…');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PieChart
        data={data}
        options={options}
        style={{ flex: 1, minHeight: 0 }}
        onHover={({ slice }) =>
          setHover(
            slice ? `${slice.xValue} = ${Math.round(slice.fraction * 100)}%` : 'hover a slice…',
          )
        }
      />
      <p style={{ fontSize: 12, opacity: 0.65, margin: '6px 2px 0' }}>{hover}</p>
    </div>
  );
}
