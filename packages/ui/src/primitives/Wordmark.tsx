import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./util";
import "./Wordmark.css";

export interface WordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Brand text. Defaults to the working name; swap freely (see --brand-name). */
  children?: ReactNode;
  /** Add the optional chromatic-fringe garnish (wordmark only). */
  chromatic?: boolean;
}

/** The app wordmark: chunky arcade face with the chrome-gradient fill + bevel
    (via .wordmark-name from the token layer). Wordmark and top-level titles only. */
export function Wordmark({ children = "OzyVTT", chromatic = false, className, ...rest }: WordmarkProps) {
  return (
    <span className={cx("nh-wordmark", "wordmark-name", chromatic && "chromatic", className)} {...rest}>
      {children}
    </span>
  );
}

export type EyebrowProps = HTMLAttributes<HTMLSpanElement>;

/** Small uppercase tracked label. Mono/flavor micro-label; size + contrast are
    governed by accessibility, not style. */
export function Eyebrow({ className, children, ...rest }: EyebrowProps) {
  return (
    <span className={cx("nh-eyebrow", className)} {...rest}>
      {children}
    </span>
  );
}
