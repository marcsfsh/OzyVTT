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
  /** Icon-square trigger: a compact 1.75rem square for dense tool clusters. The 44px floor is met by the hit area
      (see Menu.css). Implies `hideCaret`. */
  icon?: boolean;
  className?: string;
  triggerClassName?: string;
}

/** Disclosure menu on native <details>/<summary>: the caret rotates on open, the popover eases in, and it closes
    on Escape, outside click or item activation. */
export function Menu({ trigger, children, align = "start", label, hideCaret = false, icon = false, className, triggerClassName }: MenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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
    /* Keep the open popover inside the viewport horizontally, measured on open and on resize/rotate. When it can't
       fit, the left edge wins. Uses offsetLeft/offsetWidth rather than getBoundingClientRect(), which includes
       `.anim-popover`'s entrance transform and would misplace the box by 10px. Resetting the shift first keeps it
       idempotent. */
    const clampToViewport = () => {
      const pop = popoverRef.current;
      if (!el.open || !pop) return;
      pop.style.setProperty("--nh-menu-shift", "0px");
      const gutter = parseFloat(getComputedStyle(pop).getPropertyValue("--nh-menu-gutter")) || 0;
      const viewport = document.documentElement.clientWidth;
      const host = pop.offsetParent as HTMLElement | null;
      const left = (host ? host.getBoundingClientRect().left + host.clientLeft : 0) + pop.offsetLeft;
      const right = left + pop.offsetWidth;
      let shift = 0;
      if (right > viewport - gutter) shift = viewport - gutter - right;
      if (left + shift < gutter) shift = gutter - left;
      if (shift) pop.style.setProperty("--nh-menu-shift", `${Math.round(shift)}px`);

      /* Vertically, flip to whichever side has visible room. Room is bounded by every clipping ancestor, not just
         the window (e.g. the map stage's `overflow: hidden`); a `position: fixed` ancestor ends the walk. If neither
         side fits, take the side with more room. The trigger's rect is transform-free, and `offsetHeight` avoids the
         popover's entrance transform. */
      const trigger = el.querySelector("summary");
      if (!trigger) return;
      let top = 0;
      let bottom = document.documentElement.clientHeight;
      for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowY !== "visible" || style.overflowX !== "visible") {
          const box = node.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
        if (style.position === "fixed") break;
      }
      const rect = trigger.getBoundingClientRect();
      const height = pop.offsetHeight;
      const gap = parseFloat(getComputedStyle(pop).getPropertyValue("--nh-menu-gap")) || 0;
      const roomBelow = bottom - rect.bottom - gutter - gap;
      const roomAbove = rect.top - top - gutter - gap;
      el.classList.toggle("nh-menu--up", height > roomBelow && roomAbove > roomBelow);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    el.addEventListener("toggle", clampToViewport);
    window.addEventListener("resize", clampToViewport);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("toggle", clampToViewport);
      window.removeEventListener("resize", clampToViewport);
    };
  }, []);

  const closeAfterItem = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[role='menuitem'], a, button") && ref.current) ref.current.open = false;
  };

  return (
    <details ref={ref} className={cx("nh-menu", `nh-menu--${align}`, className)}>
      <summary className={cx("nh-menu-trigger", icon && "nh-menu-trigger--icon", "interactive", triggerClassName)} aria-label={label} aria-haspopup="menu">
        <span className="nh-menu-trigger-label">{trigger}</span>
        {!hideCaret && !icon && <span className="nh-menu-caret" aria-hidden="true">▾</span>}
      </summary>
      <div ref={popoverRef} className="nh-menu-popover anim-popover" role="menu" onClick={closeAfterItem}>
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
