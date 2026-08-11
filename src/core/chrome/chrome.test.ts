import { describe, expect, it } from 'vitest';
import { resolveChrome } from './chrome.js';

describe('resolveChrome legend', () => {
  it('defaults interactive to false', () => {
    const c = resolveChrome({ legend: { show: true } });
    expect(c.legend.interactive).toBe(false);
  });

  it('resolves interactive: true', () => {
    const c = resolveChrome({ legend: { show: true, interactive: true } });
    expect(c.legend.interactive).toBe(true);
  });

  it('defaults interactive to false when legend is unset entirely', () => {
    const c = resolveChrome({});
    expect(c.legend.interactive).toBe(false);
  });
});
