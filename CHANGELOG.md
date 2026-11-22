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
