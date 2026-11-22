import { UpiError } from './errors.js';
import type { UpiPaymentParams, UpiValidationOptions } from './types.js';
import { parseAmount, validateUpiParams } from './validate.js';

/**
 * Encode a query value. `encodeURIComponent` plus `@` left as is: RFC 3986
 * allows `@` in a query, and some UPI apps fail to read `pa=shop%40bank`.
 */
export function encodeUpiValue(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, '@');
}

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Build the `upi://pay?...` URL for a payment. Pure: no DOM access, no I/O.
 *
 * Parameters always appear in this order, and empty optional values are left
 * out: `pa`, `pn`, `mc`, `tid`, `tr`, `tn`, `am`, `cu`, `url`. Every value is
 * percent-encoded (spaces become `%20`). `am` always has two decimals.
 *
 * Throws `UpiError` with code `INVALID_PARAMS` and the list of `problems`
 * when `validateUpiParams` finds any.
 */
export function buildUpiUrl(params: UpiPaymentParams, options: UpiValidationOptions = {}): string {
  const problems = validateUpiParams(params, options);
  if (problems.length > 0) {
    throw new UpiError(
      'INVALID_PARAMS',
      `Invalid UPI payment parameters: ${problems.map((problem) => problem.message).join(' ')}`,
      problems,
    );
  }
  const amount = parseAmount(params.amount);
  // Validation passed, so the amount parses.
  const am = amount.ok ? amount.formatted : '';

  const pairs: Array<[string, string | undefined]> = [
    ['pa', params.payeeVpa],
    ['pn', params.payeeName],
    ['mc', params.merchantCode],
    ['tid', params.transactionId],
    ['tr', params.transactionRef],
    ['tn', params.note],
    ['am', am],
    ['cu', params.currency || 'INR'],
    ['url', params.url],
  ];
  const query = pairs
    .filter((pair): pair is [string, string] => present(pair[1]))
    .map(([key, value]) => `${key}=${encodeUpiValue(value)}`)
    .join('&');
  return `upi://pay?${query}`;
}
