import { formatRupees } from '../index';
import { formatCountdown } from '../format';

describe('formatRupees', () => {
  it.each<[string | number, string]>([
    ['1', '₹1.00'],
    ['149.5', '₹149.50'],
    [999, '₹999.00'],
    ['1000', '₹1,000.00'],
    ['99999.99', '₹99,999.99'],
    ['100000', '₹1,00,000.00'],
    ['12345678.9', '₹1,23,45,678.90'],
  ])('formats %j as %s', (amount, expected) => {
    expect(formatRupees(amount)).toBe(expected);
  });

  it('returns null for an invalid amount', () => {
    expect(formatRupees('0')).toBeNull();
    expect(formatRupees('1.234')).toBeNull();
  });
});

describe('formatCountdown', () => {
  it.each<[number, string]>([
    [300, '5:00'],
    [245, '4:05'],
    [59, '0:59'],
    [0, '0:00'],
    [-3, '0:00'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected);
  });
});
