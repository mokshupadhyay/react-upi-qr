import { parseAmount } from './validate.js';

/**
 * `₹1,49,999.50`: rupees with Indian digit grouping (lakh, crore) and two
 * decimals. Returns `null` for an invalid amount. Integer arithmetic only.
 */
export function formatRupees(amount: string | number): string | null {
  const parsed = parseAmount(amount);
  if (!parsed.ok) return null;
  const [rupees, paise] = parsed.formatted.split('.');
  let grouped = rupees.slice(-3);
  let rest = rupees.slice(0, -3);
  while (rest.length > 0) {
    grouped = `${rest.slice(-2)},${grouped}`;
    rest = rest.slice(0, -2);
  }
  return `₹${grouped}.${paise}`;
}

/** `4:05` for 245 seconds. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const s = whole % 60;
  return `${Math.floor(whole / 60)}:${s < 10 ? '0' : ''}${s}`;
}
