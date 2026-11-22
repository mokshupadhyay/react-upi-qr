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
  return decode(svg, { mode: 'zoom', value: pixelsPerModule });
}

/** Like `decodeQrSvg`, rasterized at a given width in pixels, as on a 1x screen. */
export function decodeQrSvgAtWidth(svg: string, width: number): DecodedQr | null {
  return decode(svg, { mode: 'width', value: Math.round(width) });
}

function decode(svg: string, fitTo: { mode: 'zoom' | 'width'; value: number }): DecodedQr | null {
  const image = new Resvg(svg, {
    fitTo,
    background: '#ffffff',
  }).render();
  const result = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height, {
    inversionAttempts: 'dontInvert',
  });
  if (!result) return null;
  return { bytes: String.fromCharCode(...result.binaryData), text: result.data };
}

/**
 * The markup of the only QR code inside `container`, serialized as XML.
 * `outerHTML` would leave `<` unescaped in attribute values (allowed in
 * HTML), which resvg's XML parser rejects.
 */
export function qrMarkup(container: HTMLElement): string {
  const svgs = container.querySelectorAll('svg.upiqr-qr');
  if (svgs.length !== 1) throw new Error(`Expected one QR code, found ${svgs.length}.`);
  return new XMLSerializer().serializeToString(svgs[0]);
}
