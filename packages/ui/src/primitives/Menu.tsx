import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cx } from "./util";
import "./Menu.css";

export interface MenuProps {
  /** Trigger content (label and/or icon). */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  /** Accessible name when the trigger is icon-only. */
  label?: string;
  hideCaret?: boolean;
  className?: string;
  triggerClassName?: string;
}

/** Disclosure menu built on native <details>/<summary> (§7.6): the caret rotates
    on open, the popover eases in, and it closes on Escape, outside-click, or item
    activation. Default marker is hidden. */
export function Menu({ trigger, children, align = "start", label, hideCaret = false, className, triggerClassName }: MenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointerDown = (event: PointerEvent) => {
      if (el.open && !el.contains(event.target as Node)) el.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const closeAfterItem = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[role='menuitem'], a, button") && ref.current) ref.current.open = false;
  };

  return (
    <details ref={ref} className={cx("nh-menu", `nh-menu--${align}`, className)}>
      <summary className={cx("nh-menu-trigger", "interactive", triggerClassName)} aria-label={label} aria-haspopup="menu">
        <span className="nh-menu-trigger-label">{trigger}</span>
        {!hideCaret && <span className="nh-menu-caret" aria-hidden="true">▾</span>}
      </summary>
      <div className="nh-menu-popover anim-popover" role="menu" onClick={closeAfterItem}>
        {children}
      </div>
    </details>
  );
}

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  tone?: "default" | "danger";
}
export function MenuItem({ icon, tone = "default", className, type = "button", children, ...rest }: MenuItemProps) {
  return (
    <button role="menuitem" type={type} className={cx("nh-menu-item", tone === "danger" && "nh-menu-item--danger", className)} {...rest}>
      {icon != null && <span className="nh-menu-item-icon" aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
}
