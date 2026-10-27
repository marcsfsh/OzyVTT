import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./util";
import "./Wordmark.css";

interface WordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Brand text. Defaults to the working name; swap freely (see --brand-name). */
  children?: ReactNode;
  /** `cabinet` is the app's mark: OZY in chrome lettering and vtt in neon script. `chrome` is the title screen's
      metal; `solid` is plain ink. */
  variant?: "cabinet" | "chrome" | "solid";
  /** Put the sun glyph before the name, as the app bar does. */
  sun?: boolean;
}

/** The app wordmark. The cabinet mark leads every top bar; the chrome name belongs to the title screen. */
export function Wordmark({ children = "OZYVTT", variant = "chrome", sun = false, className, ...rest }: WordmarkProps) {
  if (variant === "cabinet")
    return (
      <span className={cx("nh-wordmark-cabinet", className)} role="img" aria-label="OzyVTT" {...rest}>
        <span className="nh-wordmark-ozy chrome" aria-hidden="true">
          OZY
        </span>
        <span className="nh-wordmark-vtt" aria-hidden="true">
          vtt
        </span>
      </span>
    );
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

/** Small uppercase tracked label in the label face. Accessibility governs its size and contrast. */
export function Eyebrow({ className, children, ...rest }: EyebrowProps) {
  return (
    <span className={cx("nh-eyebrow", className)} {...rest}>
      {children}
    </span>
  );
}
