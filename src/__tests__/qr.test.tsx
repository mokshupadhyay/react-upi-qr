import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { buildUpiUrl, createQrMatrix, PayWithUpi, QrCode, UpiError } from '../index';
import { qrSvgPath } from '../qr';
import { decodeQrSvg, qrMarkup } from './support/decodeQr';
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

  it.each(['L', 'M', 'Q', 'H'] as const)('scans at error correction %s', (level) => {
    const { container } = render(
      <PayWithUpi params={params} confirmPayment={never} deviceKind="desktop" errorCorrection={level} />,
    );
    expect(decodeQrSvg(qrMarkup(container))!.bytes).toBe(buildUpiUrl(params));
  });

  it('scans a long URL that needs a large version', () => {
    const long = { ...params, transactionId: 'T'.repeat(400), url: `https://shop.example/${'a'.repeat(600)}` };
    const { container } = render(<PayWithUpi params={long} confirmPayment={never} deviceKind="desktop" />);
    expect(decodeQrSvg(qrMarkup(container))!.bytes).toBe(buildUpiUrl(long));
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
