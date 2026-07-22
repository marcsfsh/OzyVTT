import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./util";
import "./Panel.css";

export type PanelAccent = "none" | "magenta" | "cyan" | "violet";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Optional 2px top hairline labelling the panel kind (magenta = combat,
      cyan = notes/info, violet = special). Used sparingly and consistently. */
  accent?: PanelAccent;
  /** Frosted, semi-transparent surface for sticky/floating panels (§7.8). */
  frost?: boolean;
  /** Clickable card: adds press feedback + a hover-lift. */
  interactive?: boolean;
  /** Hover-lift only (no press inversion). */
  lift?: boolean;
  /** One-shot entrance animation when the panel mounts. */
  entrance?: boolean;
}

/** Resting surface: surface-1, 1px line, radius-md, no glow. A panel glows only
    while it is the active target (add .is-active-turn / .is-selected then). */
export function Panel({ accent = "none", frost = false, interactive = false, lift = false, entrance = false, className, children, ...rest }: PanelProps) {
  return (
    <section
      className={cx(
        "nh-panel",
        accent !== "none" && `nh-panel--accent-${accent}`,
        frost && "surface-frost",
        interactive && "interactive",
        (interactive || lift) && "lift",
        entrance && "anim-view",
        className
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export interface PanelHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Right-aligned controls (buttons, menus). */
  actions?: ReactNode;
  className?: string;
}
export function PanelHeader({ title, eyebrow, actions, className }: PanelHeaderProps) {
  return (
    <header className={cx("nh-panel-head", className)}>
      <div className="nh-panel-headings">
        {eyebrow != null && <span className="nh-eyebrow">{eyebrow}</span>}
        <h2 className="nh-panel-title">{title}</h2>
      </div>
      {actions != null && <div className="nh-panel-actions">{actions}</div>}
    </header>
  );
}
