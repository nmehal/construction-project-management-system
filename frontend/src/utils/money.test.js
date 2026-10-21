import { describe, expect, it } from 'vitest';
import { formatAUD, normalizeMoney } from './money.js';

describe('decimal-string money', () => {
  it.each([
    ['100.10', 'A$100.10'], ['0.20', 'A$0.20'], ['100.30', 'A$100.30'],
    ['999999999999.99', 'A$999,999,999,999.99'], ['-1234.50', '-A$1,234.50'],
    ['0', 'A$0.00'],
  ])('formats %s without floating-point conversion', (value, expected) => {
    expect(formatAUD(value)).toBe(expected);
  });
  it('normalizes for comparison without modifying API values', () => {
    const original = '00100.1';
    expect(normalizeMoney(original)).toBe('100.10');
    expect(original).toBe('00100.1');
  });
  it('rejects floats, invalid strings and excess fractional precision', () => {
    for (const value of [100.1, 'NaN', '1e3', '1.001', '']) {
      expect(() => normalizeMoney(value)).toThrow();
      expect(formatAUD(value)).toBe('Unavailable');
    }
  });
});
