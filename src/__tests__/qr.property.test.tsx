import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';
import { buildUpiUrl, DEFAULT_UPI_LIMITS, PayWithUpi, validateUpiParams } from '../index';
import type { UpiPaymentParams } from '../index';
import { decodeQrSvg, qrMarkup } from './support/decodeQr';

const never = () => new Promise<'pending'>(() => undefined);

// Any Unicode text without lone surrogates (those are rejected by validation).
const text = (min: number, max: number) =>
  fc.string({ unit: 'grapheme', minLength: min, maxLength: max }).filter((value) => value.trim().length > 0);

const vpaChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.split('');
const handleChars = 'abcdefghijklmnopqrstuvwxyz0123456789.-'.split('');

const vpa = fc
  .tuple(
    fc.array(fc.constantFrom(...vpaChars), { minLength: 1, maxLength: 40 }),
    fc.array(fc.constantFrom(...handleChars), { minLength: 1, maxLength: 20 }),
  )
  .map(([name, handle]) => `${name.join('')}@${handle.join('')}`);

const amount = fc.oneof(
  fc
    .tuple(fc.integer({ min: 0, max: 9999999 }), fc.integer({ min: 0, max: 99 }))
    .filter(([rupees, paise]) => rupees > 0 || paise > 0)
    .map(([rupees, paise]) => `${rupees}.${paise < 10 ? '0' : ''}${paise}`),
  fc.integer({ min: 1, max: 100000 }),
);

const validParams: fc.Arbitrary<UpiPaymentParams> = fc
  .record(
    {
      payeeVpa: vpa,
      payeeName: text(1, DEFAULT_UPI_LIMITS.payeeName),
      amount,
      transactionRef: text(1, DEFAULT_UPI_LIMITS.transactionRef),
      note: text(1, DEFAULT_UPI_LIMITS.note),
      merchantCode: fc.integer({ min: 0, max: 9999 }).map((code) => String(code).padStart(4, '0')),
      transactionId: text(1, 30),
      url: fc.webUrl({ withQueryParameters: true }),
    },
    { requiredKeys: ['payeeVpa', 'payeeName', 'amount', 'transactionRef', 'note'] },
  )
  .filter((candidate) => validateUpiParams(candidate).length === 0);

describe('property: the QR code always decodes to buildUpiUrl(params)', () => {
  it('holds for any valid params', () => {
    fc.assert(
      fc.property(validParams, (candidate) => {
        try {
          const { container } = render(
            <PayWithUpi params={candidate} confirmPayment={never} deviceKind="desktop" />,
          );
          const decoded = decodeQrSvg(qrMarkup(container), 3);
          const expected = buildUpiUrl(candidate);
          return decoded !== null && decoded.bytes === expected && decoded.text === expected;
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
