import { act, renderHook } from '@testing-library/react';
import { useUpiPayment } from '../index';
import type { ConfirmPaymentContext, PaymentCheckResult, UseUpiPaymentOptions } from '../index';
import { params } from './support/params';
import { installVisibility, setVisibility } from './support/visibility';

interface Call {
  context: ConfirmPaymentContext;
  at: number;
  resolve(result: PaymentCheckResult): void;
  reject(error: unknown): void;
}

installVisibility();

beforeEach(() => {
  jest.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  jest.useRealTimers();
});

function setup(overrides: Partial<UseUpiPaymentOptions> = {}) {
  const calls: Call[] = [];
  const confirmPayment = jest.fn(
    (context: ConfirmPaymentContext) =>
      new Promise<PaymentCheckResult>((resolve, reject) => {
        calls.push({ context, at: Date.now(), resolve, reject });
      }),
  );
  const onPaid = jest.fn();
  const onFailed = jest.fn();
  const onExpired = jest.fn();
  const startedAt = Date.now();
  const hook = renderHook(() =>
    useUpiPayment({
      params,
      confirmPayment,
      onPaid,
      onFailed,
      onExpired,
      pollIntervalMs: 1000,
      maxPollIntervalMs: 4000,
      backoffFactor: 2,
      expiresInSeconds: 60,
      autoStart: true,
      ...overrides,
    }),
  );
  return { hook, calls, confirmPayment, onPaid, onFailed, onExpired, startedAt };
}

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

const answer = (call: Call, result: PaymentCheckResult) =>
  act(async () => {
    call.resolve(result);
  });

const fail = (call: Call, error: unknown) =>
  act(async () => {
    call.reject(error);
  });

