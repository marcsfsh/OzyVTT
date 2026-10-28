import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef } from "react";
import { useOnChange } from "../motion/hooks";
import { drain } from "../motion/lightRail";
import { edgeIn } from "../motion/overlay";
import { cx } from "./util";
import { IconX } from "./icons";
import { OverlayEdge } from "./OverlayEdge";
import "./Drawer.css";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Which edge it slides from; "right" reads as an inspector beside the work. */
  side?: "right" | "left";
  /** Accessible name override. Defaults to the visible title. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Non-modal side panel that stays open beside a working view (like devtools beside a page).
 * Not built on `Modal`: no top layer, scrim, focus trap or scroll lock, because the view behind must stay
 * usable. An `<aside>` landmark, because `role="dialog"` would promise focus containment. Escape
 * closes it only while focus is inside, so it never steals Escape from the view behind. It stays mounted while
 * closed (off-screen, hidden, `inert`) so the slide animates both ways. Callers own the open state. As it slides in, a
 * comet runs along its top edge the same way and the edge fills behind it; closing drains the edge (ADR-0045).
 */
export function Drawer({ open, onClose, title, children, side = "right", ariaLabel, className }: DrawerProps) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const edge = useRef<HTMLSpanElement>(null);
  // The light starts at the side the drawer comes from, and the edge drains back there.
  useOnChange(open, (_was, now) => {
    if (!panel.current || !edge.current) return;
    if (now) edgeIn(panel.current, edge.current, { sweep: side === "right" ? "left" : "right" });
    else drain(edge.current, { origin: side === "right" ? "100%" : "0%", fill: "forwards" });
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    // Scoped: only a keypress inside the drawer closes it.
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      ref={panel}
      className={cx("nh-drawer", `nh-drawer--${side}`, open && "is-open", className)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId}
      inert={!open}
      /* `inert` removes the closed panel from tab order and the accessibility tree where supported; `aria-hidden`
         covers other engines, and is safe because `inert` already made the subtree unfocusable. */
      aria-hidden={!open || undefined}
      onKeyDown={onKeyDown}
    >
      <OverlayEdge ref={edge} />
      <header className="nh-drawer-head">
        <h2 className="nh-drawer-title" id={titleId}>
          {title}
        </h2>
        <button type="button" className="nh-drawer-close tap-target interactive" aria-label="Close" onClick={onClose}>
          <IconX />
        </button>
      </header>
      <div className="nh-drawer-body scroll-y">{children}</div>
    </aside>
  );
}
