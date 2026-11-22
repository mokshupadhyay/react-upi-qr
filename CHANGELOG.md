# Changelog

## 0.1.0

First release. Not yet tried with a real UPI app or on a phone; see "Status of version 0.1.0" in the README.

- `<PayWithUpi>`: QR code with amount, payee and countdown on desktop; "Pay with UPI" link, per-app links and a "Pay from another phone" toggle on Android and iOS; status line in an ARIA live region; "Try again" after `failed` or `expired`; replaceable labels.
- `useUpiPayment()`: `idle`, `waiting`, `paid`, `failed`, `expired`. Polls `confirmPayment` with backoff, one check at a time, pauses while the tab is hidden and checks at once when it is visible again, makes one last check at the deadline, and stops on unmount.
- `useDeviceKind()` and `detectDeviceKind()`: Android, iOS (including iPadOS in desktop mode) or desktop, from the user agent, client hints and touch points. Overridable with `deviceKind`.
- `buildUpiUrl()` and `validateUpiParams()`, ported from react-native-upi-checkout 0.1.0 with the same rules and tests.
- `<QrCode>`, `<QrSvg>` and `createQrMatrix()`: inline SVG QR codes encoded by `qrcode-generator`.
- `react-upi-qr/styles.css`: default light and dark theme with `--upiqr-*` custom properties, visible focus, and no animation under `prefers-reduced-motion`.
- ES modules, CommonJS and type declarations behind an `exports` map. Server rendering and hydration tested with React 17, 18 and 19.

### Fixed before release, from a code review

- Changing a timing prop (`expiresInSeconds`, `pollIntervalMs`, ...) no longer replaces the session. Before, a change after `paid` went back to `idle` and `<PayWithUpi>` started again, so an `expiresInSeconds` computed on every render plus an `onPaid` that sets state called `onPaid` every few seconds and never showed "Paid". A change while waiting dropped to `idle` and stopped checking. Now `paid`, `failed` and `expired` stay final until `start()` ("Try again") or a new `key`; `expiresInSeconds` applies to the next session, and the poll options to the next scheduled check.
- A `confirmPayment` that never settles no longer blocks expiry and polling. New option `checkTimeoutMs` (default 15000): a check that has not answered by then is aborted through its `signal` and counts as failed (backoff, then retry). At the deadline, a check in flight is aborted and the state becomes `expired`.
- Params that become invalid while waiting stop the session; only the validation problems are shown.
- A params change that changes the `upi://pay` URL while waiting starts a new session with a fresh deadline and aborts the check in flight. After a final state, params changes do not restart anything.
- QR codes are drawn at least 3 CSS px per module: the component sets `--upiqr-qr-min-size` on the `<svg>` and the root, and the stylesheet widens the code and the component to fit. At 240 px, a Devanagari name and note within the default limits (version 23) got about 2 px per module and did not decode in the round-trip test.
- When a final state removes the focused link or button, focus moves to the status message (`tabIndex={-1}`).
- An answer other than `'paid'`, `'pending'` or `'failed'` (for example `'success'`) counts as a failed check with a clear `lastCheckError`, and is warned about once in development. It used to count as `pending` silently.
- Countdowns longer than 2<sup>31</sup>−1 ms (about 24.8 days) are reached in steps instead of firing at once; other timers are capped at that value.
- Timing options that are not positive finite numbers (`0`, `-5`, `NaN`) use their documented defaults and log one development warning per option.
- `payeeVpa`: stricter shape. The name starts with a letter or digit, with no `..` and no dot at the end; the handle is letters and digits in dot-separated parts. `-@-`, `a@.`, `a@-`, `.@b`, `a@b..` and `a..b@okaxis` are now rejected.
- Text values with control characters (U+0000 to U+001F, U+007F to U+009F) or leading or trailing whitespace are rejected with `INVALID_CHARACTERS` instead of being encoded.
- `currency: null` and `currency: ''` mean absent, like the other optional fields. Whitespace-only optional values are left out of the URL without a problem.
- `transactionId` and `url` have length limits (35 and 255, in `DEFAULT_UPI_LIMITS`, overridable). `url` must be an `http:` or `https:` link; others, such as `javascript:`, get the new code `INVALID_URL`.
- `<QrCode>` and `<QrSvg>`: a `margin` that is not a finite number ≥ 0 (for example `NaN`) means 4 instead of producing `viewBox="0 0 NaN NaN"`. An unknown `errorCorrection` means `'M'`.
