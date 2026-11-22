import { PaymentSession } from '../session';
import type { PaymentSessionOptions, PaymentSessionSnapshot } from '../session';
import type { ConfirmPaymentContext, PaymentCheckResult } from '../types';

interface Call {
  context: ConfirmPaymentContext;
  resolve(result: unknown): void;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function make(overrides: Partial<PaymentSessionOptions> = {}) {
  const calls: Call[] = [];
  const finished: string[] = [];
  let snapshot: PaymentSessionSnapshot = { status: 'idle', secondsLeft: null, lastCheckError: null };
  const session = new PaymentSession({
    confirmPayment: (context) =>
      new Promise<PaymentCheckResult>((resolve) => {
        calls.push({ context, resolve: resolve as (result: unknown) => void });
      }),
    expiresInSeconds: 60,
    pollIntervalMs: 1000,
    maxPollIntervalMs: 4000,
    backoffFactor: 2,
    checkTimeoutMs: 2000,
    onChange: (next) => {
      snapshot = next;
    },
    onFinish: (status) => finished.push(status),
    ...overrides,
  });
  return { session, calls, finished, snapshot: () => snapshot };
}

const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

describe('PaymentSession: a confirmPayment that never settles', () => {
  it('expires at the deadline and aborts the check in flight', async () => {
    const { session, calls, finished, snapshot } = make({ expiresInSeconds: 10, checkTimeoutMs: 60000 });
    session.start();
    await advance(1000);
    expect(calls).toHaveLength(1);
    await advance(9000);
    expect(snapshot().status).toBe('expired');
    expect(finished).toEqual(['expired']);
    expect(calls[0].context.signal!.aborted).toBe(true);
    await advance(60 * 60 * 1000);
    expect(calls).toHaveLength(1);
    expect(finished).toEqual(['expired']);
  });

  it('aborts a check after checkTimeoutMs, counts it as failed, backs off and retries', async () => {
    const { session, calls, snapshot } = make({ checkTimeoutMs: 2000 });
    session.start();
    await advance(1000);
    expect(calls).toHaveLength(1);
    await advance(1999);
    expect(calls[0].context.signal!.aborted).toBe(false);
    await advance(1);
    expect(calls[0].context.signal!.aborted).toBe(true);
    expect(snapshot().status).toBe('waiting');
    expect(String(snapshot().lastCheckError)).toMatch(/did not answer within 2000 ms/);
    // Backoff as after any failed check: 1000 * 2.
    await advance(1999);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].context.attempt).toBe(2);
  });

  it('ignores the late answer of a check that timed out', async () => {
    const { session, calls, finished, snapshot } = make({ checkTimeoutMs: 2000 });
    session.start();
    await advance(3000);
    calls[0].resolve('paid');
    await advance(0);
    expect(snapshot().status).toBe('waiting');
    expect(finished).toEqual([]);
  });

  it('expires when the last check at the deadline times out', async () => {
    const { session, calls, finished, snapshot } = make({
      expiresInSeconds: 5,
      pollIntervalMs: 10000,
      maxPollIntervalMs: 10000,
      checkTimeoutMs: 2000,
    });
    session.start();
    await advance(5000);
    expect(calls).toHaveLength(1);
    expect(snapshot().status).toBe('waiting');
    await advance(2000);
    expect(snapshot().status).toBe('expired');
    expect(finished).toEqual(['expired']);
    expect(calls[0].context.signal!.aborted).toBe(true);
  });

  it('uses a 15 second check timeout by default', async () => {
    const { session, calls } = make({ checkTimeoutMs: undefined, expiresInSeconds: 600 });
    session.start();
    await advance(1000);
    await advance(14999);
    expect(calls[0].context.signal!.aborted).toBe(false);
    await advance(1);
    expect(calls[0].context.signal!.aborted).toBe(true);
  });
});

describe('PaymentSession: answers other than paid, pending and failed', () => {
  it('counts them as failed checks, sets lastCheckError and warns once', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session, calls, finished, snapshot } = make();
    session.start();
    await advance(1000);
    calls[0].resolve('success');
    await advance(0);
    expect(snapshot().status).toBe('waiting');
    expect(snapshot().lastCheckError).toBeInstanceOf(Error);
    expect(String(snapshot().lastCheckError)).toMatch(/"success"/);
    expect(String(snapshot().lastCheckError)).toMatch(/'paid', 'pending' or 'failed'/);
    // Backed off like a failed check.
    await advance(1999);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
    calls[1].resolve('PAID');
    await advance(0);
    expect(String(snapshot().lastCheckError)).toMatch(/"PAID"/);
    expect(finished).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/confirmPayment/);
  });

  it('does not warn in production', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { session, calls, snapshot } = make();
      session.start();
      await advance(1000);
      calls[0].resolve(undefined);
      await advance(0);
      expect(snapshot().lastCheckError).toBeInstanceOf(Error);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('PaymentSession: long timers', () => {
  const MAX_DELAY = 2147483647;

  it('never passes a delay above 2^31-1 ms to setTimeout, and does not expire early', async () => {
    const spy = jest.spyOn(global, 'setTimeout');
    const { session, finished, snapshot } = make({
      expiresInSeconds: 30 * 24 * 3600,
      pollIntervalMs: 1000,
      maxPollIntervalMs: 4000,
    });
    session.start();
    await advance(300);
    expect(snapshot().status).toBe('waiting');
    expect(snapshot().secondsLeft).toBe(30 * 24 * 3600);
    expect(finished).toEqual([]);
    const delays = spy.mock.calls.map((call) => Number(call[1]));
    expect(delays.length).toBeGreaterThan(0);
    for (const delay of delays) expect(delay).toBeLessThanOrEqual(MAX_DELAY);
    session.dispose();
  });
});
