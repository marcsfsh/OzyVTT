import type { KeyboardEvent, ReactNode } from "react";
import { useId } from "react";
import { cx } from "./util";
import { IconX } from "./icons";
import "./Drawer.css";

export interface DrawerProps {
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
 * NON-MODAL side panel: a console that stays open ALONGSIDE a working view (the Codex
 * session console sits beside a live Codex mode, the way a browser's devtools sit beside
 * the page). Everything about it follows from that one word.
 *
 * Why it is NOT built on `Modal`. `Modal` is `<dialog>.showModal()`, which is the right
 * base for a decision that must be answered before anything else happens: it puts the
 * dialog in the top layer, traps focus, makes the rest of the document inert, and this
 * repo's `Modal` also scroll-locks the body and dims behind a blurred scrim. Every one of
 * those would break a drawer — a panel you consult while you keep working cannot make the
 * thing you are working on unreachable. So there is no `showModal()`, no scrim, no focus
 * trap, and no scroll lock here, by design and not by omission.
 *
 * Why `<aside>` rather than `role="dialog"`. A dialog role promises focus containment
 * that a non-modal panel deliberately does not provide; a screen-reader user who tabs
 * straight out of something announced as a dialog is worse served than one who tabs out
 * of a named complementary landmark — which is also how the panel gets found in the first
 * place. The panel carries its title as its accessible name.
 *
 * Escape closes it, but only while focus is INSIDE it. A global key listener would be a
 * modal's behaviour smuggled back in: it would eat Escape from the mode still running
 * behind the drawer, which is exactly the surface the drawer exists to leave alone.
 *
 * It stays mounted while closed (translated off-screen, `visibility: hidden` and `inert`)
 * so the slide plays in both directions and nothing inside is focusable or announced in
 * between. Callers keep their own open state — persisting it is the caller's business.
 */
export function Drawer({ open, onClose, title, children, side = "right", ariaLabel, className }: DrawerProps) {
  const titleId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    // Scoped, not global: only a keypress that started inside the drawer closes it.
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      className={cx("nh-drawer", `nh-drawer--${side}`, open && "is-open", className)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId}
      inert={!open}
      onKeyDown={onKeyDown}
    >
      <header className="nh-drawer-head">
        <h2 className="nh-drawer-title" id={titleId}>{title}</h2>
        <button type="button" className="nh-drawer-close tap-target interactive" aria-label="Close" onClick={onClose}><IconX /></button>
      </header>
      <div className="nh-drawer-body scroll-y">{children}</div>
    </aside>
  );
}
