import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cx } from "./util";
import { IconChevron } from "./icons";
import "./Menu.css";

interface MenuProps {
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
export function Menu({
  trigger,
  children,
  align = "start",
  label,
  hideCaret = false,
  icon = false,
  className,
  triggerClassName
}: MenuProps) {
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
    /* The popover is `position: fixed`, placed from the trigger on open and on resize, rotate or scroll, so a
       scrolling ancestor can't clip it (a menu in a scrolled list would otherwise lose its lower items to the page
       behind). It lines up with the trigger's start or end edge inside the viewport, and opens below unless there
       is more room above. offsetWidth/offsetHeight ignore `.anim-popover`'s entrance transform. A Menu must not sit
       inside a transformed or filtered ancestor, which would become the fixed box's containing block. */
    const place = () => {
      const pop = popoverRef.current;
      const trigger = el.querySelector("summary");
      if (!el.open || !pop || !trigger) return;
      const style = getComputedStyle(pop);
      const gutter = parseFloat(style.getPropertyValue("--nh-menu-gutter")) || 0;
      const gap = parseFloat(style.getPropertyValue("--nh-menu-gap")) || 0;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      const start = el.classList.contains("nh-menu--end") ? rect.right - width : rect.left;
      const roomBelow = viewportHeight - rect.bottom - gutter - gap;
      const roomAbove = rect.top - gutter - gap;
      const up = height > roomBelow && roomAbove > roomBelow;
      pop.style.left = `${Math.round(Math.max(gutter, Math.min(start, viewportWidth - gutter - width)))}px`;
      pop.style.top = `${Math.round(up ? rect.top - gap - height : rect.bottom + gap)}px`;
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    el.addEventListener("toggle", place);
    window.addEventListener("resize", place);
    // Capture, because the list the menu sits in scrolls, not the window.
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("toggle", place);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);

  const closeAfterItem = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[role='menuitem'], a, button") && ref.current) ref.current.open = false;
  };

  return (
    <details ref={ref} className={cx("nh-menu", `nh-menu--${align}`, className)}>
      <summary
        className={cx("nh-menu-trigger", icon && "nh-menu-trigger--icon", "interactive", triggerClassName)}
        aria-label={label}
        aria-haspopup="menu"
      >
        <span className="nh-menu-trigger-label">{trigger}</span>
        {!hideCaret && !icon && (
          <span className="nh-menu-caret" aria-hidden="true">
            <IconChevron />
          </span>
        )}
      </summary>
      <div ref={popoverRef} className="nh-menu-popover anim-popover" role="menu" onClick={closeAfterItem}>
        {children}
      </div>
    </details>
  );
}

interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  tone?: "default" | "danger";
}
export function MenuItem({ icon, tone = "default", className, type = "button", children, ...rest }: MenuItemProps) {
  return (
    <button
      role="menuitem"
      type={type}
      className={cx("nh-menu-item", tone === "danger" && "nh-menu-item--danger", className)}
      {...rest}
    >
      {icon != null && (
        <span className="nh-menu-item-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
