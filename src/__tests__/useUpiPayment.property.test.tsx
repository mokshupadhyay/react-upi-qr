import { act, renderHook } from '@testing-library/react';
import fc from 'fast-check';
import { useUpiPayment } from '../index';
import type { PaymentCheckResult } from '../index';
import { params } from './support/params';
import { installVisibility, setVisibility } from './support/visibility';

type Command =
  | { kind: 'advance'; ms: number }
  | { kind: 'answer'; result: PaymentCheckResult | 'reject' }
  | { kind: 'hide' }
  | { kind: 'show' }
  | { kind: 'checkNow' }
  | { kind: 'unmount' };

const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ kind: fc.constant('advance' as const), ms: fc.integer({ min: 1, max: 20000 }) }),
  fc.record({
    kind: fc.constant('answer' as const),
    result: fc.constantFrom<PaymentCheckResult | 'reject'>('paid', 'pending', 'failed', 'reject'),
  }),
  fc.constant<Command>({ kind: 'hide' }),
  fc.constant<Command>({ kind: 'show' }),
  fc.constant<Command>({ kind: 'checkNow' }),
  fc.constant<Command>({ kind: 'unmount' }),
);

installVisibility();

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('property: confirmPayment is never called after a final state or after unmount', () => {
  it('holds for any sequence of time, answers, visibility changes and unmount', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(command, { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 1, max: 30 }),
        async (commands, pollIntervalMs, expiresInSeconds) => {
          act(() => setVisibility('visible'));
          let finished = false;
          let unmounted = false;
          let violations = 0;
          const pending: Array<{ resolve(result: PaymentCheckResult): void; reject(error: unknown): void }> = [];
          const confirmPayment = () => {
            if (finished || unmounted) violations += 1;
            return new Promise<PaymentCheckResult>((resolve, reject) => pending.push({ resolve, reject }));
          };
          const markFinished = () => {
            finished = true;
          };
          const hook = renderHook(() =>
            useUpiPayment({
              params,
              confirmPayment,
              pollIntervalMs,
              expiresInSeconds,
              autoStart: true,
              onPaid: markFinished,
              onFailed: markFinished,
              onExpired: markFinished,
            }),
          );

          for (const step of commands) {
            switch (step.kind) {
              case 'advance':
                await act(async () => {
                  await jest.advanceTimersByTimeAsync(step.ms);
                });
                break;
              case 'answer': {
                const next = pending.shift();
                if (next) {
                  await act(async () => {
                    if (step.result === 'reject') next.reject(new Error('network'));
                    else next.resolve(step.result);
                  });
                }
                break;
              }
              case 'hide':
                act(() => setVisibility('hidden'));
                break;
              case 'show':
                act(() => setVisibility('visible'));
                break;
              case 'checkNow':
                act(() => hook.result.current.checkNow());
                break;
              case 'unmount':
                if (!unmounted) hook.unmount();
                unmounted = true;
                break;
            }
            if (!unmounted && ['paid', 'failed', 'expired'].indexOf(hook.result.current.status) !== -1) {
              finished = true;
            }
          }
          // Let everything still scheduled run out, then answer every open call.
          await act(async () => {
            await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
          });
          while (pending.length > 0) {
            const next = pending.shift()!;
            await act(async () => next.resolve('pending'));
          }
          if (!unmounted) hook.unmount();
          jest.clearAllTimers();
          return violations === 0;
        },
      ),
      { numRuns: 200 },
    );
  });
});
