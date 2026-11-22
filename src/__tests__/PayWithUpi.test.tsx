import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildUpiUrl, PayWithUpi } from '../index';
import type { PaymentCheckResult, PayWithUpiProps } from '../index';
import { params } from './support/params';
import { installVisibility, setVisibility } from './support/visibility';

installVisibility();

const url = buildUpiUrl(params);
const query = url.slice('upi://pay?'.length);

interface Harness {
  answer(result: PaymentCheckResult): Promise<void>;
  calls(): number;
}

function confirmHarness(): { confirmPayment: PayWithUpiProps['confirmPayment']; harness: Harness } {
  const open: Array<(result: PaymentCheckResult) => void> = [];
  let count = 0;
  const confirmPayment = () =>
    new Promise<PaymentCheckResult>((resolve) => {
      count += 1;
      open.push(resolve);
    });
  return {
    confirmPayment,
    harness: {
      calls: () => count,
      answer: (result) =>
        act(async () => {
          const next = open.shift();
          if (!next) throw new Error('No check in flight.');
          next(result);
        }),
    },
  };
}

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

const status = () => screen.getByRole('status');

beforeEach(() => {
  jest.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('<PayWithUpi> on desktop', () => {
  it('shows the QR code with amount, payee and countdown, and waits at once', () => {
    const { confirmPayment } = confirmHarness();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} deviceKind="desktop" />);
    expect(screen.getByRole('img', { name: 'UPI QR code to pay ₹149.50 to Corner Shop' })).toBeTruthy();
    expect(screen.getByText('₹149.50')).toBeTruthy();
    expect(screen.getByText('to Corner Shop')).toBeTruthy();
    expect(screen.getByText('Scan with any UPI app to pay')).toBeTruthy();
    expect(screen.getByText('Expires in 5:00')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(status().textContent).toBe('Waiting for payment…');
    expect(status().getAttribute('aria-live')).toBe('polite');
  });

  it('announces Paid, removes the QR code and calls onPaid', async () => {
    const { confirmPayment, harness } = confirmHarness();
    const onPaid = jest.fn();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} onPaid={onPaid} deviceKind="desktop" />);
    await advance(3000);
    await harness.answer('paid');
    expect(status().textContent).toBe('Paid');
    expect(screen.queryByRole('img')).toBeNull();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it('announces Expired and offers to try again', async () => {
    const { confirmPayment, harness } = confirmHarness();
    const onExpired = jest.fn();
    render(
      <PayWithUpi
        params={params}
        confirmPayment={confirmPayment}
        onExpired={onExpired}
        expiresInSeconds={2}
        pollIntervalMs={10000}
        deviceKind="desktop"
      />,
    );
    await advance(1000);
    expect(screen.getByText('Expires in 0:01')).toBeTruthy();
    await advance(1000);
    await harness.answer('pending');
    expect(status().textContent).toBe('Expired');
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img')).toBeNull();

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(status().textContent).toBe('Waiting for payment…');
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('announces a failed payment', async () => {
    const { confirmPayment, harness } = confirmHarness();
    const onFailed = jest.fn();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} onFailed={onFailed} deviceKind="desktop" />);
    await advance(3000);
    await harness.answer('failed');
    expect(status().textContent).toBe('Payment failed');
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('detects the device when no deviceKind is given (jsdom looks like a desktop)', () => {
    const { confirmPayment } = confirmHarness();
    const { container } = render(<PayWithUpi params={params} confirmPayment={confirmPayment} />);
    expect(container.querySelector('.upiqr--desktop')).not.toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('takes labels, for example in Hindi', () => {
    const { confirmPayment } = confirmHarness();
    render(
      <PayWithUpi
        params={params}
        confirmPayment={confirmPayment}
        deviceKind="desktop"
        labels={{ waiting: 'भुगतान की प्रतीक्षा…', expiresIn: (time) => `${time} में समाप्त` }}
      />,
    );
    expect(status().textContent).toBe('भुगतान की प्रतीक्षा…');
    expect(screen.getByText('5:00 में समाप्त')).toBeTruthy();
  });

  it('shows the validation problems instead of a QR code', () => {
    const { confirmPayment, harness } = confirmHarness();
    render(
      <PayWithUpi params={{ ...params, payeeVpa: 'not-a-vpa' }} confirmPayment={confirmPayment} deviceKind="desktop" />,
    );
    expect(screen.getByRole('alert').textContent).toContain('This payment request is not valid.');
    expect(screen.getByRole('alert').textContent).toContain('payeeVpa "not-a-vpa"');
    expect(screen.queryByRole('img')).toBeNull();
    expect(harness.calls()).toBe(0);
  });

  it('shows a message when the link does not fit in a QR code', () => {
    const { confirmPayment } = confirmHarness();
    render(
      <PayWithUpi
        params={{ ...params, url: `https://shop.example/${'a'.repeat(3000)}` }}
        confirmPayment={confirmPayment}
        deviceKind="desktop"
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('This payment request is too long for a QR code.');
  });
});

describe('<PayWithUpi> on a phone', () => {
  it('shows the Pay with UPI link and per-app intent links on Android, without a QR code', () => {
    const { confirmPayment, harness } = confirmHarness();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} deviceKind="android" />);
    expect(screen.getByRole('link', { name: 'Pay with UPI' }).getAttribute('href')).toBe(url);
    expect(screen.getByRole('link', { name: 'PhonePe' }).getAttribute('href')).toBe(
      `intent://pay?${query}#Intent;scheme=upi;package=com.phonepe.app;end`,
    );
    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(screen.queryByRole('img')).toBeNull();
    expect(status().textContent).toBe('');
    expect(harness.calls()).toBe(0);
  });

  it('uses the app schemes on iOS', () => {
    const { confirmPayment } = confirmHarness();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} deviceKind="ios" />);
    expect(screen.getByRole('link', { name: 'Google Pay' }).getAttribute('href')).toBe(`tez://upi/pay?${query}`);
  });

  it('shows only the generic link with apps={[]}', () => {
    const { confirmPayment } = confirmHarness();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} deviceKind="android" apps={[]} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Or open an app')).toBeNull();
  });

  it('starts waiting when a pay link is used, and checks again on return to the tab', async () => {
    const { confirmPayment, harness } = confirmHarness();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} deviceKind="android" />);
    const link = screen.getByRole('link', { name: 'Pay with UPI' });
    // Keep jsdom from trying to navigate to upi://.
    link.addEventListener('click', (event) => event.preventDefault());
    act(() => link.click());
    expect(status().textContent).toBe('Waiting for payment…');

    // The UPI app opens and the page goes to the background.
    act(() => setVisibility('hidden'));
    await advance(60000);
    expect(harness.calls()).toBe(0);
    act(() => setVisibility('visible'));
    expect(harness.calls()).toBe(1);
    await harness.answer('paid');
    expect(status().textContent).toBe('Paid');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is fully keyboard accessible, including the QR toggle', async () => {
    const { confirmPayment } = confirmHarness();
    render(<PayWithUpi params={params} confirmPayment={confirmPayment} deviceKind="android" apps={[]} />);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Pay with UPI' }));
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Pay from another phone' });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('img', { name: /UPI QR code/ })).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide QR code');
    // Showing the QR code starts waiting, as on desktop.
    expect(status().textContent).toBe('Waiting for payment…');
    await user.keyboard(' ');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
