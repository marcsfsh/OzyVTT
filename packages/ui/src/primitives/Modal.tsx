import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cx } from "./util";
import type { PanelAccent } from "./Panel";
import "./Modal.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Top accent hairline; magenta by default (§5.4: one accent hairline). */
  accent?: PanelAccent;
  /** `full` is the full-screen sheet: a roomy centred surface on a laptop, edge-to-edge
      over the whole viewport at ≤760px. Reach for it instead of overriding max-height. */
  size?: "sm" | "md" | "lg" | "full";
  /** Accessible label when there's no visible title. */
  ariaLabel?: string;
  className?: string;
  /** Inline style for the dialog element (e.g. a CSS custom property that drives a resizable width). */
  style?: CSSProperties;
}

/** Native <dialog> + showModal(): browser-managed focus trap, focus return to
    the opener on close, and Escape handling. Adds scrim blur, scroll lock, and
    click-outside-to-close. One primary action belongs in the footer. */
export function Modal({ open, onClose, title, children, footer, accent = "magenta", size = "md", ariaLabel, className, style }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => { event.preventDefault(); onClose(); };
    const onClick = (event: MouseEvent) => { if (event.target === dialog) onClose(); };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
    };
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return (
    <dialog ref={ref} className={cx("nh-modal", `nh-modal--${size}`, "anim-dialog", className)} style={style} aria-label={ariaLabel}>
      {open && (
        <div className={cx("nh-modal-surface", accent !== "none" && `nh-modal--accent-${accent}`)}>
          {title != null && (
            <header className="nh-modal-head">
              <h2 className="nh-modal-title">{title}</h2>
              <button type="button" className="nh-modal-close tap-target interactive" aria-label="Close" onClick={onClose}>✕</button>
            </header>
          )}
          <div className="nh-modal-body scroll-y">{children}</div>
          {footer != null && <footer className="nh-modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
