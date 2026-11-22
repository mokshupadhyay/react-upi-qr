import { buildUpiUrl, UpiError } from '../index';
import type { UpiPaymentParams } from '../index';

const base: UpiPaymentParams = {
  payeeVpa: 'shop@okbank',
  payeeName: 'Corner Shop',
  amount: '149.5',
  transactionRef: 'ORDER42',
  note: 'Order 42',
};

describe('buildUpiUrl', () => {
  it('builds the exact URL with the stable parameter order', () => {
    expect(buildUpiUrl(base)).toBe(
      'upi://pay?pa=shop@okbank&pn=Corner%20Shop&tr=ORDER42&tn=Order%2042&am=149.50&cu=INR',
    );
  });

  it('places every optional value in its fixed position', () => {
    expect(
      buildUpiUrl({
        ...base,
        merchantCode: '5411',
        transactionId: 'PSP-TID-1',
        url: 'https://shop.example/orders/42?tab=items',
        currency: 'INR',
      }),
    ).toBe(
      'upi://pay?pa=shop@okbank&pn=Corner%20Shop&mc=5411&tid=PSP-TID-1&tr=ORDER42&tn=Order%2042' +
        '&am=149.50&cu=INR&url=https%3A%2F%2Fshop.example%2Forders%2F42%3Ftab%3Ditems',
    );
  });

  it('gives the same output regardless of property order', () => {
    const reordered: UpiPaymentParams = {
      url: 'https://a.example',
      note: base.note,
      amount: base.amount,
      transactionId: 'T1',
      transactionRef: base.transactionRef,
      merchantCode: '0000',
      payeeName: base.payeeName,
      payeeVpa: base.payeeVpa,
    };
    expect(buildUpiUrl(reordered)).toBe(
      buildUpiUrl({ ...base, merchantCode: '0000', transactionId: 'T1', url: 'https://a.example' }),
    );
  });

  it('omits empty and blank optional values', () => {
    expect(buildUpiUrl({ ...base, merchantCode: '', transactionId: '   ', url: undefined })).toBe(
      buildUpiUrl(base),
    );
  });

  it.each([
    ['Ravi & Sons', 'Ravi%20%26%20Sons'],
    ['a=b', 'a%3Db'],
    ['100%', '100%25'],
    ['x+y', 'x%2By'],
    ['#1 shop', '%231%20shop'],
    ['Café Ünïcode', 'Caf%C3%A9%20%C3%9Cn%C3%AFcode'],
    ['रवि स्टोर', '%E0%A4%B0%E0%A4%B5%E0%A4%BF%20%E0%A4%B8%E0%A5%8D%E0%A4%9F%E0%A5%8B%E0%A4%B0'],
    ['line\nbreak', 'line%0Abreak'],
    ['$&$1', '%24%26%241'],
    ['mail me@home', 'mail%20me@home'],
  ])('encodes %j in a value', (payeeName, encoded) => {
    expect(buildUpiUrl({ ...base, payeeName })).toBe(
      `upi://pay?pa=shop@okbank&pn=${encoded}&tr=ORDER42&tn=Order%2042&am=149.50&cu=INR`,
    );
  });

  it('keeps @ readable in the payee address', () => {
    expect(buildUpiUrl({ ...base, payeeVpa: 'first.last-1_x@ok.bank' })).toContain('pa=first.last-1_x@ok.bank&');
  });

  it.each<[string | number, string]>([
    ['1', '1.00'],
    ['1.5', '1.50'],
    ['1.05', '1.05'],
    ['0.01', '0.01'],
    ['010.10', '10.10'],
    [' 25.00 ', '25.00'],
    ['9999999999999.99', '9999999999999.99'],
    [10, '10.00'],
    [10.5, '10.50'],
    [0.1, '0.10'],
    [1234.56, '1234.56'],
    [0.07, '0.07'],
  ])('formats amount %j as am=%s', (amount, expected) => {
    expect(buildUpiUrl({ ...base, amount })).toContain(`&am=${expected}&`);
  });

  it('throws INVALID_PARAMS with the problems', () => {
    let caught: unknown;
    try {
      buildUpiUrl({ ...base, amount: '0', payeeVpa: 'nope' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UpiError);
    expect(caught).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((caught as UpiError).problems.map((problem) => problem.field)).toEqual(['payeeVpa', 'amount']);
  });

  it('rejects amounts that floating point would have to round', () => {
    expect(() => buildUpiUrl({ ...base, amount: 0.1 + 0.2 })).toThrow(UpiError);
    expect(() => buildUpiUrl({ ...base, amount: 1.005 })).toThrow(UpiError);
  });
});
