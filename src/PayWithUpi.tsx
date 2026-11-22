'use client';
import * as React from 'react';
import { KNOWN_UPI_APPS, upiAppLink } from './apps.js';
import type { KnownUpiApp } from './apps.js';
import { UpiError } from './errors.js';
import { formatCountdown, formatRupees } from './format.js';
import { createQrMatrix } from './qr.js';
import type { QrErrorCorrection, QrMatrix } from './qr.js';
import { qrMinSize, QrSvg } from './QrCode.js';
import type { ConfirmPayment, DeviceKind, UpiPaymentParams, UpiPaymentStatus, UpiValidationOptions } from './types.js';
import { useDeviceKind } from './useDeviceKind.js';
import { useUpiPayment } from './useUpiPayment.js';

/** Every text `<PayWithUpi>` shows. Pass some or all of them as `labels`. */
export interface PayWithUpiLabels {
  /** Accessible name of the whole component. */
  title: string;
  /** The main button on phones. */
  payWithUpi: string;
  /** Above the per-app buttons. */
  otherApps: string;
  /** Under the QR code. */
  scanToPay: string;
  /** Under the amount. */
  payee(payeeName: string): string;
  /** Accessible name of the QR code. */
  qrCode(amount: string, payeeName: string): string;
  /** Countdown while waiting; `time` looks like `4:05`. */
  expiresIn(time: string): string;
  /** Phone toggle: show the QR code to pay from another device. */
  showQr: string;
  hideQr: string;
  /** Status line, announced by screen readers. */
  idle: string;
  waiting: string;
  paid: string;
  failed: string;
  expired: string;
  /** Button after `failed` or `expired`. */
  retry: string;
  /** Shown when `params` fail validation. */
  invalid: string;
  /** Shown when the payment link does not fit in a QR code. */
  qrTooLong: string;
}

export const DEFAULT_LABELS: Readonly<PayWithUpiLabels> = Object.freeze({
  title: 'Pay with UPI',
  payWithUpi: 'Pay with UPI',
  otherApps: 'Or open an app',
  scanToPay: 'Scan with any UPI app to pay',
  payee: (payeeName: string) => `to ${payeeName}`,
  qrCode: (amount: string, payeeName: string) => `UPI QR code to pay ${amount} to ${payeeName}`,
  expiresIn: (time: string) => `Expires in ${time}`,
  showQr: 'Pay from another phone',
  hideQr: 'Hide QR code',
  idle: '',
  waiting: 'Waiting for payment…',
  paid: 'Paid',
  failed: 'Payment failed',
  expired: 'Expired',
  retry: 'Try again',
  invalid: 'This payment request is not valid.',
  qrTooLong: 'This payment request is too long for a QR code.',
});

export interface PayWithUpiProps {
  params: UpiPaymentParams;
  /** Asks your server whether the payment arrived. See `useUpiPayment`. */
  confirmPayment: ConfirmPayment;
  onPaid?: () => void;
  onFailed?: () => void;
  onExpired?: () => void;
  /** Seconds the code stays on screen once waiting starts. Default 300. */
  expiresInSeconds?: number;
  /** Base delay between checks in ms. Default 3000. */
  pollIntervalMs?: number;
  /** Longest delay between checks in ms. Default 15000. */
  maxPollIntervalMs?: number;
  /** A check that has not answered after this many ms is aborted and retried. Default 15000. */
  checkTimeoutMs?: number;
  /**
   * Skip user-agent detection. Without it, the server render and the first
   * client render show no QR code and no buttons until the device is known.
   */
  deviceKind?: DeviceKind;
  /** Per-app buttons on phones. Default `KNOWN_UPI_APPS`; `[]` shows only the generic button. */
  apps?: ReadonlyArray<KnownUpiApp>;
  /** QR error correction. Default `'M'`. */
  errorCorrection?: QrErrorCorrection;
  labels?: Partial<PayWithUpiLabels>;
  className?: string;
  validation?: UpiValidationOptions;
}

type QrState = { ok: true; matrix: QrMatrix } | { ok: false } | null;

function isFinal(status: UpiPaymentStatus): boolean {
  return status === 'paid' || status === 'failed' || status === 'expired';
}

/**
 * Take a UPI payment: a QR code on desktop, "Pay with UPI" and per-app
 * buttons on phones, then polling of `confirmPayment` until your server
 * says `paid` or `failed`, or the countdown runs out.
 */
