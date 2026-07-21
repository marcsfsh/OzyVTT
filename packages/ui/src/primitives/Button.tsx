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
  ref?: Ref<HTMLButtonElement>;
}

/** The one button. Variants map to the semantic roles in the design language:
    primary = magenta action, secondary = bordered, ghost = text, destructive =
    danger. One primary action per view. Labels use sentence case, body face. */
export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("nh-btn", `nh-btn--${variant}`, size === "sm" && "nh-btn--sm", block && "nh-btn--block", "interactive", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  ref?: Ref<HTMLAnchorElement>;
}

/** Anchor styled as a button, for real navigations (download links, viewer URL). */
export function LinkButton({ variant = "secondary", size = "md", block = false, className, children, ...rest }: LinkButtonProps) {
  return (
    <a
      className={cx("nh-btn", `nh-btn--${variant}`, size === "sm" && "nh-btn--sm", block && "nh-btn--block", "interactive", className)}
      {...rest}
    >
      {children}
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