describe('useUpiPayment', () => {
  it('stays idle until started, then waits one interval before the first check', async () => {
    const { hook, calls } = setup({ autoStart: false });
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.url).toMatch(/^upi:\/\/pay\?pa=shop@okbank&/);
    await advance(10000);
    expect(calls).toHaveLength(0);

    act(() => hook.result.current.start());
    expect(hook.result.current.status).toBe('waiting');
    expect(hook.result.current.secondsLeft).toBe(60);
    await advance(999);
    expect(calls).toHaveLength(0);
    await advance(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].context.attempt).toBe(1);
    expect(calls[0].context.signal).toBeDefined();
  });

  it('reaches paid, calls onPaid once and stops polling', async () => {
    const { hook, calls, onPaid, onFailed, onExpired } = setup();
    await advance(1000);
    await answer(calls[0], 'paid');
    expect(hook.result.current.status).toBe('paid');
    expect(hook.result.current.secondsLeft).toBeNull();
    expect(onPaid).toHaveBeenCalledTimes(1);
    await advance(120000);
    expect(calls).toHaveLength(1);
    expect(onFailed).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('reaches failed and calls onFailed', async () => {
    const { hook, calls, onFailed } = setup();
    await advance(1000);
    await answer(calls[0], 'pending');
    await advance(2000);
    await answer(calls[1], 'failed');
    expect(hook.result.current.status).toBe('failed');
    expect(onFailed).toHaveBeenCalledTimes(1);
    await advance(120000);
    expect(calls).toHaveLength(2);
  });

  it('backs off while pending, up to the maximum interval', async () => {
    const { calls, startedAt } = setup({ expiresInSeconds: 600 });
    const answeredAt: number[] = [];
    for (let i = 0; i < 5; i++) {
      while (calls.length <= i) await advance(100);
      await answer(calls[i], 'pending');
      answeredAt.push(Date.now());
    }
    // Delay before each call, measured from the previous answer.
    const delays = calls.map((call, index) => call.at - (index === 0 ? startedAt : answeredAt[index - 1]));
    expect(delays).toEqual([1000, 2000, 4000, 4000, 4000]);
  });

  it('never has two checks in flight', async () => {
    const { calls } = setup();
    await advance(60000 * 5);
    expect(calls).toHaveLength(1);
  });

  it('keeps polling after a rejection and exposes the error', async () => {
    const { hook, calls } = setup();
    await advance(1000);
    const error = new Error('offline');
    await fail(calls[0], error);
    expect(hook.result.current.status).toBe('waiting');
    expect(hook.result.current.lastCheckError).toBe(error);
    await advance(2000);
    expect(calls).toHaveLength(2);
    await answer(calls[1], 'pending');
    expect(hook.result.current.lastCheckError).toBeNull();
  });

  it('counts down and expires after one last check', async () => {
    const { hook, calls, onExpired } = setup({ expiresInSeconds: 5, pollIntervalMs: 10000, maxPollIntervalMs: 10000 });
    expect(hook.result.current.secondsLeft).toBe(5);
    await advance(1000);
    expect(hook.result.current.secondsLeft).toBe(4);
    await advance(3000);
    expect(hook.result.current.secondsLeft).toBe(1);
    expect(calls).toHaveLength(0);
    await advance(1000);
    // The deadline triggers a final check instead of expiring blindly.
    expect(calls).toHaveLength(1);
    expect(hook.result.current.status).toBe('waiting');
    expect(hook.result.current.secondsLeft).toBe(0);
    await answer(calls[0], 'pending');
    expect(hook.result.current.status).toBe('expired');
    expect(onExpired).toHaveBeenCalledTimes(1);
    await advance(60000);
    expect(calls).toHaveLength(1);
  });

  it('counts a payment confirmed by the last check at the deadline', async () => {
    const { hook, calls, onPaid, onExpired } = setup({ expiresInSeconds: 3, pollIntervalMs: 10000 });
    await advance(3000);
    await answer(calls[0], 'paid');
    expect(hook.result.current.status).toBe('paid');
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('expires when a check in flight at the deadline answers pending', async () => {
    const { hook, calls } = setup({ expiresInSeconds: 2 });
    await advance(1000);
    expect(calls).toHaveLength(1);
    await advance(5000);
    expect(calls).toHaveLength(1);
    await answer(calls[0], 'pending');
    expect(hook.result.current.status).toBe('expired');
  });

  it('pauses while the tab is hidden and checks at once when visible again', async () => {
    const { hook, calls } = setup();
    await advance(1000);
    await answer(calls[0], 'pending');
    act(() => setVisibility('hidden'));
    await advance(30000);
    expect(calls).toHaveLength(1);
    expect(hook.result.current.status).toBe('waiting');

    act(() => setVisibility('visible'));
    expect(calls).toHaveLength(2);
    // Back to the base interval after the immediate check.
    await answer(calls[1], 'pending');
    await advance(2000);
    expect(calls).toHaveLength(3);
  });

  it('does not start polling while the tab is hidden at mount', async () => {
    setVisibility('hidden');
    const { calls } = setup();
    await advance(30000);
    expect(calls).toHaveLength(0);
    act(() => setVisibility('visible'));
    expect(calls).toHaveLength(1);
  });

  it('expires on return when the deadline passed while hidden, after one last check', async () => {
    const { hook, calls, onExpired } = setup({ expiresInSeconds: 10 });
    act(() => setVisibility('hidden'));
    await advance(60000);
    expect(calls).toHaveLength(0);
    expect(onExpired).not.toHaveBeenCalled();
    act(() => setVisibility('visible'));
    expect(calls).toHaveLength(1);
    await answer(calls[0], 'pending');
    expect(hook.result.current.status).toBe('expired');
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('does not poll after unmount and ignores late answers', async () => {
    const { hook, calls, onPaid } = setup();
    await advance(1000);
    const signal = calls[0].context.signal!;
    hook.unmount();
    expect(signal.aborted).toBe(true);
    await answer(calls[0], 'paid');
    expect(onPaid).not.toHaveBeenCalled();
    await advance(120000);
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(calls).toHaveLength(1);
  });

  it('ignores an answer that arrives after reset', async () => {
    const { hook, calls, onPaid } = setup();
    await advance(1000);
    act(() => hook.result.current.reset());
    expect(hook.result.current.status).toBe('idle');
    await answer(calls[0], 'paid');
    expect(hook.result.current.status).toBe('idle');
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('checks immediately on checkNow', async () => {
    const { calls, hook } = setup();
    act(() => hook.result.current.checkNow());
    expect(calls).toHaveLength(1);
    act(() => hook.result.current.checkNow());
    expect(calls).toHaveLength(1);
  });

  it('starts again from a final state', async () => {
    const { hook, calls } = setup({ expiresInSeconds: 1 });
    await advance(1000);
    await answer(calls[0], 'pending');
    expect(hook.result.current.status).toBe('expired');
    act(() => hook.result.current.start());
    expect(hook.result.current.status).toBe('waiting');
    await advance(1000);
    expect(calls).toHaveLength(2);
    expect(calls[1].context.attempt).toBe(1);
  });

  it('reports invalid params and refuses to start', async () => {
    const { hook, calls } = setup({ params: { ...params, amount: '0' } });
    expect(hook.result.current.url).toBeNull();
    expect(hook.result.current.problems.map((problem) => problem.code)).toEqual(['INVALID_AMOUNT']);
    expect(hook.result.current.status).toBe('idle');
    act(() => hook.result.current.start());
    await advance(10000);
    expect(hook.result.current.status).toBe('idle');
    expect(calls).toHaveLength(0);
  });

  it('treats a confirmPayment that throws synchronously as a failed check', async () => {
    const confirmPayment = jest.fn((): Promise<PaymentCheckResult> => {
      throw new Error('boom');
    });
    const hook = renderHook(() => useUpiPayment({ params, confirmPayment, autoStart: true, pollIntervalMs: 1000 }));
    await advance(1000);
    expect(hook.result.current.status).toBe('waiting');
    expect(hook.result.current.lastCheckError).toEqual(new Error('boom'));
  });

  it('uses the latest confirmPayment and callbacks without restarting', async () => {
    const first = jest.fn(async (): Promise<PaymentCheckResult> => 'pending');
    const second = jest.fn(async (): Promise<PaymentCheckResult> => 'paid');
    const onPaid = jest.fn();
    const hook = renderHook((props: { confirm: () => Promise<PaymentCheckResult> }) =>
      useUpiPayment({ params: { ...params }, confirmPayment: props.confirm, onPaid, autoStart: true, pollIntervalMs: 1000 }),
      { initialProps: { confirm: first } },
    );
    await advance(1000);
    hook.rerender({ confirm: second });
    expect(hook.result.current.status).toBe('waiting');
    await advance(1500);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('paid');
    expect(onPaid).toHaveBeenCalledTimes(1);
  });
});