export function PayWithUpi(props: PayWithUpiProps): React.ReactElement {
  const labels: PayWithUpiLabels = { ...DEFAULT_LABELS, ...(props.labels || {}) };
  const kind = useDeviceKind(props.deviceKind);
  const payment = useUpiPayment({
    params: props.params,
    confirmPayment: props.confirmPayment,
    expiresInSeconds: props.expiresInSeconds,
    pollIntervalMs: props.pollIntervalMs,
    maxPollIntervalMs: props.maxPollIntervalMs,
    checkTimeoutMs: props.checkTimeoutMs,
    validation: props.validation,
    onPaid: props.onPaid,
    onFailed: props.onFailed,
    onExpired: props.onExpired,
  });
  const { status, url, start } = payment;
  const [qrOnPhone, setQrOnPhone] = React.useState(false);
  const root = React.useRef<HTMLElement>(null);
  const statusLine = React.useRef<HTMLParagraphElement>(null);
  // The element inside the component that last had focus, if any.
  const lastFocus = React.useRef<Element | null>(null);

  const mobile = kind === 'android' || kind === 'ios';
  const qrShown = kind !== null && url !== null && !isFinal(status) && (!mobile || qrOnPhone);
  const errorCorrection = props.errorCorrection || 'M';

  const qr: QrState = React.useMemo(() => {
    if (url === null) return null;
    try {
      return { ok: true, matrix: createQrMatrix(url, errorCorrection) };
    } catch (error) {
      if (error instanceof UpiError) return { ok: false };
      throw error;
    }
  }, [url, errorCorrection]);

  // A QR code can be scanned at any moment, so waiting starts when it shows.
  React.useEffect(() => {
    if (qrShown && qr !== null && qr.ok && status === 'idle') start();
  }, [qrShown, qr, status, start]);

  // A final state removes the pay links and the QR toggle. If one of them had
  // focus, move it to the status message instead of dropping it on <body>.
  React.useEffect(() => {
    if (!isFinal(status)) return;
    const section = root.current;
    const target = statusLine.current;
    const previous = lastFocus.current;
    if (!section || !target || !previous || typeof document === 'undefined') return;
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if ((lost && !section.contains(previous)) || (active !== null && section.contains(active))) target.focus();
    lastFocus.current = null;
  }, [status]);

  const amount = formatRupees(props.params.amount);
  const payeeName = typeof props.params.payeeName === 'string' ? props.params.payeeName : '';
  const apps = props.apps || KNOWN_UPI_APPS;
  const statusText = labels[status];

  const classes = ['upiqr', `upiqr--${kind || 'detecting'}`, `upiqr--${status}`];
  if (props.className) classes.push(props.className);
  // Let the component grow with a large code; see `qrMinSize`.
  const style =
    qrShown && qr !== null && qr.ok
      ? ({ '--upiqr-qr-min-size': `${qrMinSize(qr.matrix)}px` } as React.CSSProperties)
      : undefined;

  return (
    <section
      ref={root}
      className={classes.join(' ')}
      aria-label={labels.title}
      style={style}
      onFocus={(event) => {
        lastFocus.current = event.target;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next !== null && root.current && !root.current.contains(next)) lastFocus.current = null;
      }}
    >
      <div className="upiqr-summary">
        {amount !== null ? <p className="upiqr-amount">{amount}</p> : null}
        {payeeName ? <p className="upiqr-payee">{labels.payee(payeeName)}</p> : null}
      </div>

      {url === null ? (
        <div className="upiqr-error" role="alert">
          <p>{labels.invalid}</p>
          <ul>
            {payment.problems.map((problem) => (
              <li key={`${problem.field}:${problem.code}`}>{problem.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {url !== null && mobile && !isFinal(status) ? (
        <div className="upiqr-actions">
          <a className="upiqr-button upiqr-button--primary" href={url} onClick={start}>
            {labels.payWithUpi}
          </a>
          {apps.length > 0 ? (
            <>
              <p className="upiqr-apps-label">{labels.otherApps}</p>
              <ul className="upiqr-apps">
                {apps.map((app) => {
                  const href = upiAppLink(app, url, kind === 'ios' ? 'ios' : 'android');
                  return href === null ? null : (
                    <li key={app.id}>
                      <a className="upiqr-button upiqr-app" href={href} onClick={start}>
                        {app.name}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {qrShown && qr !== null ? (
        qr.ok ? (
          <figure className="upiqr-qr-frame">
            <QrSvg matrix={qr.matrix} title={labels.qrCode(amount || '', payeeName)} />
            <figcaption className="upiqr-hint">{labels.scanToPay}</figcaption>
          </figure>
        ) : (
          <p className="upiqr-error" role="alert">
            {labels.qrTooLong}
          </p>
        )
      ) : null}

      {url !== null && mobile && !isFinal(status) ? (
        <button
          type="button"
          className="upiqr-toggle"
          aria-expanded={qrOnPhone}
          onClick={() => setQrOnPhone((shown) => !shown)}
        >
          {qrOnPhone ? labels.hideQr : labels.showQr}
        </button>
      ) : null}

      {status === 'waiting' && qrShown && payment.secondsLeft !== null ? (
        <p className="upiqr-countdown">{labels.expiresIn(formatCountdown(payment.secondsLeft))}</p>
      ) : null}

      <p className="upiqr-status" role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} ref={statusLine}>
        {status === 'waiting' ? <span className="upiqr-pulse" aria-hidden="true" /> : null}
        {statusText}
      </p>

      {url !== null && (status === 'failed' || status === 'expired') ? (
        <button type="button" className="upiqr-button upiqr-retry" onClick={start}>
          {labels.retry}
        </button>
      ) : null}
    </section>
  );
}
