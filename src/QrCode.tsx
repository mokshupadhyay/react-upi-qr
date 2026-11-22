import * as React from 'react';
import { createQrMatrix, qrSvgPath } from './qr.js';
import type { QrErrorCorrection, QrMatrix } from './qr.js';

export interface QrSvgProps {
  matrix: QrMatrix;
  /** Quiet zone around the code, in modules. Default 4, as the QR standard asks. */
  margin?: number;
  /** Accessible name of the image. */
  title?: string;
  className?: string;
}

/** Draws a QR matrix as inline SVG. Dark modules on white, whatever the theme. */
export function QrSvg({ matrix, margin = 4, title, className }: QrSvgProps): React.ReactElement {
  const quiet = Math.max(0, Math.floor(margin));
  const path = React.useMemo(() => qrSvgPath(matrix, quiet), [matrix, quiet]);
  const extent = matrix.size + quiet * 2;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${extent} ${extent}`}
      className={className ? `upiqr-qr ${className}` : 'upiqr-qr'}
      role="img"
      aria-label={title}
      focusable="false"
      shapeRendering="crispEdges"
    >
      <rect className="upiqr-qr-bg" width={extent} height={extent} fill="#ffffff" />
      <path className="upiqr-qr-fg" d={path} fill="#000000" />
    </svg>
  );
}

export interface QrCodeProps {
  /** The text to encode, for example the URL from `buildUpiUrl`. */
  value: string;
  /** Default `'M'`. */
  errorCorrection?: QrErrorCorrection;
  /** Quiet zone in modules. Default 4. */
  margin?: number;
  /** Accessible name of the image. */
  title?: string;
  className?: string;
}

/**
 * A QR code for any text, as inline SVG. Throws `UpiError` `QR_TOO_LONG`
 * during render when the text does not fit; `<PayWithUpi>` shows a message
 * instead.
 */
export function QrCode({ value, errorCorrection = 'M', margin, title, className }: QrCodeProps): React.ReactElement {
  const matrix = React.useMemo(() => createQrMatrix(value, errorCorrection), [value, errorCorrection]);
  return <QrSvg matrix={matrix} margin={margin} title={title} className={className} />;
}
