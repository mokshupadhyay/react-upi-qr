import qrcode from 'qrcode-generator';
import { UpiError } from './errors.js';

/** QR error correction level: roughly 7, 15, 25 or 30 percent of the code can be damaged. */
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** A QR code as a square grid of modules. `modules[row][col]` is `true` when dark. */
export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

/**
 * Encode text as a QR code, picking the smallest version that fits.
 *
 * The text is encoded in byte mode as UTF-8. `buildUpiUrl` output is always
 * ASCII, because every value is percent-encoded, so it is encoded one byte
 * per character.
 *
 * Throws `UpiError` with code `QR_TOO_LONG` when the text does not fit in a
 * version 40 code at this error correction level. Throws `URIError` for text
 * with a lone UTF-16 surrogate, which has no UTF-8 form.
 */
export function createQrMatrix(text: string, errorCorrection: QrErrorCorrection = 'M'): QrMatrix {
  const code = qrcode(0, errorCorrection);
  // The encoder writes the low byte of each character code, so hand it one
  // character per UTF-8 byte.
  code.addData(toUtf8Bytes(text), 'Byte');
  try {
    code.make();
  } catch {
    throw new UpiError(
      'QR_TOO_LONG',
      `The text (${text.length} characters) does not fit in a QR code with error correction ${errorCorrection}.`,
    );
  }
  const size = code.getModuleCount();
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col++) line.push(code.isDark(row, col));
    modules.push(line);
  }
  return { size, modules };
}

function toUtf8Bytes(text: string): string {
  return encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * An SVG path that draws every dark module as a 1x1 square, shifted by
 * `margin` modules for the quiet zone. Neighbouring dark modules in a row
 * are merged into one rectangle to keep the path short.
 */
export function qrSvgPath(matrix: QrMatrix, margin: number): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    const line = matrix.modules[row];
    let col = 0;
    while (col < matrix.size) {
      if (!line[col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && line[col]) col++;
      const length = col - start;
      parts.push(`M${start + margin} ${row + margin}h${length}v1h-${length}z`);
    }
  }
  return parts.join('');
}
