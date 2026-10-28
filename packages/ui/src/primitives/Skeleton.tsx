import { useLayoutEffect, useRef } from "react";
import { canMove, comet } from "../motion/lightRail";
import { cx } from "./util";
import "./Skeleton.css";

interface SkeletonProps {
  /** text = a line, block = a rectangle, circle = an avatar/thumbnail placeholder. */
  variant?: "text" | "block" | "circle";
  width?: string;
  height?: string;
  className?: string;
}

/**
 * Loading placeholder: a still plate. Mirror the shape of the content it stands in for while data loads. One comet
 * runs along the top of the loading area as it starts, from the first plate of a group, and nothing loops (ADR-0045).
 */
export function Skeleton({ variant = "text", width, height, className }: SkeletonProps) {
  const plate = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = plate.current;
    if (!el || !canMove() || el.previousElementSibling?.classList.contains("nh-skeleton")) return;
    comet(el, { from: 0, to: el.clientWidth, line: 1, thick: 2, delay: 0, dur: 300 });
  }, []);
  return (
    <span
      ref={plate}
      className={cx("nh-skeleton", `nh-skeleton--${variant}`, className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
