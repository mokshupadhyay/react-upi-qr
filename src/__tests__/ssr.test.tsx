/**
 * @jest-environment node
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { buildUpiUrl, PayWithUpi, QrCode } from '../index';
import { params } from './support/params';

const never = () => new Promise<'pending'>(() => undefined);

describe('server rendering', () => {
  it('runs without window, document or navigator', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders the shell and the live region, but no device-specific UI, before detection', () => {
    const html = renderToString(<PayWithUpi params={params} confirmPayment={never} />);
    expect(html).toContain('upiqr--detecting');
    expect(html).toContain('role="status"');
    expect(html).toContain('₹149.50');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('upi://pay');
  });

  it('renders the QR code on the server when deviceKind is given', () => {
    const html = renderToString(<PayWithUpi params={params} confirmPayment={never} deviceKind="desktop" />);
    expect(html).toContain('<svg');
    expect(html).toContain('upiqr--idle');
  });

  it('renders the phone links on the server when deviceKind is given', () => {
    const html = renderToString(<PayWithUpi params={params} confirmPayment={never} deviceKind="android" />);
    expect(html).toContain(`href="${buildUpiUrl(params).replace(/&/g, '&amp;')}"`);
  });

  it('renders <QrCode> on the server', () => {
    expect(renderToString(<QrCode value="hello" />)).toContain('<path');
  });
});
