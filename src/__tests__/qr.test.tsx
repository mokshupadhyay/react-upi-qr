import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { buildUpiUrl, createQrMatrix, DEFAULT_UPI_LIMITS, PayWithUpi, QrCode, UpiError } from '../index';
import { qrSvgPath } from '../qr';
import { decodeQrSvg, decodeQrSvgAtWidth, qrMarkup } from './support/decodeQr';
import { params } from './support/params';

const never = () => new Promise<'pending'>(() => undefined);

describe('createQrMatrix', () => {
  it('picks the smallest version that fits', () => {
    expect(createQrMatrix('hello').size).toBe(21);
    const long = createQrMatrix(buildUpiUrl(params));
    expect(long.size).toBeGreaterThan(21);
    expect((long.size - 17) % 4).toBe(0);
    expect(long.modules).toHaveLength(long.size);
    long.modules.forEach((row) => expect(row).toHaveLength(long.size));
  });

  it('uses a bigger code for a higher error correction level', () => {
    const url = buildUpiUrl(params);
    expect(createQrMatrix(url, 'H').size).toBeGreaterThan(createQrMatrix(url, 'L').size);
  });

  it('throws QR_TOO_LONG when the text does not fit', () => {
    let caught: unknown;
    try {
      createQrMatrix('x'.repeat(3000));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UpiError);
    expect(caught).toMatchObject({ code: 'QR_TOO_LONG' });
  });
});

describe('qrSvgPath', () => {
  it('merges dark runs in a row and offsets by the margin', () => {
    const matrix = {
      size: 3,
      modules: [
        [true, true, false],
        [false, false, false],
        [true, false, true],
      ],
    };
    expect(qrSvgPath(matrix, 0)).toBe('M0 0h2v1h-2zM0 2h1v1h-1zM2 2h1v1h-1z');
    expect(qrSvgPath(matrix, 4)).toBe('M4 4h2v1h-2zM4 6h1v1h-1zM6 6h1v1h-1z');
  });
});

describe('QR round trip', () => {
  it('decodes the QR code of <PayWithUpi> back to the exact upi://pay URL', () => {
    const special = {
      ...params,
      payeeName: 'रवि & Sons',
      note: 'Order #42, 100% fresh 🙂',
      merchantCode: '5411',
      url: 'https://shop.example/orders/42?tab=items',
    };
    const { container } = render(<PayWithUpi params={special} confirmPayment={never} deviceKind="desktop" />);
    const decoded = decodeQrSvg(qrMarkup(container));
    expect(decoded).not.toBeNull();
    expect(decoded!.bytes).toBe(buildUpiUrl(special));
    expect(decoded!.text).toBe(buildUpiUrl(special));
  });

  it('decodes when the payee name has markup characters (also in the accessible name)', () => {
    const tricky = { ...params, payeeName: '<b>A & "B"</b>' };
    const { container } = render(<PayWithUpi params={tricky} confirmPayment={never} deviceKind="desktop" />);
    expect(decodeQrSvg(qrMarkup(container))!.bytes).toBe(buildUpiUrl(tricky));
  });

  it.each(['L', 'M', 'Q', 'H'] as const)('scans at error correction %s', (level) => {
    const { container } = render(
      <PayWithUpi params={params} confirmPayment={never} deviceKind="desktop" errorCorrection={level} />,
    );
    expect(decodeQrSvg(qrMarkup(container))!.bytes).toBe(buildUpiUrl(params));
  });

  it('scans a long URL that needs a large version', () => {
    const long = { ...params, transactionId: 'T'.repeat(400), url: `https://shop.example/${'a'.repeat(600)}` };
    const limits = { transactionId: 400, url: 700 };
    const { container } = render(
      <PayWithUpi params={long} confirmPayment={never} deviceKind="desktop" validation={{ limits }} />,
    );
    expect(decodeQrSvg(qrMarkup(container))!.bytes).toBe(buildUpiUrl(long, { limits }));
  });

  it('encodes other text as UTF-8 in <QrCode>', () => {
    const text = 'नमस्ते, ₹10 🙂';
    const { container } = render(<QrCode value={text} title="Greeting" />);
    const decoded = decodeQrSvg(qrMarkup(container));
    expect(decoded!.text).toBe(text);
    expect(decoded!.bytes).toBe(unescape(encodeURIComponent(text)));
    expect(screen.getByRole('img', { name: 'Greeting' })).toBeTruthy();
  });

  it('does not decode a damaged code (the decoder is not lenient)', () => {
    const { container } = render(<QrCode value={buildUpiUrl(params)} margin={4} />);
    const damaged = qrMarkup(container).replace(/ d="[^"]*"/, ' d="M4 4h10v10h-10z"');
    expect(decodeQrSvg(damaged)).toBeNull();
  });
});

