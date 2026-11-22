'use client';
import * as React from 'react';
import { warnInDevelopment } from './dev.js';
import { UpiError } from './errors.js';
import { DEFAULT_CHECK_TIMEOUT_MS, PaymentSession } from './session.js';
import type { PaymentSessionSnapshot, PaymentSessionTiming } from './session.js';
import type {
  ConfirmPayment,
  UpiPaymentParams,
  UpiPaymentStatus,
  UpiProblem,
  UpiValidationOptions,
} from './types.js';
import { buildUpiUrl } from './url.js';

export interface UseUpiPaymentOptions {
  params: UpiPaymentParams;
  /**
   * Asks your server whether the payment arrived. This is the only source of
   * truth: nothing the browser sees proves a payment.
   */
  confirmPayment: ConfirmPayment;
  /** Seconds from `start()` until the payment is given up as `expired`. Default 300. */
  expiresInSeconds?: number;
  /** Delay before the first check, and the base delay between checks, in ms. Default 3000. */
  pollIntervalMs?: number;
  /** Upper bound for the delay between checks, in ms. Default 15000. */
  maxPollIntervalMs?: number;
  /** Each `pending` answer multiplies the delay by this. Default 1.5. */
  backoffFactor?: number;
  /**
   * A check that has not answered after this many ms is aborted through its
   * `signal` and counts as a failed check (backoff, then retry). Default 15000.
   */
  checkTimeoutMs?: number;
  /**
   * Start waiting as soon as the component mounts, and when `params` become
   * valid while idle. Default `false`.
   */
  autoStart?: boolean;
  /** Override the validation limits used for `params`. */
  validation?: UpiValidationOptions;
  onPaid?: () => void;
  onFailed?: () => void;
  onExpired?: () => void;
}

export interface UseUpiPaymentResult {
  status: UpiPaymentStatus;
  /** The `upi://pay?...` URL, or `null` when `params` are invalid. */
  url: string | null;
  /** Validation problems of `params`; empty when valid. */
  problems: UpiProblem[];
  /** Whole seconds until expiry while `waiting`, otherwise `null`. */
  secondsLeft: number | null;
  /**
   * Why the last check gave no answer: the rejection of `confirmPayment`, a
   * timeout, or an answer other than `'paid'`, `'pending'` or `'failed'`.
   * `null` after a valid answer. Polling goes on regardless.
   */
  lastCheckError: unknown;
  /**
   * Start waiting for the payment (also from a final state, to try again with
   * the same params). Does nothing while waiting, or when `params` are invalid.
   */
  start(): void;
  /** Check now instead of at the next poll. Only while waiting. */
  checkNow(): void;
  /** Back to `idle`, ignoring any answer still on its way. */
  reset(): void;
}

const DEFAULTS = {
  expiresInSeconds: 300,
  pollIntervalMs: 3000,
  maxPollIntervalMs: 15000,
  backoffFactor: 1.5,
  checkTimeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
};

type TimingName = keyof typeof DEFAULTS;

const INITIAL: PaymentSessionSnapshot = { status: 'idle', secondsLeft: null, lastCheckError: null };

function isPositive(value: number | undefined): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function useUpiUrl(
  params: UpiPaymentParams,
  validation: UpiValidationOptions | undefined,
): { url: string | null; problems: UpiProblem[] } {
  const limits = validation && validation.limits;
  const key = JSON.stringify([params, limits || null]);
  // Rebuilt only when a value changes, not on every new params object.
  return React.useMemo(() => {
    try {
      return { url: buildUpiUrl(params, { limits }), problems: [] };
    } catch (error) {
      if (error instanceof UpiError) return { url: null, problems: error.problems };
      throw error;
    }
  }, [key]);
}

/**
 * The timing options with defaults applied. A value that is given but is not
 * a positive finite number is replaced by its default, with one development
 * warning per option and hook.
 */
