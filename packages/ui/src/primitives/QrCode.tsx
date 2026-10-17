import { useMemo } from "react";
import { encodeQr } from "./qr-encode";
import { cx } from "./util";
import "./QrCode.css";

/** The quiet zone a reader needs around the symbol, in modules. */
const QUIET = 4;

/**
 * A QR code for `value`, drawn here as SVG so the text never leaves the device. Square modules on the light ground in
 * every theme; the accessible name says what scanning it opens.
 */
export function QrCode({ value, label, className }: Readonly<{ value: string; label: string; className?: string }>) {
  const { size, path } = useMemo(() => {
    const matrix = encodeQr(value);
    let d = "";
    matrix.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
      })
    );
    return { size: matrix.length + QUIET * 2, path: d };
  }, [value]);
  return (
    <svg
      className={cx("nh-qr", className)}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className="nh-qr-paper" width={size} height={size} />
      <path className="nh-qr-ink" d={path} />
    </svg>
  );
}
