import * as React from 'react';
import { createQrMatrix, qrSvgPath } from './qr.js';
import type { QrErrorCorrection, QrMatrix } from './qr.js';

export interface QrSvgProps {
  matrix: QrMatrix;
  /**
   * Quiet zone around the code, in modules. Default 4, as the QR standard
   * asks. Rounded down; anything that is not a finite number >= 0 means 4.
   */
  margin?: number;
  /** Accessible name of the image. */
  title?: string;
  className?: string;
}

const DEFAULT_MARGIN = 4;

/**
 * Smallest size of a module on screen, in CSS px. Below this, phone cameras
 * start to fail on dense codes shown on a 1x desktop screen.
 */
export const QR_MIN_MODULE_PX = 3;

/** The quiet zone in modules: `margin` rounded down, or 4 when it is not a finite number >= 0. */
function quietZone(margin: number | undefined): number {
  return typeof margin === 'number' && isFinite(margin) && margin >= 0 ? Math.floor(margin) : DEFAULT_MARGIN;
}

/**
 * The width in CSS px at which every module of the code, quiet zone
 * included, is `QR_MIN_MODULE_PX` wide. The default stylesheet never draws
 * the code smaller than this, unless the container is narrower.
 */
export function qrMinSize(matrix: QrMatrix, margin?: number): number {
  return (matrix.size + quietZone(margin) * 2) * QR_MIN_MODULE_PX;
}

/**
 * Draws a QR matrix as inline SVG. Dark modules on white, whatever the theme.
 *
 * Sets `--upiqr-qr-min-size` on the element (see `qrMinSize`); the default
 * stylesheet uses it so that dense codes are drawn larger than
 * `--upiqr-qr-size`.
 */
export function QrSvg({ matrix, margin, title, className }: QrSvgProps): React.ReactElement {
  const quiet = quietZone(margin);
  const path = React.useMemo(() => qrSvgPath(matrix, quiet), [matrix, quiet]);
  const extent = matrix.size + quiet * 2;
  const style = { '--upiqr-qr-min-size': `${qrMinSize(matrix, quiet)}px` } as React.CSSProperties;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${extent} ${extent}`}
      style={style}
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
  /** Quiet zone in modules. Default 4; see `QrSvgProps.margin`. */
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
