let state: DocumentVisibilityState = 'visible';

/** Make `document.visibilityState` controllable. Call once per test file. */
export function installVisibility(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

export function setVisibility(next: DocumentVisibilityState): void {
  state = next;
  document.dispatchEvent(new Event('visibilitychange'));
}
