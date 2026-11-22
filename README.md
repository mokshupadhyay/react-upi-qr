# react-upi-qr

Take a UPI payment on the web with React. `<PayWithUpi>` shows a QR code to scan on a desktop, and a "Pay with UPI" button plus per-app buttons on a phone. Then it asks your server whether the payment arrived, until the server says `paid` or `failed` or the countdown runs out.

- **One component, two layouts.** Desktop: the amount, the payee name, the QR code and a countdown. Phone: the `upi://pay` link, best-effort buttons for Google Pay, PhonePe, Paytm, BHIM and CRED, and a "Pay from another phone" toggle that shows the QR code.
- **Your server decides.** You pass `confirmPayment`, a function that asks your server. The hook polls it with backoff, pauses while the tab is hidden, checks at once when the user comes back from the UPI app, and stops on unmount.
- **Typed URL building and validation.** `buildUpiUrl()` and `validateUpiParams()` are the same tested code as in [react-native-upi-checkout](https://github.com/mokshupadhyay/react-native-upi-checkout): fixed parameter order, percent-encoded values, amounts checked with integer arithmetic.
- **A QR code that scans.** Inline SVG. A test renders the component, rasterizes the SVG with an independent renderer, decodes it, and compares the result with `buildUpiUrl(params)`, for fixed cases and for random valid params.
- **Accessible.** The status ("Waiting for payment…", "Paid", "Expired") is announced through an ARIA live region. Everything works with the keyboard, focus is visible, and the one animation stops under `prefers-reduced-motion`.
- **SSR-safe.** No `window`, `document` or `navigator` access during render, and `'use client'` on the client files, for the Next.js App Router and Pages Router. Tested with React 17, 18 and 19.

> [!WARNING]
> **Nothing the browser sees is proof of payment.** The user's UPI app does not report back to a web page, and anything that runs in the browser can be changed by the user. Only your server can confirm a payment, for example with your payment gateway's or PSP's transaction status API, or with the webhook it sends you. Match the amount and the `transactionRef` there before you ship an order or unlock anything. `confirmPayment` should only ask your server; never resolve it to `'paid'` on the client.

## Install

```sh
npm install react-upi-qr
```

React 17 or later. One runtime dependency, [`qrcode-generator`](#qr-encoder).

Import the stylesheet once, or write your own styles for the `upiqr-` class names:

```ts
import 'react-upi-qr/styles.css';
```

## Usage

```tsx
import { PayWithUpi } from 'react-upi-qr';
import 'react-upi-qr/styles.css';

export function Checkout({ order }: { order: { id: string; total: string } }) {
  return (
    <PayWithUpi
      params={{
        payeeVpa: 'shop@okbank',
        payeeName: 'Corner Shop',
        amount: order.total, // '149.50'
        transactionRef: order.id,
        note: `Order ${order.id}`,
      }}
      confirmPayment={async ({ signal }) => {
        const response = await fetch(`/api/orders/${order.id}/payment`, { signal });
        const body: { status: 'paid' | 'pending' | 'failed' } = await response.json();
        return body.status;
      }}
      onPaid={() => router.push(`/orders/${order.id}`)}
      expiresInSeconds={300}
    />
  );
}
```

Your endpoint looks the order up and returns `paid` only when your gateway has confirmed a payment for that `transactionRef` and amount (from its status API, or from a webhook you stored). Return `pending` while nothing is known, and `failed` when the gateway reports a failure. A rejected `confirmPayment` (a network error) counts as `pending`: polling goes on and the error is available as `lastCheckError` from the hook.

To start a fresh payment, for example after "Expired", give the component a new `key` and new params. The "Try again" button reuses the same params.

### Next.js

The component and hooks files start with `'use client'`, so you can render `<PayWithUpi>` from a Server Component page in the App Router. Pass `confirmPayment` from a Client Component, because functions cannot cross from server to client:

```tsx
'use client';
import { PayWithUpi } from 'react-upi-qr';
```

`buildUpiUrl`, `validateUpiParams`, `detectDeviceKind` and `<QrCode>` have no client-only code, so they also run in Server Components and API routes.

Device detection runs in an effect. The server render and the first client render therefore show the amount and the status line but no QR code and no buttons, and hydration always matches. If you already know the device, for example from the request's `User-Agent` header and `detectDeviceKind({ userAgent })`, pass `deviceKind` and the server renders the final markup.

## What happens on each device

| Device | Shows | Waiting starts |
| --- | --- | --- |
| `desktop` | Amount, payee, QR code, countdown. | When the QR code is shown. |
| `android` | "Pay with UPI" (`upi://pay?...`), per-app `intent:` links, "Pay from another phone". | When a pay link is tapped, or the QR code is shown. |
| `ios` | "Pay with UPI" (`upi://pay?...`), per-app scheme links, "Pay from another phone". | Same as Android. |

When the user taps a link, the browser hands the URL to the UPI app and the page goes to the background. Polling pauses. When the user switches back, the page becomes visible, the hook checks at once and resumes polling.

User-agent detection is never perfect (desktop mode on phones, reduced user agents, in-app browsers). Pass `deviceKind` to override it. The "Pay from another phone" toggle also lets a phone user show the QR code.

## What the per-app links can and cannot do

A web page cannot see which apps are installed and gets no result back from the UPI app. The per-app buttons are a shortcut, not a guarantee.

- **Android:** each button is a Chrome `intent://pay?...#Intent;scheme=upi;package=<package>;end` URL. Chrome and Chromium-based browsers open that app with the payment. If the app is not installed, Chrome opens its Play Store page. Other browsers may ignore `intent:` URLs. The generic "Pay with UPI" link (`upi://pay?...`) lets Android pick from every UPI app.
- **iOS:** each button uses the app's own URL scheme, for example `phonepe://pay?...`. These schemes are not published by NPCI, come from the same best-effort table as react-native-upi-checkout, have not been checked on a device for this release, and can change with any app update. If the app is not installed, Safari shows an error. The generic `upi://pay` link opens whichever app iOS picks.
- **Desktop:** no links; the QR code is the only way.

The list is `KNOWN_UPI_APPS`. Pass `apps={[]}` to show only the generic button, or your own list of `{ id, name, androidPackage, iosPayUrl }`.

## Known limits

- **UPI apps only accept payment links after the user has registered them.** Google Pay, PhonePe, BHIM and others enable their `upi://pay` handler only once the user has set them up with a phone number and a bank account. On a phone without a registered UPI app, the links do nothing or show an error. The QR code still works from any other phone.
- **Merchant restrictions.** Many UPI apps refuse or limit payments from links and QR codes to VPAs that are not set up as merchants through a PSP. That is decided by the app and the bank, not by this library. This library does not sign requests.
- **The countdown is a UI timeout.** The `upi://pay` URL carries no expiry. Someone who saved or photographed the code can still pay after the countdown, so your server must handle late payments (fulfil or refund). At the deadline the hook makes one last check, so a payment confirmed in the final seconds still shows as paid.
- **Expiry while hidden.** Nothing runs while the tab is hidden, so `onExpired` fires when the user comes back, after one last check.
- **Large amounts of text.** The URL must fit in a version 40 QR code (2331 bytes at error correction M). With the default length limits it always does, unless `url` or `transactionId` are very long; then the component shows "This payment request is too long for a QR code."
- **Not tested on real devices yet.** See [Status](#status-of-version-010).

## Hooks

### `useUpiPayment(options)`

The state machine behind the component, for your own UI.

```tsx
import { QrCode, useUpiPayment } from 'react-upi-qr';

function MyCheckout({ params }) {
  const payment = useUpiPayment({ params, confirmPayment, autoStart: true });
  if (payment.url === null) return <p>Invalid: {payment.problems.map((p) => p.message).join(' ')}</p>;
  return (
    <>
      <QrCode value={payment.url} title="Pay with UPI" />
      <p role="status">{payment.status}</p>
      {payment.secondsLeft !== null && <p>{payment.secondsLeft}s left</p>}
    </>
  );
}
```

States: `idle` → `waiting` → `paid` | `failed` | `expired`. The last three are final: `confirmPayment` is never called again after them, or after unmount, and answers that arrive late are ignored.

| Option | Default | |
| --- | --- | --- |
| `params` | | `UpiPaymentParams`, see below. |
| `confirmPayment` | | `({ attempt, signal }) => Promise<'paid' \| 'pending' \| 'failed'>`. `signal` aborts on unmount, reset or restart. |
| `expiresInSeconds` | `300` | From `start()` to `expired`. |
| `pollIntervalMs` | `3000` | Delay before the first check and the base delay between checks. |
| `maxPollIntervalMs` | `15000` | Upper bound of the delay. |
| `backoffFactor` | `1.5` | The delay is multiplied by this after each `pending`. |
| `autoStart` | `false` | Start waiting on mount. |
| `validation` | | `{ limits }`, see [Validation](#validation-and-limits). |
| `onPaid`, `onFailed`, `onExpired` | | Called once when the state is reached. |

Returns `{ status, url, problems, secondsLeft, lastCheckError, start, checkNow, reset }`. At most one check is in flight. `start()` does nothing while waiting or when the params are invalid; from a final state it starts again. Changing a timing option starts a new idle session.

### `useDeviceKind(override?)`

Returns `'android'`, `'ios'` or `'desktop'`, or `null` until detected (during the server render and the first client render). With `override`, returns it at once. Detection uses `navigator.userAgent`, `navigator.userAgentData.platform` where present, and `navigator.maxTouchPoints` to tell an iPad in desktop mode from a Mac. The pure function is `detectDeviceKind(hints)`.

## `<PayWithUpi>` props

| Prop | Default | |
| --- | --- | --- |
| `params`, `confirmPayment` | | Required. |
| `onPaid`, `onFailed`, `onExpired` | | |
| `expiresInSeconds`, `pollIntervalMs`, `maxPollIntervalMs` | `300`, `3000`, `15000` | As for the hook. |
| `deviceKind` | detected | `'android' \| 'ios' \| 'desktop'`. |
| `apps` | `KNOWN_UPI_APPS` | Per-app buttons on phones. |
| `errorCorrection` | `'M'` | `'L' \| 'M' \| 'Q' \| 'H'`. |
| `labels` | English | Any of the texts in `DEFAULT_LABELS`, for example `{ waiting: 'भुगतान की प्रतीक्षा…' }`. |
| `className`, `validation` | | |

## API

| Export | |
| --- | --- |
| `buildUpiUrl(params, { limits? })` | The `upi://pay?...` URL. Throws `UpiError` `INVALID_PARAMS` with `problems`. |
| `validateUpiParams(params, { limits? })` | `UpiProblem[]`, empty when valid. Never throws. |
| `createQrMatrix(text, errorCorrection?)` | `{ size, modules }`. Throws `UpiError` `QR_TOO_LONG`. |
| `<QrCode value title? errorCorrection? margin? />` | Any text as an inline SVG QR code. Works in Server Components. |
| `<QrSvg matrix />` | Draws a matrix from `createQrMatrix`. |
| `detectDeviceKind(hints)`, `readDeviceHints()` | Pure detection, and the hints from `navigator` (or `null`). |
| `upiAppLink(app, url, device)` | The per-app link, or `null` on desktop. |
| `formatRupees(amount)` | `'₹1,49,999.50'`, Indian digit grouping. |
| `KNOWN_UPI_APPS`, `DEFAULT_UPI_LIMITS`, `DEFAULT_LABELS` | |

### Parameters

| Field | URL | Required | Notes |
| --- | --- | --- | --- |
| `payeeVpa` | `pa` | yes | Must look like `name@handle`. |
| `payeeName` | `pn` | yes | |
| `amount` | `am` | yes | Decimal string or number, greater than zero, at most two decimals. Sent with exactly two decimals. |
| `currency` | `cu` | no | Only `'INR'`, the default. |
| `transactionRef` | `tr` | yes | Your order or payment reference. Use it to match the payment on your server. |
| `note` | `tn` | yes | |
| `merchantCode` | `mc` | no | Four-digit merchant category code. |
| `transactionId` | `tid` | no | Only if your PSP gives you one. |
| `url` | `url` | no | A link with order details. |

The URL always lists parameters in the order `pa`, `pn`, `mc`, `tid`, `tr`, `tn`, `am`, `cu`, `url`. Empty optional values are left out. Every value is percent-encoded with `encodeURIComponent`, except that `@` stays readable.

## Validation and limits

`validateUpiParams` checks required fields, value types, the `name@handle` shape of `payeeVpa`, the amount, the currency, the merchant code, and these length limits, counted in characters:

| Field | Default |
| --- | --- |
| `payeeVpa` | 255 |
| `payeeName` | 50 |
| `transactionRef` | 35 |
| `note` | 50 |

**These are conservative defaults, not rules quoted from the specification.** Override them with `validation={{ limits: { note: 80 } }}` when you know your values are accepted. The rules for UPI URLs are set by NPCI in the UPI Linking Specifications on [npci.org.in](https://www.npci.org.in/). Check the current version and your PSP's documentation.

## Theming

Set any of these custom properties on `.upiqr` or an ancestor:

`--upiqr-bg`, `--upiqr-fg`, `--upiqr-muted`, `--upiqr-border`, `--upiqr-accent`, `--upiqr-accent-fg`, `--upiqr-button-bg`, `--upiqr-button-fg`, `--upiqr-success`, `--upiqr-danger`, `--upiqr-focus`, `--upiqr-radius`, `--upiqr-qr-size` (default `240px`), `--upiqr-font`.

The default theme follows `prefers-color-scheme`. The QR code stays black on white in dark mode, because many scanners cannot read inverted codes. Class names all start with `upiqr-`; the root also gets `upiqr--<device>` and `upiqr--<status>`.

## QR encoder

The QR code is encoded by [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator) 2.0 by Kazuhiko Arase, MIT licence, no dependencies, maintained since 2009, about 9.5 million downloads a week (npm, November 2026). It was picked because it is the long-standing, widely used encoder with no dependencies, ships CommonJS, ES modules and TypeScript types, and lets this library draw its own SVG from the module grid. Minified it is about 21 KB, 7.6 KB gzipped; the whole library including it is about 36 KB, 13 KB gzipped (esbuild, React external). Considered: `qrcode` (more downloads, but pulls in `pngjs` and `yargs` for Node features), `uqr` (smaller, but ES module first with no `types` condition) and `lean-qr` (small, less widely used).

Tests decode the generated SVG with [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) (rasterizing) and [`jsQR`](https://github.com/cozmo/jsQR) (decoding). Both are development dependencies only.

## Status of version 0.1.0

Verified:

- Unit and property tests (Jest with jsdom): URL building and validation ported from react-native-upi-checkout, the state machine with fake timers, the device detection table, rendering with Testing Library, server rendering, and the QR round trip. [docs/MUTATION_EVIDENCE.md](docs/MUTATION_EVIDENCE.md) shows each property test failing on a deliberate break.
- `npm run test:compat` renders the built package with React 17.0.2, 18.3.1 and 19.3.1: server rendering without a DOM, hydration without warnings, and polling until "Paid".
- The `example/` app builds with Vite and renders in headless Chrome with desktop, Android and iPhone user agents.

Not verified yet:

- Paying a real code with a real UPI app, and the per-app links on real Android and iOS devices.
- A Next.js build. The `'use client'` directives and SSR safety are tested, but no Next.js app was built.
- Screen reader output. The live region markup is tested, not announced by a real screen reader.

Please [report issues](https://github.com/mokshupadhyay/react-upi-qr/issues) with the device, browser and UPI app versions.

## Example

`example/` is a Vite app with a fake server: buttons stand in for the bank and mark the order paid or failed.

```sh
npm install
cd example && npm install && npm run dev
```

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm run test:compat   # React 17, 18 and 19 against lib/
```
