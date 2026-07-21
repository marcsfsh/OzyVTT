import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./util";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width. */
  block?: boolean;
  /** Add a hover-lift — for card-like / CTA buttons, not dense toolbars. */
  lift?: boolean;
  /** Append a forward → that nudges on hover — for navigational actions. */
  arrow?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** The one button. Variants map to the semantic roles in the design language:
    primary = magenta action, secondary = bordered, ghost = text, destructive =
    danger. One primary action per view. Labels use sentence case, body face. */
export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  lift = false,
  arrow = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("nh-btn", `nh-btn--${variant}`, size === "sm" && "nh-btn--sm", block && "nh-btn--block", "interactive", lift && "lift", className)}
      {...rest}
    >
      {children}
      {arrow && <span className="nav-arrow" aria-hidden="true">→</span>}
    </button>
  );
}

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  lift?: boolean;
  arrow?: boolean;
  ref?: Ref<HTMLAnchorElement>;
}

/** Anchor styled as a button, for real navigations (download links, viewer URL). */
export function LinkButton({ variant = "secondary", size = "md", block = false, lift = false, arrow = false, className, children, ...rest }: LinkButtonProps) {
  return (
    <a
      className={cx("nh-btn", `nh-btn--${variant}`, size === "sm" && "nh-btn--sm", block && "nh-btn--block", "interactive", lift && "lift", className)}
      {...rest}
    >
      {children}
      {arrow && <span className="nav-arrow" aria-hidden="true">→</span>}
    </a>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — icon-only buttons have no text, so this is required. */
  label: string;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

/** Square icon-only control (map tools, close buttons). Uses aria-pressed for
    toggles; the pressed state carries the magenta active glow. */
export function IconButton({ label, size = "md", className, type = "button", children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={cx("nh-iconbtn", size === "sm" && "nh-iconbtn--sm", "interactive", className)}
      {...rest}
    >
      {children as ReactNode}
    </button>
  );
}
