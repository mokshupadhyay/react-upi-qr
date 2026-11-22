import { Resvg } from '@resvg/resvg-js';
import jsQR from 'jsqr';

export interface DecodedQr {
  /** The bytes of the payload, one character per byte. */
  bytes: string;
  /** The payload as jsQR reads it (UTF-8). */
  text: string;
}

/**
 * Rasterize SVG markup with resvg, an independent SVG renderer, and decode
 * the QR code in the bitmap with jsQR. Returns `null` when nothing decodes.
 */
export function decodeQrSvg(svg: string, pixelsPerModule = 4): DecodedQr | null {
  const image = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: pixelsPerModule },
    background: '#ffffff',
  }).render();
  const result = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height, {
    inversionAttempts: 'dontInvert',
  });
  if (!result) return null;
  return { bytes: String.fromCharCode(...result.binaryData), text: result.data };
}

/** The markup of the only QR code inside `container`. */
export function qrMarkup(container: HTMLElement): string {
  const svgs = container.querySelectorAll('svg.upiqr-qr');
  if (svgs.length !== 1) throw new Error(`Expected one QR code, found ${svgs.length}.`);
  return svgs[0].outerHTML;
}
