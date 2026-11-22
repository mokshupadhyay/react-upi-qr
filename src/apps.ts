import type { DeviceKind } from './types.js';

/**
 * Known UPI apps, used for the per-app buttons on phones.
 *
 * BEST EFFORT: a web page cannot see which apps are installed, and the iOS
 * schemes and URL templates below are not published by NPCI. They can change
 * with any app update. On Android the buttons use Chrome's `intent:` URLs
 * with the package name, which other browsers may not support. Always show
 * the generic `upi://pay` link as well; it is the one every UPI app handles.
 *
 * `iosPayUrl` is a template: `{query}` is replaced with the query string of
 * the `upi://pay?...` URL built by `buildUpiUrl`.
 */
export interface KnownUpiApp {
  /** Stable id, for example `'phonepe'`. */
  id: string;
  name: string;
  /** Android package name. */
  androidPackage: string;
  /** iOS payment URL template containing `{query}`. */
  iosPayUrl: string;
}

export const KNOWN_UPI_APPS: ReadonlyArray<KnownUpiApp> = [
  {
    id: 'gpay',
    name: 'Google Pay',
    androidPackage: 'com.google.android.apps.nbu.paisa.user',
    iosPayUrl: 'tez://upi/pay?{query}',
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    androidPackage: 'com.phonepe.app',
    iosPayUrl: 'phonepe://pay?{query}',
  },
  {
    id: 'paytm',
    name: 'Paytm',
    androidPackage: 'net.one97.paytm',
    iosPayUrl: 'paytmmp://pay?{query}',
  },
  {
    id: 'bhim',
    name: 'BHIM',
    androidPackage: 'in.org.npci.upiapp',
    iosPayUrl: 'bhim://upi/pay?{query}',
  },
  {
    id: 'cred',
    name: 'CRED',
    androidPackage: 'com.dreamplug.androidapp',
    iosPayUrl: 'credpay://upi/pay?{query}',
  },
];

function splitUpiUrl(upiUrl: string): { path: string; query: string } {
  const rest = upiUrl.replace(/^upi:\/\//, '');
  const index = rest.indexOf('?');
  return index === -1 ? { path: rest, query: '' } : { path: rest.slice(0, index), query: rest.slice(index + 1) };
}

/**
 * The link that opens one app with the payment, or `null` on desktop.
 *
 * - Android: `intent://pay?...#Intent;scheme=upi;package=...;end`. Chrome
 *   opens that app, or its Play Store page when it is not installed.
 * - iOS: the app's own scheme, for example `phonepe://pay?...`. Safari shows
 *   an error when the app is not installed.
 */
export function upiAppLink(app: KnownUpiApp, upiUrl: string, device: DeviceKind): string | null {
  const { path, query } = splitUpiUrl(upiUrl);
  if (device === 'android') {
    const target = query.length > 0 ? `${path}?${query}` : path;
    return `intent://${target}#Intent;scheme=upi;package=${app.androidPackage};end`;
  }
  if (device === 'ios') {
    // A function replacer, so `$` sequences in the query are never special.
    return app.iosPayUrl.replace('{query}', () => query);
  }
  return null;
}
