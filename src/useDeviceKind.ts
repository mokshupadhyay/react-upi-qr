'use client';
import * as React from 'react';
import { detectDeviceKind, readDeviceHints } from './device.js';
import type { DeviceKind } from './types.js';

/**
 * The device kind of the current browser, or `null` until it is known.
 *
 * Detection runs in an effect, so the server render and the first client
 * render both see `null` and hydration never mismatches. Pass `override` to
 * skip detection: it is returned as is, also during the server render.
 */
export function useDeviceKind(override?: DeviceKind): DeviceKind | null {
  const [detected, setDetected] = React.useState<DeviceKind | null>(null);

  React.useEffect(() => {
    if (override) return;
    const hints = readDeviceHints();
    setDetected(hints ? detectDeviceKind(hints) : 'desktop');
  }, [override]);

  return override || detected;
}
