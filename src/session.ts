import type { ConfirmPayment, PaymentCheckResult, UpiPaymentStatus } from './types.js';

export interface PaymentSessionSnapshot {
  status: UpiPaymentStatus;
  /** Whole seconds until expiry while `waiting`, otherwise `null`. */
  secondsLeft: number | null;
  /** The last rejection of `confirmPayment`; cleared by the next answer. */
  lastCheckError: unknown;
}

export interface PaymentSessionOptions {
  confirmPayment: ConfirmPayment;
  expiresInSeconds: number;
  pollIntervalMs: number;
  maxPollIntervalMs: number;
  backoffFactor: number;
  onChange(snapshot: PaymentSessionSnapshot): void;
  onFinish(status: 'paid' | 'failed' | 'expired'): void;
  now?: () => number;
}

type Timer = ReturnType<typeof setTimeout>;

const IDLE: PaymentSessionSnapshot = { status: 'idle', secondsLeft: null, lastCheckError: null };

/**
 * The polling state machine behind `useUpiPayment`, free of React.
 *
 * `idle` --start--> `waiting` --paid--> `paid`
 *                             --failed--> `failed`
 *                             --deadline--> one last check --> `expired`
 *
 * At most one `confirmPayment` call is in flight. While the page is hidden
 * nothing is scheduled; when it becomes visible again the session checks at
 * once and resumes polling at the base interval. After a final state, a
 * `reset()` or `dispose()`, `confirmPayment` is never called again and late
 * answers are ignored.
 */
export class PaymentSession {
  private readonly options: PaymentSessionOptions;
  private readonly now: () => number;
  private snapshot: PaymentSessionSnapshot = IDLE;
  private generation = 0;
  private attempt = 0;
  private deadline = 0;
  private interval = 0;
  private inFlight = false;
  private hidden = false;
  private disposed = false;
  private abort: AbortController | null = null;
  private pollTimer: Timer | null = null;
  private deadlineTimer: Timer | null = null;
  private tickTimer: Timer | null = null;

  constructor(options: PaymentSessionOptions) {
    this.options = options;
    this.now = options.now || (() => Date.now());
  }

  get state(): PaymentSessionSnapshot {
    return this.snapshot;
  }

  /** Start waiting for the payment. Does nothing while already waiting. */
  start(): void {
    if (this.disposed || this.snapshot.status === 'waiting') return;
    this.cancel();
    this.attempt = 0;
    this.interval = this.options.pollIntervalMs;
    this.deadline = this.now() + this.options.expiresInSeconds * 1000;
    this.update({ status: 'waiting', secondsLeft: this.secondsLeft(), lastCheckError: null });
    this.arm();
  }

  /** Back to `idle`, dropping any answer still on its way. */
  reset(): void {
    if (this.disposed) return;
    this.cancel();
    this.update(IDLE);
  }

  /** Check now instead of waiting for the next poll. Ignored unless waiting. */
  checkNow(): void {
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
    this.interval = this.options.pollIntervalMs;
    this.update({ ...this.snapshot, secondsLeft: this.secondsLeft() });
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
    this.attempt += 1;
    this.abort = typeof AbortController === 'function' ? new AbortController() : null;
    let answer: Promise<PaymentCheckResult>;
    try {
      answer = Promise.resolve(
        this.options.confirmPayment({ attempt: this.attempt, signal: this.abort ? this.abort.signal : undefined }),
      );
    } catch (error) {
      answer = Promise.reject(error);
    }
    answer.then(
      (result) => this.settle(generation, result, null),
      (error: unknown) => this.settle(generation, 'pending', error == null ? new Error('confirmPayment failed.') : error),
    );
  }

  private settle(generation: number, result: PaymentCheckResult, error: unknown): void {
    // A reset, restart or dispose happened while this check was in flight.
    if (this.disposed || generation !== this.generation) return;
    this.inFlight = false;
    this.abort = null;
    if (result === 'paid' || result === 'failed') {
      this.finish(result);
      return;
    }
    if (this.now() >= this.deadline) {
      this.finish('expired', error);
      return;
    }
    this.update({ ...this.snapshot, lastCheckError: error });
    this.interval = Math.min(this.interval * this.options.backoffFactor, this.options.maxPollIntervalMs);
    this.schedulePoll(this.interval);
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
    this.deadlineTimer = setTimeout(() => this.onDeadline(), Math.max(0, this.deadline - this.now()));
    this.scheduleTick();
  }

  private onDeadline(): void {
    this.deadlineTimer = null;
    if (this.disposed || this.snapshot.status !== 'waiting') return;
    // A check in flight decides on its own when it lands after the deadline.
    if (this.inFlight || this.hidden) return;
    // One last check, so a payment made in the final seconds still counts.
    this.clearPoll();
    this.check();
  }

  private schedulePoll(delay: number): void {
    this.clearPoll();
    if (this.hidden || this.snapshot.status !== 'waiting') return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.check();
    }, delay);
  }

  private scheduleTick(): void {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    const left = this.deadline - this.now();
    if (left <= 0) {
      this.tickTimer = null;
      return;
    }
    // Wake on the next whole second, so the countdown never drifts.
    const delay = left % 1000 || 1000;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      if (this.snapshot.status !== 'waiting' || this.hidden) return;
      this.update({ ...this.snapshot, secondsLeft: this.secondsLeft() });
      this.scheduleTick();
    }, delay);
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.deadline - this.now()) / 1000));
  }

  /** Clear timers, abort the request in flight and forget its answer. */
  private cancel(): void {
    this.clearTimers();
    this.generation += 1;
    this.inFlight = false;
    if (this.abort) this.abort.abort();
    this.abort = null;
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
