import type { Ref } from "react";
import { cx } from "./util";
import "./OverlayEdge.css";

/**
 * The top edge of a surface that opens above the page (ADR-0045): a 2px horizon line that lights from whatever
 * opened it and drains back as the surface closes. The owner runs the light (`edgeIn`, `ghostOut`); this is the line.
 * The surface must be positioned.
 */
export function OverlayEdge({ className, ref }: Readonly<{ className?: string; ref?: Ref<HTMLSpanElement> }>) {
  return <span ref={ref} className={cx("nh-overlay-edge", className)} aria-hidden="true" />;
}
