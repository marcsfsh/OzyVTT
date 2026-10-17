import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { cx } from "./util";
import { IconX } from "./icons";
import type { PanelAccent } from "./Panel";
import "./Modal.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Top accent hairline; magenta by default. */
  accent?: PanelAccent;
  /** `full` is a roomy centred sheet on a laptop and edge-to-edge at ≤760px. Use it instead of overriding max-height. */
  size?: "sm" | "md" | "lg" | "full";
  /** `top` pins the dialog near the top of the viewport (the command-palette shape); `bottom` rests it on the bottom
      edge at full width, the drawer a phone opens under the thumb. */
  align?: "center" | "top" | "bottom";
  /** Accessible label when there's no visible title; a visible title names the dialog otherwise. */
  ariaLabel?: string;
  className?: string;
  /** Inline style for the dialog element (e.g. a CSS custom property that drives a resizable width). */
  style?: CSSProperties;
}

/** Native <dialog> + showModal(): browser-managed focus trap, focus return to
    the opener on close, and Escape handling. Adds scrim blur, scroll lock, and
    click-outside-to-close. One primary action belongs in the footer. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  accent = "magenta",
  size = "md",
  align = "center",
  ariaLabel,
  className,
  style
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
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
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx(
        "nh-modal",
        `nh-modal--${size}`,
        align !== "center" && `nh-modal--${align}`,
        align === "bottom" ? "anim-sheet" : "anim-dialog",
        className
      )}
      style={style}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined && title != null ? titleId : undefined}
    >
      {open && (
        <div className={cx("nh-modal-surface", accent !== "none" && `nh-modal--accent-${accent}`)}>
          {title != null && (
            <header className="nh-modal-head">
              <h2 className="nh-modal-title" id={titleId}>
                {title}
              </h2>
              <button
                type="button"
                className="nh-modal-close tap-target interactive"
                aria-label="Close"
                onClick={onClose}
              >
                <IconX />
              </button>
            </header>
          )}
          <div className="nh-modal-body scroll-y">{children}</div>
          {footer != null && <footer className="nh-modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
