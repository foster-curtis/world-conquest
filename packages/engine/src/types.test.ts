import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tradeValue } from './index.ts';

describe('tradeValue', () => {
  it('follows the escalating table, then +5 per trade', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(tradeValue)).toEqual([4, 6, 8, 10, 12, 15, 20, 25]);
  });

  it('strictly increases', () => {
    fc.assert(fc.property(fc.nat(1000), (i) => tradeValue(i + 1) > tradeValue(i)));
  });
});
