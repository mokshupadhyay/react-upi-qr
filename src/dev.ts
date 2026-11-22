// Only `process.env.NODE_ENV` is read. Declared here, so the library does not
// need Node types; bundlers replace the expression at build time.
declare const process: { env: { NODE_ENV?: string } };

function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    // No bundler and no `process`, for example a plain ES module in a browser.
    return false;
  }
}

/** `console.warn` outside production builds. */
export function warnInDevelopment(message: string): void {
  if (!isDevelopment()) return;
  if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(`react-upi-qr: ${message}`);
}
