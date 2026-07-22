import { cx } from "./util";
import "./Skeleton.css";

export interface SkeletonProps {
  /** text = a line, block = a rectangle, circle = an avatar/thumbnail placeholder. */
  variant?: "text" | "block" | "circle";
  width?: string;
  height?: string;
  className?: string;
}

/** Loading placeholder with a quiet shimmer (neutralized under reduced-motion).
    Mirror the shape of the content it stands in for while data loads. */
export function Skeleton({ variant = "text", width, height, className }: SkeletonProps) {
  return (
    <span
      className={cx("nh-skeleton", `nh-skeleton--${variant}`, className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
