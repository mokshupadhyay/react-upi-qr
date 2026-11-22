import type { DeviceKind } from './types.js';

/** What `detectDeviceKind` looks at. Every field comes from `navigator`. */
export interface DeviceHints {
  /** `navigator.userAgent`. */
  userAgent: string;
  /** `navigator.maxTouchPoints`. Tells an iPad in desktop mode from a Mac. */
  maxTouchPoints?: number;
  /** `navigator.userAgentData.platform`, where the browser has it (Chromium). */
  platform?: string;
}

/**
 * Guess the device from user-agent hints. Pure, so it also runs on a server
 * with the request's `User-Agent` header.
 *
 * Guessing is never perfect: browsers can request the desktop site, and
 * some send a reduced user agent. Let users override the result, as the
 * `deviceKind` prop of `<PayWithUpi>` does.
 */
export function detectDeviceKind(hints: DeviceHints): DeviceKind {
  const ua = typeof hints.userAgent === 'string' ? hints.userAgent : '';
  const platform = typeof hints.platform === 'string' ? hints.platform.toLowerCase() : '';
  if (platform === 'android' || /android/i.test(ua)) return 'android';
  if (platform === 'ios' || /iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS 13+ in its default desktop mode sends a Mac user agent. Macs have
  // no touch screen, so touch points tell the two apart.
  if (/macintosh/i.test(ua) && (hints.maxTouchPoints || 0) > 1) return 'ios';
  return 'desktop';
}

interface NavigatorWithUAData {
  userAgent: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}

/** Read the hints from `navigator`. Returns `null` outside a browser. */
export function readDeviceHints(): DeviceHints | null {
  if (typeof navigator === 'undefined' || navigator == null) return null;
  const nav = navigator as unknown as NavigatorWithUAData;
  return {
    userAgent: typeof nav.userAgent === 'string' ? nav.userAgent : '',
    maxTouchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : undefined,
    platform: nav.userAgentData && typeof nav.userAgentData.platform === 'string' ? nav.userAgentData.platform : undefined,
  };
}
