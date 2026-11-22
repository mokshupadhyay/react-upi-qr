import * as React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { PayWithUpi, useUpiPayment } from '../index';
import type { ConfirmPaymentContext, PaymentCheckResult, UpiPaymentParams, UseUpiPaymentOptions } from '../index';
import { params } from './support/params';
import { installVisibility, setVisibility } from './support/visibility';

installVisibility();

beforeEach(() => {
  jest.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

function section(container: HTMLElement): HTMLElement {
  return container.querySelector('section') as HTMLElement;
}

function statusText(container: HTMLElement): string {
  return (container.querySelector('.upiqr-status') as HTMLElement).textContent || '';
}

function tap(link: Element) {
  act(() => {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

// Keep jsdom from trying to navigate to upi:// or intent:// links.
beforeAll(() => {
  document.addEventListener('click', (event) => event.preventDefault());
});

describe('finding 1: timing props that change after a final state', () => {
  it('shows Paid and calls onPaid once when expiresInSeconds is computed on every render', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'paid');
    const onPaid = jest.fn();
    const expiresAt = Date.now() + 300000;
    function Checkout() {
      const [paid, setPaid] = React.useState(0);
      return (
        <>
          {paid > 0 ? <p>Thanks</p> : null}
          <PayWithUpi
            deviceKind="desktop"
            params={params}
            confirmPayment={confirmPayment}
            expiresInSeconds={Math.ceil((expiresAt - Date.now()) / 1000)}
            onPaid={() => {
              onPaid();
              setPaid((n) => n + 1);
            }}
          />
        </>
      );
    }
    const { container } = render(<Checkout />);
    for (let second = 0; second < 30; second++) await advance(1000);
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    expect(statusText(container)).toBe('Paid');
    expect(section(container).className).toContain('upiqr--paid');
  });

  it('keeps every final state when all timing props change', async () => {
    for (const final of ['paid', 'failed'] as const) {
      const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => final);
      const props = { deviceKind: 'desktop' as const, params, confirmPayment };
      const { container, rerender, unmount } = render(<PayWithUpi {...props} pollIntervalMs={1000} />);
      await advance(1000);
      expect(section(container).className).toContain(`upiqr--${final}`);
      rerender(<PayWithUpi {...props} pollIntervalMs={2000} maxPollIntervalMs={9000} expiresInSeconds={30} />);
      await advance(60000);
      expect(section(container).className).toContain(`upiqr--${final}`);
      expect(confirmPayment).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('keeps expired when timing props change', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'pending');
    const onExpired = jest.fn();
    const props = { deviceKind: 'desktop' as const, params, confirmPayment, onExpired };
    const { container, rerender } = render(<PayWithUpi {...props} expiresInSeconds={2} pollIntervalMs={10000} />);
    await advance(2000);
    expect(section(container).className).toContain('upiqr--expired');
    const calls = confirmPayment.mock.calls.length;
    rerender(<PayWithUpi {...props} expiresInSeconds={3} pollIntervalMs={500} />);
    await advance(60000);
    expect(section(container).className).toContain('upiqr--expired');
    expect(confirmPayment).toHaveBeenCalledTimes(calls);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('applies a new expiresInSeconds to the next session, after Try again', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'pending');
    const props = { deviceKind: 'desktop' as const, params, confirmPayment, pollIntervalMs: 100000 };
    const { container, rerender, getByRole, getByText } = render(<PayWithUpi {...props} expiresInSeconds={2} />);
    await advance(2000);
    expect(section(container).className).toContain('upiqr--expired');
    rerender(<PayWithUpi {...props} expiresInSeconds={90} />);
    act(() => getByRole('button', { name: 'Try again' }).click());
    expect(getByText('Expires in 1:30')).toBeTruthy();
  });
});

describe('finding 3: timing props that change while waiting', () => {
  it('keeps waiting on a phone and goes on checking with the new interval', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'pending');
    const props = { deviceKind: 'android' as const, params, confirmPayment };
    const { container, rerender } = render(<PayWithUpi {...props} pollIntervalMs={3000} />);
    tap(container.querySelector('a.upiqr-button--primary')!);
    expect(section(container).className).toContain('upiqr--waiting');
    rerender(<PayWithUpi {...props} pollIntervalMs={2000} />);
    expect(section(container).className).toContain('upiqr--waiting');
    // The check scheduled before the change still runs after 3 s.
    await advance(3000);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    // The next one uses the new base interval: 2000 * 1.5.
    await advance(2999);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(confirmPayment).toHaveBeenCalledTimes(2);
    expect(section(container).className).toContain('upiqr--waiting');
  });

  it('keeps the deadline when expiresInSeconds changes while waiting', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'pending');
    const options = (expiresInSeconds: number): UseUpiPaymentOptions => ({
      params,
      confirmPayment,
      autoStart: true,
      expiresInSeconds,
      pollIntervalMs: 100000,
    });
    const hook = renderHook((props: { expires: number }) => useUpiPayment(options(props.expires)), {
      initialProps: { expires: 60 },
    });
    await advance(10000);
    hook.rerender({ expires: 300 });
    expect(hook.result.current.status).toBe('waiting');
    expect(hook.result.current.secondsLeft).toBe(50);
  });
});

