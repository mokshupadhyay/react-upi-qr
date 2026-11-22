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

describe('validateUpiParams: review findings', () => {
  // Finding 10.
  it.each(['-@-', 'a@.', 'a@-', '.@b', 'a@b..', 'a..b@okaxis', 'a.@okaxis', '_a@okaxis', 'a@.okaxis', 'a@ok-axis', 'a@ok_axis'])(
    'rejects the VPA %j',
    (payeeVpa) => {
      expect(codes(validateUpiParams({ ...base, payeeVpa }))).toEqual(['payeeVpa:INVALID_VPA']);
    },
  );

  it.each([
    'merchant.store.payments@okhdfcbank',
    'abc.def-1@oksbi',
    'name_1@paytm',
    'paytmqr2810050501011abcdef@paytm',
    'q123456789@ybl',
    '9876543210@upi',
    'Shop-Name@ICICI',
    'user@ok.bank',
    'a.b.c@x.y.z',
    'a-.b@ybl',
  ])('keeps the real-world-shaped VPA %j valid', (payeeVpa) => {
    expect(validateUpiParams({ ...base, payeeVpa })).toEqual([]);
  });

  // Finding 11.
  it.each(['payeeName', 'transactionRef', 'note', 'transactionId'] as const)(
    'rejects control characters in %s',
    (field) => {
      for (const bad of ['a\nb', 'a\u0000', '\u0007x', 'x\u007f', 'x\u009fy', 'tab\there']) {
        expect(codes(validateUpiParams({ ...base, [field]: bad }))).toEqual([`${field}:INVALID_CHARACTERS`]);
      }
    },
  );

  it.each(['payeeName', 'transactionRef', 'note', 'transactionId'] as const)(
    'rejects leading or trailing whitespace in %s',
    (field) => {
      for (const bad of [' Shop', 'Shop ', '  Shop  ', '\u00a0Shop', 'Shop\u3000']) {
        const problems = validateUpiParams({ ...base, [field]: bad });
        expect(codes(problems)).toEqual([`${field}:INVALID_CHARACTERS`]);
        expect(problems[0].message).toMatch(/whitespace/);
      }
    },
  );

  it('rejects surrounding whitespace in payeeVpa as an invalid VPA', () => {
    expect(codes(validateUpiParams({ ...base, payeeVpa: 'shop@okbank ' }))).toEqual(['payeeVpa:INVALID_VPA']);
  });

  it('keeps whitespace inside values', () => {
    expect(validateUpiParams({ ...base, payeeName: 'Corner  Shop', note: 'Order 42, thanks' })).toEqual([]);
  });

  it('treats a whitespace-only optional value as absent', () => {
    expect(validateUpiParams({ ...base, transactionId: '   ', url: ' ' })).toEqual([]);
  });

  // Finding 12.
  it('treats a null or empty currency as absent, like the other optional fields', () => {
    const withNull = { ...base, currency: null } as unknown as UpiPaymentParams;
    const withEmpty = { ...base, currency: '' } as unknown as UpiPaymentParams;
    expect(validateUpiParams(withNull)).toEqual([]);
    expect(validateUpiParams(withEmpty)).toEqual([]);
    expect(validateUpiParams({ ...base, merchantCode: null, transactionId: null, url: null } as unknown as UpiPaymentParams)).toEqual([]);
  });

  // Finding 13.
  it('limits transactionId and url, with overridable defaults', () => {
    expect(DEFAULT_UPI_LIMITS.transactionId).toBe(35);
    expect(DEFAULT_UPI_LIMITS.url).toBe(255);
    const longId = 'T'.repeat(36);
    const longUrl = `https://shop.example/${'a'.repeat(255)}`;
    expect(codes(validateUpiParams({ ...base, transactionId: longId, url: longUrl }))).toEqual([
      'transactionId:TOO_LONG',
      'url:TOO_LONG',
    ]);
    expect(
      validateUpiParams({ ...base, transactionId: longId, url: longUrl }, { limits: { transactionId: 36, url: 300 } }),
    ).toEqual([]);
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,hi',
    'ftp://shop.example/x',
    'upi://pay?pa=a@b',
    '//shop.example/x',
    'shop.example/x',
    'https://',
    'https:///x',
    'https://shop example/x',
    'https://shop.example/a b',
  ])('rejects the url %j', (url) => {
    expect(codes(validateUpiParams({ ...base, url }))).toEqual(['url:INVALID_URL']);
  });

  it.each(['https://shop.example', 'https://shop.example/orders/42?tab=items#top', 'http://localhost:3000/o/1', 'HTTPS://SHOP.EXAMPLE/'])(
    'accepts the url %j',
    (url) => {
      expect(validateUpiParams({ ...base, url })).toEqual([]);
    },
  );
});
