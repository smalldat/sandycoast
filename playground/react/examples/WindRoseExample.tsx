import { WindRoseChart } from '@smalldat/sandycoast/react';
import { useState } from 'react';

function randomObservations(n: number) {
  const points: { t: number; direction: number; intensity: number }[] = [];
  const start = Date.now() - n * 60 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    points.push({
      t: start + i * 60 * 60 * 1000,
      direction: Math.random() * 360,
      intensity: Math.random() * 25,
    });
  }
  return points;
}

const data = { points: randomObservations(300) };

const options = {
  sectors: { count: 16 },
  colors: ['#8bc4e8', '#5ae89a', '#e8c45a', '#e8895a', '#e8598b'],
};

export function WindRoseExample() {
  const [hover, setHover] = useState('hover a petal…');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <WindRoseChart
        data={data}
        options={options}
        style={{ flex: 1, minHeight: 0 }}
        onHover={({ segment }) =>
          setHover(segment ? `${segment.bearing} · ${segment.count} readings` : 'hover a petal…')
        }
      />
      <p style={{ fontSize: 12, opacity: 0.65, margin: '6px 2px 0' }}>{hover}</p>
    </div>
  );
}
