import type {
  UpiLimits,
  UpiParamField,
  UpiPaymentParams,
  UpiProblem,
  UpiValidationOptions,
} from './types.js';

/**
 * Conservative defaults, not limits quoted from the NPCI specification. They
 * keep requests short enough for common UPI apps. Check the current NPCI UPI
 * Linking Specifications and your PSP's documentation, and override them with
 * `options.limits` when your values are known to be accepted.
 */
export const DEFAULT_UPI_LIMITS: Readonly<UpiLimits> = Object.freeze({
  payeeVpa: 255,
  payeeName: 50,
  transactionRef: 35,
  note: 50,
  transactionId: 35,
  url: 255,
});

// Integer part capped at 13 digits so the amount in paise stays a safe
// integer. This is an arithmetic limit of this library, not a UPI rule.
const AMOUNT_PATTERN = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

// Shape check only. It cannot tell whether the address exists or which
// handles a bank actually issues.
// - name: starts with a letter or digit; then letters, digits, `.`, `_`, `-`;
//   no two dots in a row, and no dot at the end.
// - handle: letters and digits, in parts separated by single dots.
const VPA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*@[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;

// C0 and C1 control characters, including tab, newline and DEL.
const CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;

const SURROUNDING_SPACE_PATTERN = /^\s|\s$/;

// `http:` or `https:`, a host without spaces, `/`, `?`, `#` or `@`, then
// anything without spaces.
const URL_PATTERN = /^https?:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i;

const MERCHANT_CODE_PATTERN = /^\d{4}$/;

export type AmountResult = { ok: true; paise: number; formatted: string } | { ok: false; message: string };

/**
 * Parse an amount in rupees with integer arithmetic only. `'10'`, `10`,
 * `'10.5'` and `'010.50'` all become `{ paise: 1050, formatted: '10.50' }`
 * (for `10`, `{ paise: 1000, formatted: '10.00' }`).
 */
export function parseAmount(value: unknown): AmountResult {
  let text: string;
  if (typeof value === 'number') {
    if (!isFinite(value)) return { ok: false, message: 'amount must be a finite number.' };
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return { ok: false, message: 'amount must be a decimal string or a number.' };
  }
  if (text.length === 0) return { ok: false, message: 'amount is required.' };
  if (text.charAt(0) === '-') return { ok: false, message: 'amount must be greater than zero.' };

  const match = AMOUNT_PATTERN.exec(text);
  if (!match) {
    return {
      ok: false,
      message: `amount "${text}" must be a plain decimal with at most two decimals, for example "149.50".`,
    };
  }
  const rupees = parseInt(match[1], 10);
  const fraction = match[2] === undefined ? 0 : parseInt((match[2] + '0').slice(0, 2), 10);
  const paise = rupees * 100 + fraction;
  if (paise <= 0) return { ok: false, message: 'amount must be greater than zero.' };
  const cents = paise % 100;
  const formatted = `${Math.floor(paise / 100)}.${cents < 10 ? '0' : ''}${cents}`;
  return { ok: true, paise, formatted };
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isEncodable(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check payment parameters and return every problem found. Never throws; an
 * empty list means `buildUpiUrl` will accept the parameters.
 *
 * Checks: required fields, value types, `payeeVpa` shape (`name@handle`),
 * `amount` (positive, at most two decimals), `currency` (`'INR'` only),
 * `merchantCode` (four digits), `url` (`http:` or `https:` only), no control
 * characters and no leading or trailing whitespace in any text value, and the
 * length limits in `DEFAULT_UPI_LIMITS`, which are conservative defaults you
 * can override.
 *
 * `undefined`, `null`, `''` and whitespace-only values of optional fields
 * (`currency`, `merchantCode`, `transactionId`, `url`) mean absent.
 */
export function validateUpiParams(params: UpiPaymentParams, options: UpiValidationOptions = {}): UpiProblem[] {
  const problems: UpiProblem[] = [];
  const input = (params != null && typeof params === 'object' ? params : {}) as {
    [key: string]: unknown;
  };
  const limits: UpiLimits = { ...DEFAULT_UPI_LIMITS, ...(options.limits || {}) };

  const add = (code: UpiProblem['code'], field: UpiParamField, message: string) => {
    problems.push({ code, field, message });
  };

  // Returns the string value when the field passes its basic checks.
  // `checkSpace: false` leaves surrounding whitespace to a pattern check.
  const text = (field: UpiParamField, required: boolean, limit?: number, checkSpace = true): string | null => {
    const value = input[field];
    if (value === undefined || value === null || value === '') {
      if (required) add('REQUIRED', field, `${field} is required.`);
      return null;
    }
    if (typeof value !== 'string') {
      add('INVALID_TYPE', field, `${field} must be a string.`);
      return null;
    }
    if (value.trim().length === 0) {
      // Blank optional values are left out of the URL, like empty ones.
      if (required) add('REQUIRED', field, `${field} must not be blank.`);
      return null;
    }
    if (!isEncodable(value)) {
      add('INVALID_CHARACTERS', field, `${field} contains characters that cannot be URL-encoded.`);
      return null;
    }
    if (CONTROL_PATTERN.test(value)) {
      add('INVALID_CHARACTERS', field, `${field} contains control characters such as a newline or a tab.`);
      return null;
    }
    if (checkSpace && SURROUNDING_SPACE_PATTERN.test(value)) {
      add('INVALID_CHARACTERS', field, `${field} must not start or end with whitespace; trim it first.`);
      return null;
    }
    if (limit !== undefined && codePointLength(value) > limit) {
      add('TOO_LONG', field, `${field} is longer than ${limit} characters.`);
      return null;
    }
    return value;
  };

  const vpa = text('payeeVpa', true, limits.payeeVpa, false);
  if (vpa !== null && !VPA_PATTERN.test(vpa)) {
    add('INVALID_VPA', 'payeeVpa', `payeeVpa "${vpa}" does not look like a UPI address such as "name@bank".`);
  }
  text('payeeName', true, limits.payeeName);

  const amount = input.amount;
  if (amount === undefined || amount === null || amount === '') {
    add('REQUIRED', 'amount', 'amount is required.');
  } else if (typeof amount !== 'string' && typeof amount !== 'number') {
    add('INVALID_TYPE', 'amount', 'amount must be a decimal string or a number.');
  } else {
    const parsed = parseAmount(amount);
    if (!parsed.ok) add('INVALID_AMOUNT', 'amount', parsed.message);
  }

  const currency = input.currency;
  // Absent like the other optional fields: undefined, null or ''.
  if (currency !== undefined && currency !== null && currency !== '' && currency !== 'INR') {
    add('INVALID_CURRENCY', 'currency', 'currency must be "INR".');
  }

  text('transactionRef', true, limits.transactionRef);
  text('note', true, limits.note);

  const merchantCode = text('merchantCode', false);
  if (merchantCode !== null && !MERCHANT_CODE_PATTERN.test(merchantCode)) {
    add('INVALID_MERCHANT_CODE', 'merchantCode', 'merchantCode must be a four-digit merchant category code.');
  }
  text('transactionId', false, limits.transactionId);
  const url = text('url', false, limits.url);
  if (url !== null && !URL_PATTERN.test(url)) {
    add('INVALID_URL', 'url', 'url must be an http: or https: link, for example "https://shop.example/orders/42".');
  }

  return problems;
}
