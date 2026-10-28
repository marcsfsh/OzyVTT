import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { edgeIn, ghostOut, openerX } from "../motion/overlay";
import { cx } from "./util";
import { IconChevron } from "./icons";
import { OverlayEdge } from "./OverlayEdge";
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
    on Escape, outside click or item activation. Its top edge lights from the trigger, and closing leaves an inert
    copy that drains the edge and fades (ADR-0045). */
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
  const edgeRef = useRef<HTMLSpanElement>(null);
  /** Where the edge lit from, so it drains back there. */
  const origin = useRef("50%");
  /** Closes the menu, leaving a copy of the popover to fade where it was. */
  const close = () => {
    const el = ref.current;
    if (!el?.open) return;
    if (popoverRef.current) ghostOut(popoverRef.current, { origin: origin.current, leave: "fade" });
    el.open = false;
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointerDown = (event: PointerEvent) => {
      if (el.open && !el.contains(event.target as Node)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && el.open) {
        closeRef.current();
        el.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    // The trigger closes an open menu natively; the copy is taken first, while the popover still shows.
    const summary = el.querySelector("summary");
    const onTriggerClick = () => {
      if (el.open && popoverRef.current) ghostOut(popoverRef.current, { origin: origin.current, leave: "fade" });
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
    const onToggle = () => {
      place();
      const pop = popoverRef.current;
      const edge = edgeRef.current;
      if (!el.open || !pop || !edge) return;
      const at = openerX(pop, summary);
      origin.current = edgeIn(pop, edge, at === null ? { sweep: "right" } : { at, delay: 20, dur: 160, burstW: 70 });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    summary?.addEventListener("click", onTriggerClick);
    el.addEventListener("toggle", onToggle);
    window.addEventListener("resize", place);
    // Capture, because the list the menu sits in scrolls and the window doesn't.
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      summary?.removeEventListener("click", onTriggerClick);
      el.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);

  const closeAfterItem = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[role='menuitem'], a, button")) close();
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
        <OverlayEdge ref={edgeRef} />
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
