import { warnInDevelopment } from './dev.js';
import type { ConfirmPayment, PaymentCheckResult, UpiPaymentStatus } from './types.js';

export interface PaymentSessionSnapshot {
  status: UpiPaymentStatus;
  /** Whole seconds until expiry while `waiting`, otherwise `null`. */
  secondsLeft: number | null;
  /**
   * Why the last check did not give an answer: the rejection of
   * `confirmPayment`, a timeout, or an answer other than `'paid'`,
   * `'pending'` or `'failed'`. Cleared by the next valid answer.
   */
  lastCheckError: unknown;
}

export interface PaymentSessionTiming {
  expiresInSeconds: number;
  pollIntervalMs: number;
  maxPollIntervalMs: number;
  backoffFactor: number;
  /** A check that has not answered after this long is aborted and counts as failed. Default 15000. */
  checkTimeoutMs?: number;
}

export interface PaymentSessionOptions extends PaymentSessionTiming {
  confirmPayment: ConfirmPayment;
  onChange(snapshot: PaymentSessionSnapshot): void;
  onFinish(status: 'paid' | 'failed' | 'expired'): void;
  now?: () => number;
}

type Timer = ReturnType<typeof setTimeout>;

const IDLE: PaymentSessionSnapshot = { status: 'idle', secondsLeft: null, lastCheckError: null };

export const DEFAULT_CHECK_TIMEOUT_MS = 15000;

/** The longest delay `setTimeout` accepts; longer ones fire at once. */
const MAX_TIMER_DELAY = 2147483647;