describe('finding 4: params that become invalid mid-session', () => {
  it('stops checking and shows only the invalid state', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'pending');
    const { container, rerender } = render(
      <PayWithUpi deviceKind="desktop" params={params} confirmPayment={confirmPayment} />,
    );
    await advance(100);
    expect(section(container).className).toContain('upiqr--waiting');
    rerender(<PayWithUpi deviceKind="desktop" params={{ ...params, amount: '0' }} confirmPayment={confirmPayment} />);
    const before = confirmPayment.mock.calls.length;
    await advance(60000);
    expect(confirmPayment).toHaveBeenCalledTimes(before);
    expect(section(container).className).not.toContain('upiqr--waiting');
    expect(statusText(container)).toBe('');
    expect(container.querySelector('.upiqr-countdown')).toBeNull();
    expect(container.querySelector('[role=alert]')!.textContent).toContain('This payment request is not valid.');
  });

  it('aborts the check in flight in the hook', async () => {
    const signals: AbortSignal[] = [];
    const confirmPayment = (context: ConfirmPaymentContext) => {
      signals.push(context.signal!);
      return new Promise<PaymentCheckResult>(() => undefined);
    };
    const hook = renderHook((props: { params: UpiPaymentParams }) =>
      useUpiPayment({ params: props.params, confirmPayment, autoStart: true, pollIntervalMs: 1000 }),
      { initialProps: { params } },
    );
    await advance(1000);
    expect(signals).toHaveLength(1);
    hook.rerender({ params: { ...params, payeeVpa: 'nope' } });
    expect(hook.result.current.status).toBe('idle');
    expect(signals[0].aborted).toBe(true);
  });
});

describe('finding 5: payment params that change mid-session', () => {
  it('starts a new session with a fresh deadline when the amount changes', async () => {
    const attempts: number[] = [];
    const signals: AbortSignal[] = [];
    const confirmPayment = jest.fn(
      (context: ConfirmPaymentContext) =>
        new Promise<PaymentCheckResult>((resolve) => {
          attempts.push(context.attempt);
          signals.push(context.signal!);
          setTimeout(() => resolve('pending'), 10);
        }),
    );
    const props = { deviceKind: 'desktop' as const, confirmPayment, expiresInSeconds: 60 };
    const { container, rerender } = render(<PayWithUpi {...props} params={params} />);
    await advance(50000);
    rerender(<PayWithUpi {...props} params={{ ...params, amount: '999.00' }} />);
    await advance(10);
    expect(container.querySelector('.upiqr-countdown')!.textContent).toBe('Expires in 1:00');
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toContain('₹999.00');
    await advance(15000);
    expect(section(container).className).toContain('upiqr--waiting');
    const firstOfNewSession = attempts.lastIndexOf(1);
    expect(firstOfNewSession).toBeGreaterThan(0);
  });

  it('aborts the check in flight when the transaction reference changes', async () => {
    const signals: AbortSignal[] = [];
    const confirmPayment = (context: ConfirmPaymentContext) => {
      signals.push(context.signal!);
      return new Promise<PaymentCheckResult>(() => undefined);
    };
    const hook = renderHook((props: { params: UpiPaymentParams }) =>
      useUpiPayment({ params: props.params, confirmPayment, autoStart: true, pollIntervalMs: 1000, expiresInSeconds: 60 }),
      { initialProps: { params } },
    );
    await advance(1000);
    hook.rerender({ params: { ...params, transactionRef: 'ORDER43' } });
    expect(signals[0].aborted).toBe(true);
    expect(hook.result.current.status).toBe('waiting');
    expect(hook.result.current.secondsLeft).toBe(60);
  });

  it('does not restart after paid when the params change', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'paid');
    const onPaid = jest.fn();
    const props = { deviceKind: 'desktop' as const, confirmPayment, onPaid };
    const { container, rerender } = render(<PayWithUpi {...props} params={params} />);
    await advance(3000);
    expect(statusText(container)).toBe('Paid');
    rerender(<PayWithUpi {...props} params={{ ...params, amount: '1.00' }} />);
    await advance(60000);
    expect(statusText(container)).toBe('Paid');
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('keeps the session for a new params object with the same values', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'pending');
    const hook = renderHook((props: { params: UpiPaymentParams }) =>
      useUpiPayment({ params: props.params, confirmPayment, autoStart: true, pollIntervalMs: 100000, expiresInSeconds: 60 }),
      { initialProps: { params } },
    );
    await advance(10000);
    hook.rerender({ params: { ...params } });
    expect(hook.result.current.secondsLeft).toBe(50);
  });
});

