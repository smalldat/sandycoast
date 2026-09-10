import { CandlestickChart } from '@smalldat/sandycoast/react';
import { useState } from 'react';

function randomCandles(n: number) {
  const candles: { x: number; open: number; high: number; low: number; close: number }[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open + (Math.random() - 0.5) * 6;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    candles.push({ x: i, open, high, low, close });
    price = close;
  }
  return candles;
}

const data = {
  series: [{ key: 'ACME', candles: randomCandles(40) }],
};

const options = {
  candles: { rising: '#2eb872', falling: '#e0555c' },
};

export function CandlestickExample() {
  const [hover, setHover] = useState('hover a candle…');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CandlestickChart
        data={data}
        options={options}
        style={{ flex: 1, minHeight: 0 }}
        onHover={({ candle }) =>
          setHover(candle ? `close ${candle.close.toFixed(2)}` : 'hover a candle…')
        }
      />
      <p style={{ fontSize: 12, opacity: 0.65, margin: '6px 2px 0' }}>{hover}</p>
    </div>
  );
}
