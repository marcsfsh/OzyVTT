import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./util";
import { IconArrow } from "./icons";
import "./Button.css";

/* The label box (see `Button`): an element no page stylesheet names, so no container rule reaches it. */
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- JSX's intrinsic elements live in this namespace
  namespace JSX {
    interface IntrinsicElements {
      "nh-label": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "link" | "destructive";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width. */
  block?: boolean;
  /** Add a hover-lift, for card-like and CTA buttons. Dense toolbars go without. */
  lift?: boolean;
  /** Append a forward arrow that nudges on hover, for navigational actions. */
  arrow?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** The one button. Variants map to the semantic roles in the design language: primary = the Cup (one per view,
    its label names its result), secondary = a flat control with an edge, ghost = quiet text, link = cyan words,
    destructive = danger. Labels are written in sentence case; the primary shows its label in capitals. */
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
      className={cx(
        "nh-btn",
        `nh-btn--${variant}`,
        size === "sm" && "nh-btn--sm",
        // The small primary's own 44px box is its hit area; its `::after` draws the Cup's lines.
        size === "sm" && variant !== "primary" && "tap-target",
        block && "nh-btn--block",
        "interactive",
        lift && "lift",
        className
      )}
      {...rest}
    >
      {/* The label takes its ink from the variant (`--nh-ink`), so a page rule that colours buttons in a container
          can't put dark ink on the primary's dark plate. Its own element name keeps the many `.x span` rules off it. */}
      <nh-label>
        {children}
        {arrow && <IconArrow className="nav-arrow" />}
      </nh-label>
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; required because icon-only buttons have no text. */
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
      className={cx("nh-iconbtn", size === "sm" && "nh-iconbtn--sm", "tap-target", "interactive", className)}
      {...rest}
    >
      {children as ReactNode}
    </button>
  );
}