describe('finding 7: focus on a final state', () => {
  it('moves focus to the status message when the focused link disappears', async () => {
    let paid = false;
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => (paid ? 'paid' : 'pending'));
    const { container } = render(<PayWithUpi deviceKind="android" params={params} confirmPayment={confirmPayment} />);
    const link = container.querySelector('a.upiqr-button--primary') as HTMLElement;
    link.focus();
    tap(link);
    paid = true;
    await advance(4000);
    expect(statusText(container)).toBe('Paid');
    const status = container.querySelector('.upiqr-status') as HTMLElement;
    expect(document.activeElement).toBe(status);
    expect(status.getAttribute('tabindex')).toBe('-1');
  });

  it('leaves focus alone when it is outside the component', async () => {
    const confirmPayment = jest.fn(async (): Promise<PaymentCheckResult> => 'paid');
    const { container, getByText } = render(
      <>
        <button type="button">Elsewhere</button>
        <PayWithUpi deviceKind="desktop" params={params} confirmPayment={confirmPayment} />
      </>,
    );
    const elsewhere = getByText('Elsewhere');
    elsewhere.focus();
    await advance(3000);
    expect(statusText(container)).toBe('Paid');
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('finding 15: expiresInSeconds that is not a positive number', () => {
  it.each([0, -5, NaN])('uses the documented default of 300 s for %p and warns in development', async (value) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hook = renderHook(() =>
      useUpiPayment({ params, confirmPayment: async () => 'pending', autoStart: true, expiresInSeconds: value }),
    );
    await advance(10);
    expect(hook.result.current.secondsLeft).toBe(300);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/expiresInSeconds/);
    hook.rerender();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn for valid or missing values', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderHook(() => useUpiPayment({ params, confirmPayment: async () => 'pending', autoStart: true }));
    renderHook(() => useUpiPayment({ params, confirmPayment: async () => 'pending', expiresInSeconds: 1 }));
    await advance(10);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('finding 2 and 8 through the hook', () => {
  it('expires on time when confirmPayment never settles', async () => {
    const onExpired = jest.fn();
    const confirmPayment = jest.fn(() => new Promise<PaymentCheckResult>(() => undefined));
    const hook = renderHook(() =>
      useUpiPayment({ params, confirmPayment, autoStart: true, expiresInSeconds: 10, pollIntervalMs: 1000, onExpired }),
    );
    await advance(10000);
    expect(hook.result.current.status).toBe('expired');
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('retries after a check times out (checkTimeoutMs)', async () => {
    const confirmPayment = jest.fn(() => new Promise<PaymentCheckResult>(() => undefined));
    const hook = renderHook(() =>
      useUpiPayment({ params, confirmPayment, autoStart: true, pollIntervalMs: 1000, checkTimeoutMs: 500 }),
    );
    await advance(1500);
    expect(hook.result.current.lastCheckError).toBeInstanceOf(Error);
    await advance(1500);
    expect(confirmPayment).toHaveBeenCalledTimes(2);
  });

  it('reports an unexpected answer in lastCheckError', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const confirmPayment = jest.fn(async () => 'success' as unknown as PaymentCheckResult);
    const onExpired = jest.fn();
    const hook = renderHook(() =>
      useUpiPayment({ params, confirmPayment, autoStart: true, pollIntervalMs: 1000, expiresInSeconds: 30, onExpired }),
    );
    await advance(5000);
    expect(hook.result.current.status).toBe('waiting');
    expect(String(hook.result.current.lastCheckError)).toMatch(/"success"/);
  });
});
