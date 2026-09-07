import { describe, expect, it } from 'vitest';
import { resolveTable } from './table.js';

// The Table's DOM behavior (row rendering, selection styling, edge stacking)
// is covered in the browser by the e2e harness — no unit test in this package
// touches the DOM, and mounting one would mean a jsdom dependency for a layer
// Playwright already exercises for real. What is worth pinning here is the
// resolution contract every chart reads its defaults from.

describe('resolveTable', () => {
  it('is off until asked for', () => {
    expect(resolveTable(undefined).show).toBe(false);
    expect(resolveTable({}).show).toBe(false);
  });

  it('defaults to the right edge, opposite the legend', () => {
    const t = resolveTable({ show: true });
    expect(t.position).toBe('right');
    expect(t.align).toBe('center');
  });

  it('is interactive and follows the selection by default', () => {
    const t = resolveTable({ show: true });
    expect(t.interactive).toBe(true);
    expect(t.followSelection).toBe(true);
    expect(t.stickyHeader).toBe(true);
  });

  it('caps rows so a long stream cannot grow the DOM without bound', () => {
    expect(resolveTable({}).maxRows).toBe(500);
    expect(resolveTable({ maxRows: 20 }).maxRows).toBe(20);
  });

  it('keeps the row cap at least one row', () => {
    expect(resolveTable({ maxRows: 0 }).maxRows).toBe(1);
    expect(resolveTable({ maxRows: -5 }).maxRows).toBe(1);
  });

  it('rounds a fractional row cap down to a whole row', () => {
    expect(resolveTable({ maxRows: 10.7 }).maxRows).toBe(10);
  });

  it('passes styling through', () => {
    const t = resolveTable({ fontPx: 13, color: '#abc', maxWidth: '300px' });
    expect(t.fontPx).toBe(13);
    expect(t.color).toBe('#abc');
    expect(t.maxWidth).toBe('300px');
  });
});
