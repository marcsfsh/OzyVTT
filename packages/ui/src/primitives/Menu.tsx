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
  /** Icon-square trigger: a compact 1.75rem square instead of the padded pill, for
      dense tool clusters (the ⋯ beside a card's drag grip). The 44px floor is met by
      the hit AREA, not the paint — see Menu.css. Implies `hideCaret`. */
  icon?: boolean;
  className?: string;
  triggerClassName?: string;
}

/** Disclosure menu built on native <details>/<summary> (§7.6): the caret rotates
    on open, the popover eases in, and it closes on Escape, outside-click, or item
    activation. Default marker is hidden. */
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
    /* Keep the open popover inside the viewport (Menu.css "Popover" note). CSS alone can
       cap the box's WIDTH but cannot know where in the viewport its trigger landed, so
       the offset is measured once per open and again on resize/rotate. Both edges are
       handled: a `--start` menu deep in a rail overflows right, a `--end` menu near the
       left margin overflows left. When the box cannot fit at all, the LEFT edge wins —
       labels read left to right.

       Geometry comes from offsetLeft/offsetWidth, NOT getBoundingClientRect(): the box
       carries `.anim-popover`, whose entrance keyframes animate `transform`, and a client
       rect includes that transform — measuring on open therefore read the box 10px right
       of where it settles and left it 10px out of place. Layout offsets are transform-free.
       Resetting the shift first keeps the function idempotent across repeat opens. */
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
