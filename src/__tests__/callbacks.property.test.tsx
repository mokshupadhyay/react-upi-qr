import * as React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import fc from 'fast-check';
import { PayWithUpi } from '../index';
import type { PaymentCheckResult, UpiPaymentParams } from '../index';
import { params } from './support/params';
import { installVisibility, setVisibility } from './support/visibility';

interface Timing {
  expiresInSeconds?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
}

type Command =
  | { kind: 'advance'; ms: number }
  | { kind: 'answer'; result: PaymentCheckResult | 'reject' }
  | { kind: 'timing'; timing: Timing }
  | { kind: 'params'; which: number }
  | { kind: 'hide' }
  | { kind: 'show' };

const variants: UpiPaymentParams[] = [
  params,
  { ...params, amount: '1.00' },
  { ...params, transactionRef: 'ORDER43' },
  { ...params, amount: '0' }, // invalid
];

const timing: fc.Arbitrary<Timing> = fc.record(
  {
    expiresInSeconds: fc.integer({ min: -5, max: 600 }),
    pollIntervalMs: fc.integer({ min: 50, max: 5000 }),
    maxPollIntervalMs: fc.integer({ min: 50, max: 20000 }),
  },
  { requiredKeys: [] },
);

const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ kind: fc.constant('advance' as const), ms: fc.integer({ min: 1, max: 20000 }) }),
  fc.record({
    kind: fc.constant('answer' as const),
    result: fc.constantFrom<PaymentCheckResult | 'reject'>('paid', 'pending', 'failed', 'reject'),
  }),
  fc.record({ kind: fc.constant('timing' as const), timing }),
  fc.record({ kind: fc.constant('params' as const), which: fc.integer({ min: 0, max: variants.length - 1 }) }),
  fc.constant<Command>({ kind: 'hide' }),
  fc.constant<Command>({ kind: 'show' }),
);

installVisibility();

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const FINAL = ['paid', 'failed', 'expired'];

describe('property: onPaid, onFailed and onExpired fire at most once, and a final state stays final', () => {
  it('holds across random timing and params changes, answers, time and visibility', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(command, { minLength: 1, maxLength: 30 }),
        fc.boolean(),
        async (commands, expiresFromClock) => {
          act(() => setVisibility('visible'));
          const pending: Array<{ resolve(result: PaymentCheckResult): void; reject(error: unknown): void }> = [];
          let checks = 0;
          const confirmPayment = () => {
            checks += 1;
            return new Promise<PaymentCheckResult>((resolve, reject) => pending.push({ resolve, reject }));
          };
          const finals: string[] = [];
          const expiresAt = Date.now() + 120000;

          let setOuter: ((next: { timing: Timing; params: UpiPaymentParams }) => void) | null = null;
          function Checkout() {
            const [state, setState] = React.useState<{ timing: Timing; params: UpiPaymentParams }>({
              timing: {},
              params,
            });
            const [, force] = React.useState(0);
            setOuter = setState;
            // Callbacks that re-render the parent, as an app that navigates or shows a toast would.
            const record = (status: string) => () => {
              finals.push(status);
              force((n) => n + 1);
            };
            return (
              <PayWithUpi
                deviceKind="desktop"
                params={state.params}
                confirmPayment={confirmPayment}
                {...state.timing}
                expiresInSeconds={
                  expiresFromClock ? Math.ceil((expiresAt - Date.now()) / 1000) : state.timing.expiresInSeconds
                }
                onPaid={record('paid')}
                onFailed={record('failed')}
                onExpired={record('expired')}
              />
            );
          }

          const { container, unmount } = render(<Checkout />);
          const statusOf = () => {
            const match = /upiqr--(idle|waiting|paid|failed|expired)/.exec(
              (container.querySelector('section') as HTMLElement).className,
            );
            return match ? match[1] : '';
          };
          let current: { timing: Timing; params: UpiPaymentParams } = { timing: {}, params };
          let finalSeen: string | null = null;
          let checksAtFinal = 0;
          let ok = true;

          try {
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
                case 'timing':
                  current = { ...current, timing: step.timing };
                  act(() => setOuter!(current));
                  break;
                case 'params':
                  current = { ...current, params: variants[step.which] };
                  act(() => setOuter!(current));
                  break;
                case 'hide':
                  act(() => setVisibility('hidden'));
                  break;
                case 'show':
                  act(() => setVisibility('visible'));
                  break;
              }
              const status = statusOf();
              if (finalSeen === null && FINAL.indexOf(status) !== -1) {
                finalSeen = status;
                checksAtFinal = checks;
              }
              if (finalSeen !== null) {
                // Terminal: same state, no new checks, exactly one callback, for that state.
                if (status !== finalSeen || checks !== checksAtFinal) ok = false;
                if (finals.length !== 1 || finals[0] !== finalSeen) ok = false;
              } else if (finals.length !== 0) {
                ok = false;
              }
              if (!ok) break;
            }
            await act(async () => {
              await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
            });
            if (finals.length > 1) ok = false;
            if (finalSeen !== null && (statusOf() !== finalSeen || checks !== checksAtFinal)) ok = false;
          } finally {
            unmount();
            cleanup();
            jest.clearAllTimers();
          }
          return ok;
        },
      ),
      { numRuns: 150 },
    );
  });
});
