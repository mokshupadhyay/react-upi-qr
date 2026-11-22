# Mutation evidence for the property tests

Each property test was checked against one small deliberate break in the source. For each row: the file was copied to a backup, the line was changed, only that property test was run (`timeout 300 npx jest <file>`), the backup was copied back, and `cmp <backup> <file>` confirmed the restored file is byte-identical. The full suite was then run again on the restored source and passed.

Recorded on 2026-11-22 with Node 24.22.2, Jest 29.7, fast-check 4.11.

| Property | Test file | Break applied | Result with the break | Counterexample (shrunk by fast-check) | Restored, `cmp` |
| --- | --- | --- | --- | --- | --- |
| (1) For any valid params, the QR code rendered by `<PayWithUpi>` decodes to exactly `buildUpiUrl(params)` | `src/__tests__/qr.property.test.tsx` | `src/qr.ts`, `qrSvgPath`: every dark run drawn one module too wide, `h${length}v1h-${length}z` changed to `h${length + 1}v1h-${length + 1}z` | FAILED: "Property failed after 1 tests", "Property failed by returning false" (jsQR found no code in the rasterized SVG) | `{"payeeVpa":"a@a","payeeName":"!","amount":1,"transactionRef":"ᚁ","note":"!"}` | identical (`cmp` exit 0) |
| (2) `useUpiPayment` never calls `confirmPayment` after reaching a final state or after unmount | `src/__tests__/useUpiPayment.property.test.tsx` | `src/session.ts`, `canCheck`: dropped the `this.snapshot.status === 'waiting' &&` condition | FAILED: "Property failed after 95 tests", "Property failed by returning false" | commands `[advance 100 ms, answer "paid", checkNow]`, `pollIntervalMs` 100, `expiresInSeconds` 1: `checkNow()` after `paid` called `confirmPayment` again | identical (`cmp` exit 0) |

## Notes

- A break in `buildUpiUrl` itself would not fail property (1), because both sides of the comparison use it. That is why the break for (1) is in the QR drawing code. The URL rules are covered by the unit tests ported from react-native-upi-checkout.
- For property (2), only the "after a final state" half was mutated. The "after unmount" half has several guards (the hook removes its `visibilitychange` listener, `dispose()` clears the timers, `canCheck()` checks `disposed`). No break of those guards was tried.