// The width the default stylesheet gives the code:
// max(var(--upiqr-qr-size) = 240px, var(--upiqr-qr-min-size)).
function renderedWidth(svg: SVGElement): number {
  const min = parseFloat(svg.style.getPropertyValue('--upiqr-qr-min-size'));
  expect(min).toBeGreaterThan(0);
  return Math.max(240, min);
}

function modulesAcross(svg: SVGElement): number {
  return Number(svg.getAttribute('viewBox')!.split(' ')[2]);
}

describe('QR size on screen (finding 6)', () => {
  const devanagari = {
    payeeVpa: 'merchant.store.payments@okhdfcbank',
    payeeName: 'श्री गणेश किराना एवं जनरल स्टोर प्राइवेट लिमिटेड'.slice(0, 50),
    amount: '1499.00',
    transactionRef: 'ORD-2026-11-22-000123456789-ABCDEFG',
    note: 'ऑर्डर संख्या 123456 के लिए भुगतान, धन्यवाद आपका दिन शुभ हो'.slice(0, 50),
  };
  // The longest URL the default limits allow without transactionId and url:
  // every name, reference and note character is four UTF-8 bytes.
  const worst = {
    payeeVpa: `${'a'.repeat(DEFAULT_UPI_LIMITS.payeeVpa - 2)}@b`,
    payeeName: '😀'.repeat(DEFAULT_UPI_LIMITS.payeeName),
    amount: '9999999999999.99',
    transactionRef: '😀'.repeat(DEFAULT_UPI_LIMITS.transactionRef),
    note: '😀'.repeat(DEFAULT_UPI_LIMITS.note),
    merchantCode: '5411',
  };

  it.each([
    ['typical', params],
    ['Devanagari at the default limits', devanagari],
    ['worst case at the default limits', worst],
  ])('draws every module at least 3 CSS px wide and decodes at that size: %s', (_name, candidate) => {
    const { container } = render(<PayWithUpi params={candidate} confirmPayment={never} deviceKind="desktop" />);
    const svg = container.querySelector('svg.upiqr-qr') as SVGElement;
    const width = renderedWidth(svg);
    expect(width / modulesAcross(svg)).toBeGreaterThanOrEqual(3);
    const decoded = decodeQrSvgAtWidth(qrMarkup(container), width);
    expect(decoded).not.toBeNull();
    expect(decoded!.bytes).toBe(buildUpiUrl(candidate));
  });

  it('keeps the 240 px default for short URLs', () => {
    const { container } = render(<PayWithUpi params={params} confirmPayment={never} deviceKind="desktop" />);
    const svg = container.querySelector('svg.upiqr-qr') as SVGElement;
    expect(renderedWidth(svg)).toBe(240);
  });

  it('widens the component for a large code', () => {
    const { container } = render(<PayWithUpi params={worst} confirmPayment={never} deviceKind="desktop" />);
    const svg = container.querySelector('svg.upiqr-qr') as SVGElement;
    const root = container.querySelector('section') as HTMLElement;
    const min = svg.style.getPropertyValue('--upiqr-qr-min-size');
    expect(parseFloat(min)).toBeGreaterThan(360);
    expect(root.style.getPropertyValue('--upiqr-qr-min-size')).toBe(min);
  });
});

describe('numeric props of <QrCode> and <QrSvg> (finding 14)', () => {
  it.each([NaN, Infinity, -Infinity, -1, -0.5])('falls back to the default margin of 4 for %p', (margin) => {
    const { container } = render(<QrCode value="hi" margin={margin} />);
    const svg = container.querySelector('svg')!;
    // "hi" is a version 1 code: 21 modules plus 4 on each side.
    expect(svg.getAttribute('viewBox')).toBe('0 0 29 29');
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('accepts a margin of 0 and rounds fractions down', () => {
    const zero = render(<QrCode value="hi" margin={0} />);
    expect(zero.container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 21 21');
    zero.unmount();
    const fraction = render(<QrCode value="hi" margin={2.7} />);
    expect(fraction.container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 25 25');
  });

  it('falls back to error correction M for an unknown level', () => {
    const { container } = render(<QrCode value="hi" errorCorrection={'X' as 'M'} />);
    expect(decodeQrSvg(qrMarkup(container))!.text).toBe('hi');
  });
});