function useTiming(options: UseUpiPaymentOptions): PaymentSessionTiming & { checkTimeoutMs: number } {
  const warned = React.useRef<{ [name: string]: boolean }>({});
  const pick = (name: TimingName): number => {
    const value = options[name];
    return isPositive(value) ? (value as number) : DEFAULTS[name];
  };
  const invalid = (Object.keys(DEFAULTS) as TimingName[]).filter(
    (name) => options[name] !== undefined && !isPositive(options[name]),
  );
  const invalidKey = invalid.map((name) => `${name}=${String(options[name])}`).join(',');
  React.useEffect(() => {
    for (const name of invalid) {
      if (warned.current[name]) continue;
      warned.current[name] = true;
      warnInDevelopment(
        `${name} must be a positive number of ${name === 'backoffFactor' ? 'times' : name === 'expiresInSeconds' ? 'seconds' : 'ms'}; ` +
          `got ${String(options[name])}. Using the default, ${DEFAULTS[name]}.`,
      );
    }
  }, [invalidKey]);
  const pollIntervalMs = pick('pollIntervalMs');
  return {
    expiresInSeconds: pick('expiresInSeconds'),
    pollIntervalMs,
    maxPollIntervalMs: Math.max(pollIntervalMs, pick('maxPollIntervalMs')),
    backoffFactor: Math.max(1, pick('backoffFactor')),
    checkTimeoutMs: pick('checkTimeoutMs'),
  };
}

/**
 * Wait for a UPI payment to be confirmed by your server.
 *
 * `start()` moves from `idle` to `waiting`; the hook then calls
 * `confirmPayment` every `pollIntervalMs`, backing off by `backoffFactor` up
 * to `maxPollIntervalMs` while the answer is `pending`, until it gets `paid`
 * or `failed`, or `expiresInSeconds` pass. Each check is aborted after
 * `checkTimeoutMs`. At the deadline a check still in flight is aborted; when
 * none is in flight, one last check is made before reporting `expired`.
 *
 * `paid`, `failed` and `expired` are final until `start()` is called. Changing
 * a timing option never changes the status. A change of `params` that changes
 * the URL while waiting starts a new session with a fresh deadline; params
 * that become invalid while waiting stop the session (back to `idle`).
 *
 * Polling pauses while the tab is hidden and resumes with an immediate check
 * when it is visible again. Nothing runs during render, and everything stops
 * on unmount, so the hook is safe in server rendering.
 */
export function useUpiPayment(options: UseUpiPaymentOptions): UseUpiPaymentResult {
  const { url, problems } = useUpiUrl(options.params, options.validation);
  const [snapshot, setSnapshot] = React.useState<PaymentSessionSnapshot>(INITIAL);
  const latest = React.useRef(options);
  latest.current = options;
  const session = React.useRef<PaymentSession | null>(null);
  const valid = url !== null;
  const validRef = React.useRef(valid);
  validRef.current = valid;
  const timing = useTiming(options);
  const timingRef = React.useRef(timing);
  timingRef.current = timing;

  // One session for the life of the component. Timing and params changes are
  // applied to it below; they never replace it.
  React.useEffect(() => {
    setSnapshot(INITIAL);
    const current = new PaymentSession({
      confirmPayment: (context) => latest.current.confirmPayment(context),
      ...timingRef.current,
      onChange: setSnapshot,
      onFinish: (status) => {
        const callbacks = latest.current;
        const callback =
          status === 'paid' ? callbacks.onPaid : status === 'failed' ? callbacks.onFailed : callbacks.onExpired;
        if (callback) callback();
      },
    });
    session.current = current;
    current.setHidden(isHidden());
    if (latest.current.autoStart && validRef.current) current.start();

    const onVisibility = () => current.setHidden(isHidden());
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      current.dispose();
      if (session.current === current) session.current = null;
    };
  }, []);

  const { expiresInSeconds, pollIntervalMs, maxPollIntervalMs, backoffFactor, checkTimeoutMs } = timing;
  React.useEffect(() => {
    if (session.current) session.current.setTiming(timingRef.current);
  }, [expiresInSeconds, pollIntervalMs, maxPollIntervalMs, backoffFactor, checkTimeoutMs]);

  const seenUrl = React.useRef(url);
  React.useEffect(() => {
    if (seenUrl.current === url) return;
    seenUrl.current = url;
    const current = session.current;
    if (!current) return;
    const status = current.state.status;
    if (url === null) {
      // Do not go on asking about a payment request that is no longer valid.
      if (status === 'waiting') current.reset();
    } else if (status === 'waiting') {
      // A different payment: new session, fresh deadline.
      current.restart();
    } else if (status === 'idle' && latest.current.autoStart) {
      current.start();
    }
    // Final states stay final.
  }, [url]);

  const start = React.useCallback(() => {
    if (session.current && validRef.current) session.current.start();
  }, []);
  const checkNow = React.useCallback(() => {
    if (session.current) session.current.checkNow();
  }, []);
  const reset = React.useCallback(() => {
    if (session.current) session.current.reset();
  }, []);

  return {
    status: snapshot.status,
    url,
    problems,
    secondsLeft: snapshot.secondsLeft,
    lastCheckError: snapshot.lastCheckError,
    start,
    checkNow,
    reset,
  };
}
