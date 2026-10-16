import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./util";
import "./Wordmark.css";

interface WordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Brand text. Defaults to the working name; swap freely (see --brand-name). */
  children?: ReactNode;
  /** `chrome` is the title screen's metal; `solid` is plain ink with the heading shadow, for the app bar. */
  variant?: "chrome" | "solid";
  /** Put the sun glyph before the name, as the app bar does. */
  sun?: boolean;
}

/** The app wordmark in Bungee. Chrome on the title screen only; everywhere else it is solid. */
export function Wordmark({ children = "OZYVTT", variant = "chrome", sun = false, className, ...rest }: WordmarkProps) {
  const finish = variant === "chrome" ? "wordmark-name" : "wordmark-solid";
  if (!sun) {
    return (
      <span className={cx("nh-wordmark", finish, className)} {...rest}>
        {children}
      </span>
    );
  }
  return (
    <span className={cx("nh-wordmark-lockup", className)} {...rest}>
      <SunMark />
      <span className={cx("nh-wordmark", finish)}>{children}</span>
    </span>
  );
}

interface SunMarkProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** The sun glyph: a striped half-sun. It marks "now" (beside the current turn's name) and sits before the wordmark.
    Decorative, so it is hidden from assistive tech; the thing it marks must say so in words too. */
export function SunMark({ size = "md", className }: SunMarkProps) {
  return <span className={cx("nh-sun", size !== "md" && `nh-sun--${size}`, className)} aria-hidden="true" />;
}

type EyebrowProps = HTMLAttributes<HTMLSpanElement>;

/** Small uppercase tracked label in the label face. Size and contrast are governed by accessibility, not style. */
export function Eyebrow({ className, children, ...rest }: EyebrowProps) {
  return (
    <span className={cx("nh-eyebrow", className)} {...rest}>
      {children}
    </span>
  );
}
