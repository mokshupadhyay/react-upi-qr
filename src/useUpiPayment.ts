'use client';
import * as React from 'react';
import { UpiError } from './errors.js';
import { PaymentSession } from './session.js';
import type { PaymentSessionSnapshot } from './session.js';
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
  /** Start waiting as soon as the component mounts. Default `false`. */
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
  /** The last rejection of `confirmPayment`, or `null`. Polling goes on regardless. */
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
};

const INITIAL: PaymentSessionSnapshot = { status: 'idle', secondsLeft: null, lastCheckError: null };

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : fallback;
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
 * Wait for a UPI payment to be confirmed by your server.
 *
 * `start()` moves from `idle` to `waiting`; the hook then calls
 * `confirmPayment` every `pollIntervalMs`, backing off by `backoffFactor` up
 * to `maxPollIntervalMs` while the answer is `pending`, until it gets `paid`
 * or `failed`, or `expiresInSeconds` pass. At the deadline it makes one last
 * check before reporting `expired`.
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

  const expiresInSeconds = positive(options.expiresInSeconds, DEFAULTS.expiresInSeconds);
  const pollIntervalMs = positive(options.pollIntervalMs, DEFAULTS.pollIntervalMs);
  const maxPollIntervalMs = Math.max(pollIntervalMs, positive(options.maxPollIntervalMs, DEFAULTS.maxPollIntervalMs));
  const backoffFactor = Math.max(1, positive(options.backoffFactor, DEFAULTS.backoffFactor));

  React.useEffect(() => {
    // New timing options start a new session.
    setSnapshot(INITIAL);
    const current = new PaymentSession({
      confirmPayment: (context) => latest.current.confirmPayment(context),
      expiresInSeconds,
      pollIntervalMs,
      maxPollIntervalMs,
      backoffFactor,
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
  }, [expiresInSeconds, pollIntervalMs, maxPollIntervalMs, backoffFactor]);

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
