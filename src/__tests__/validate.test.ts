import { DEFAULT_UPI_LIMITS, validateUpiParams } from '../index';
import type { UpiPaymentParams, UpiProblem } from '../index';

const base: UpiPaymentParams = {
  payeeVpa: 'shop@okbank',
  payeeName: 'Corner Shop',
  amount: '149.50',
  transactionRef: 'ORDER42',
  note: 'Order 42',
};

function codes(problems: UpiProblem[]): string[] {
  return problems.map((problem) => `${problem.field}:${problem.code}`);
}

describe('validateUpiParams', () => {
  it('accepts valid parameters', () => {
    expect(validateUpiParams(base)).toEqual([]);
    expect(
      validateUpiParams({ ...base, currency: 'INR', merchantCode: '5411', transactionId: 'T1', url: 'https://x.example' }),
    ).toEqual([]);
  });

  it('reports every missing required field', () => {
    expect(codes(validateUpiParams({} as UpiPaymentParams))).toEqual([
      'payeeVpa:REQUIRED',
      'payeeName:REQUIRED',
      'amount:REQUIRED',
      'transactionRef:REQUIRED',
      'note:REQUIRED',
    ]);
  });

  it('treats blank required strings as missing', () => {
    expect(codes(validateUpiParams({ ...base, payeeName: '   ', note: '' }))).toEqual([
      'payeeName:REQUIRED',
      'note:REQUIRED',
    ]);
  });

  it('never throws, whatever it is given', () => {
    const inputs: unknown[] = [null, undefined, 42, 'x', [], { amount: {} }, { payeeVpa: 5, note: true }];
    for (const input of inputs) {
      expect(() => validateUpiParams(input as UpiPaymentParams)).not.toThrow();
      expect(validateUpiParams(input as UpiPaymentParams).length).toBeGreaterThan(0);
    }
  });

  it('reports wrong types', () => {
    const params = { ...base, payeeVpa: 5, amount: true, url: 7 } as unknown as UpiPaymentParams;
    expect(codes(validateUpiParams(params))).toEqual([
      'payeeVpa:INVALID_TYPE',
      'amount:INVALID_TYPE',
      'url:INVALID_TYPE',
    ]);
  });

  it.each(['shop@okbank', '9876543210@ybl', 'first.last@ok.bank', 'a_b-c@upi', 'A1@X'])(
    'accepts the VPA %j',
    (payeeVpa) => {
      expect(validateUpiParams({ ...base, payeeVpa })).toEqual([]);
    },
  );

  it.each(['shop', '@bank', 'shop@', 'sh op@bank', 'shop@bank@x', 'shop@ba nk', 'shop#1@bank', ' shop@bank'])(
    'rejects the VPA %j',
    (payeeVpa) => {
      expect(codes(validateUpiParams({ ...base, payeeVpa }))).toEqual(['payeeVpa:INVALID_VPA']);
    },
  );

  it.each<[string | number]>([
    ['0'],
    ['0.00'],
    [0],
    ['-1'],
    [-5],
    ['1.234'],
    ['1.'],
    ['.5'],
    ['1,000'],
    ['1e3'],
    ['+5'],
    ['abc'],
    ['10 00'],
    ['₹10'],
    [NaN],
    [Infinity],
    [1e21],
    [0.1 + 0.2],
    ['12345678901234'],
  ])('rejects the amount %j', (amount) => {
    expect(codes(validateUpiParams({ ...base, amount }))).toEqual(['amount:INVALID_AMOUNT']);
  });

  it('rejects other currencies', () => {
    const params = { ...base, currency: 'USD' } as unknown as UpiPaymentParams;
    expect(codes(validateUpiParams(params))).toEqual(['currency:INVALID_CURRENCY']);
  });

  it.each(['541', '54111', 'abcd', '54 1'])('rejects the merchant code %j', (merchantCode) => {
    expect(codes(validateUpiParams({ ...base, merchantCode }))).toEqual(['merchantCode:INVALID_MERCHANT_CODE']);
  });

  it('applies the conservative default length limits', () => {
    const over = (n: number) => 'x'.repeat(n + 1);
    expect(
      codes(
        validateUpiParams({
          ...base,
          payeeName: over(DEFAULT_UPI_LIMITS.payeeName),
          transactionRef: over(DEFAULT_UPI_LIMITS.transactionRef),
          note: over(DEFAULT_UPI_LIMITS.note),
        }),
      ),
    ).toEqual(['payeeName:TOO_LONG', 'transactionRef:TOO_LONG', 'note:TOO_LONG']);
    expect(
      validateUpiParams({
        ...base,
        payeeName: 'x'.repeat(DEFAULT_UPI_LIMITS.payeeName),
        transactionRef: 'x'.repeat(DEFAULT_UPI_LIMITS.transactionRef),
        note: 'x'.repeat(DEFAULT_UPI_LIMITS.note),
      }),
    ).toEqual([]);
  });

  it('counts characters, not UTF-16 units', () => {
    const note = '🙂'.repeat(DEFAULT_UPI_LIMITS.note);
    expect(validateUpiParams({ ...base, note })).toEqual([]);
  });

  it('lets callers override the limits', () => {
    const note = 'x'.repeat(80);
    expect(codes(validateUpiParams({ ...base, note }))).toEqual(['note:TOO_LONG']);
    expect(validateUpiParams({ ...base, note }, { limits: { note: 80 } })).toEqual([]);
    expect(codes(validateUpiParams(base, { limits: { transactionRef: 3 } }))).toEqual(['transactionRef:TOO_LONG']);
  });

  it('reports values that cannot be URL-encoded', () => {
    expect(codes(validateUpiParams({ ...base, note: 'bad \ud800 surrogate' }))).toEqual(['note:INVALID_CHARACTERS']);
  });

  it('gives a readable message for each problem', () => {
    const [problem] = validateUpiParams({ ...base, amount: '1.234' });
    expect(problem.message).toMatch(/at most two decimals/);
  });

  it('keeps the default limits frozen', () => {
    expect(Object.isFrozen(DEFAULT_UPI_LIMITS)).toBe(true);
  });
});
