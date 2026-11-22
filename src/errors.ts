import type { UpiErrorCode, UpiProblem } from './types.js';

/** Every error this library throws is a `UpiError` with a stable `code`. */
export class UpiError extends Error {
  readonly code: UpiErrorCode;
  /** Validation problems; only set for `INVALID_PARAMS`. */
  readonly problems: UpiProblem[];

  constructor(code: UpiErrorCode, message: string, problems: UpiProblem[] = []) {
    super(message);
    // Keeps `instanceof UpiError` working when the class is transpiled to ES5.
    Object.setPrototypeOf(this, UpiError.prototype);
    this.name = 'UpiError';
    this.code = code;
    this.problems = problems;
  }
}