function delay(ms: number): number {
  return Math.min(MAX_TIMER_DELAY, Math.max(0, ms));
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/**
 * The polling state machine behind `useUpiPayment`, free of React.
 *
 * `idle` --start--> `waiting` --paid--> `paid`
 *                             --failed--> `failed`
 *                             --deadline--> `expired`
 *
 * At most one `confirmPayment` call is in flight, and each one is aborted
 * after `checkTimeoutMs`. At the deadline a check still in flight is aborted
 * and the session expires; when none is in flight, one last check is made
 * first, so a payment confirmed in the final seconds still counts.
 *
 * While the page is hidden nothing is scheduled; when it becomes visible
 * again the session checks at once and resumes polling at the base interval.
 *
 * `paid`, `failed` and `expired` are final: only `start()` or `restart()`
 * leave them. After a final state, a `reset()` or `dispose()`,
 * `confirmPayment` is not called again and late answers are ignored.
 * `setTiming()` never changes the state.
 */
export class PaymentSession {
  private readonly options: PaymentSessionOptions;
  private readonly now: () => number;
  private timing: PaymentSessionTiming;
  private snapshot: PaymentSessionSnapshot = IDLE;
  private generation = 0;
  private attempt = 0;
  private deadline = 0;
  private interval = 0;
  private inFlight = false;
  private finalCheck = false;
  private hidden = false;
  private disposed = false;
  private warnedAnswer = false;
  private abort: AbortController | null = null;
  private pollTimer: Timer | null = null;
  private deadlineTimer: Timer | null = null;
  private tickTimer: Timer | null = null;
  private checkTimer: Timer | null = null;

  constructor(options: PaymentSessionOptions) {
    this.options = options;
    this.timing = options;
    this.now = options.now || (() => Date.now());
  }

  get state(): PaymentSessionSnapshot {
    return this.snapshot;
  }

  /**
   * New timing for this session. `expiresInSeconds` applies from the next
   * `start()`; the deadline of a session already waiting stays. A new
   * `pollIntervalMs`, `maxPollIntervalMs` or `backoffFactor` applies from the
   * next scheduled check. The status does not change.
   */
  setTiming(timing: PaymentSessionTiming): void {
    const previous = this.timing;
    this.timing = timing;
    if (this.snapshot.status !== 'waiting') return;
    if (timing.pollIntervalMs !== previous.pollIntervalMs) this.interval = timing.pollIntervalMs;
    this.interval = Math.min(this.interval, timing.maxPollIntervalMs);
  }

  /** Start waiting for the payment. Does nothing while already waiting. */
  start(): void {
    if (this.disposed || this.snapshot.status === 'waiting') return;
    this.cancel();
    this.attempt = 0;
    this.interval = this.timing.pollIntervalMs;
    this.deadline = this.now() + this.timing.expiresInSeconds * 1000;
    this.update({ status: 'waiting', secondsLeft: this.secondsLeft(), lastCheckError: null });
    this.arm();
  }

  /** End the current session, whatever its state, and start a new one with a fresh deadline. */
  restart(): void {
    if (this.disposed) return;
    this.cancel();
    this.snapshot = IDLE;
    this.start();
  }

  /** Back to `idle`, dropping any answer still on its way. */
  reset(): void {
    if (this.disposed) return;
    this.cancel();
    this.update(IDLE);
  }

  /** Check now instead of waiting for the next poll. Ignored unless waiting. */
  checkNow(): void {
    if (!this.canCheck()) return;
    this.clearPoll();
    this.check();
  }

  /** Tell the session whether the page is hidden (`document.visibilityState`). */
  setHidden(hidden: boolean): void {
    if (this.disposed || hidden === this.hidden) return;
    this.hidden = hidden;
    if (this.snapshot.status !== 'waiting') return;
    if (hidden) {
      this.clearTimers();
      return;
    }
    this.interval = this.timing.pollIntervalMs;
    this.update({ ...this.snapshot, secondsLeft: this.secondsLeft() });
    if (this.now() >= this.deadline) {
      // The deadline passed while hidden.
      this.onDeadline();
      return;
    }
    this.arm();
    // Back from the UPI app, or from another tab: ask straight away.
    this.check();
  }

  /** Stop for good. Called on unmount. */
  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  private canCheck(): boolean {
    return !this.disposed && this.snapshot.status === 'waiting' && !this.inFlight && !this.hidden;
  }

  private check(): void {
    if (!this.canCheck()) return;
    const generation = this.generation;
    this.inFlight = true;
    this.finalCheck = this.now() >= this.deadline;
    this.attempt += 1;
    this.abort = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = this.timing.checkTimeoutMs || DEFAULT_CHECK_TIMEOUT_MS;
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (this.abort) this.abort.abort();
      this.settle(generation, 'pending', new Error(`confirmPayment did not answer within ${timeout} ms.`));
    }, delay(timeout));
    let answer: Promise<unknown>;
    try {
      answer = Promise.resolve(
        this.options.confirmPayment({ attempt: this.attempt, signal: this.abort ? this.abort.signal : undefined }),
      );
    } catch (error) {
      answer = Promise.reject(error);
    }
    answer.then(
      (result) => this.answer(generation, result),
      (error: unknown) => this.settle(generation, 'pending', error == null ? new Error('confirmPayment failed.') : error),
    );
  }

  private answer(generation: number, result: unknown): void {
    if (result === 'paid' || result === 'pending' || result === 'failed') {
      this.settle(generation, result, null);
      return;
    }
    if (this.disposed || generation !== this.generation) return;
    const message =
      `confirmPayment resolved to ${describeValue(result)}; expected 'paid', 'pending' or 'failed'. ` +
      'The answer was counted as a failed check.';
    if (!this.warnedAnswer) {
      this.warnedAnswer = true;
      warnInDevelopment(message);
    }
    this.settle(generation, 'pending', new Error(message));
  }

  private settle(generation: number, result: PaymentCheckResult, error: unknown): void {
    // A timeout, reset, restart or dispose happened while this check was in flight.
    if (this.disposed || generation !== this.generation || !this.inFlight) return;
    this.endCheck();
    if (result === 'paid' || result === 'failed') {
      this.finish(result);
      return;
    }
    if (this.finalCheck || this.now() >= this.deadline) {
      this.finish('expired', error);
      return;
    }
    this.update({ ...this.snapshot, lastCheckError: error });
    this.interval = Math.min(this.interval * this.timing.backoffFactor, this.timing.maxPollIntervalMs);
    this.schedulePoll(this.interval);
  }

  /** Forget the check in flight: its answer, if it still comes, is ignored. */
  private endCheck(): void {
    this.generation += 1;
    this.inFlight = false;
    this.finalCheck = false;
    this.abort = null;
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = null;
  }

  private finish(status: 'paid' | 'failed' | 'expired', error: unknown = null): void {
    this.cancel();
    this.update({ status, secondsLeft: null, lastCheckError: error });
    this.options.onFinish(status);
  }

  /** Timers for the next poll, the deadline and the countdown. */
  private arm(): void {
    if (this.hidden) return;
    this.schedulePoll(this.interval);
    this.scheduleDeadline();
    this.scheduleTick();
  }

  private scheduleDeadline(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    // Long deadlines are reached in steps of at most MAX_TIMER_DELAY.
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      if (this.now() < this.deadline) this.scheduleDeadline();
      else this.onDeadline();
    }, delay(this.deadline - this.now()));
  }

  private onDeadline(): void {
    if (this.disposed || this.snapshot.status !== 'waiting' || this.hidden) return;
    if (this.inFlight) {
      // The last check is bounded by its own timeout.
      if (this.finalCheck) return;
      // A check started before the deadline does not hold expiry back.
      if (this.abort) this.abort.abort();
      this.finish('expired', this.snapshot.lastCheckError);
      return;
    }
    // One last check, so a payment made in the final seconds still counts.
    this.clearPoll();
    this.check();
  }

  private schedulePoll(ms: number): void {
    this.clearPoll();
    if (this.hidden || this.snapshot.status !== 'waiting') return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.check();
    }, delay(ms));
  }

  private scheduleTick(): void {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    const left = this.deadline - this.now();
    if (left <= 0) {
      this.tickTimer = null;
      return;
    }
    // Wake on the next whole second, so the countdown never drifts.
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      if (this.snapshot.status !== 'waiting' || this.hidden) return;
      this.update({ ...this.snapshot, secondsLeft: this.secondsLeft() });
      this.scheduleTick();
    }, left % 1000 || 1000);
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.deadline - this.now()) / 1000));
  }

  /** Clear timers, abort the request in flight and forget its answer. */
  private cancel(): void {
    this.clearTimers();
    if (this.abort) this.abort.abort();
    this.endCheck();
  }

  private clearPoll(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private clearTimers(): void {
    this.clearPoll();
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.deadlineTimer = null;
    this.tickTimer = null;
  }

  private update(snapshot: PaymentSessionSnapshot): void {
    this.snapshot = snapshot;
    if (!this.disposed) this.options.onChange(snapshot);
  }
}
