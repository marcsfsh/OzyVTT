import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { canMove } from "../motion/lightRail";
import { edgeIn, ghostOut, openerNow, openerX } from "../motion/overlay";
import { cx } from "./util";
import { IconX } from "./icons";
import { OverlayEdge } from "./OverlayEdge";
import type { PanelAccent } from "./Panel";
import "./Modal.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** The top edge: the horizon's colours by default (magenta), cyan or violet, or none. It lights from the opener. */
  accent?: PanelAccent;
  /** `full` is a roomy centred sheet on a laptop and edge-to-edge at ≤760px. Use it and leave max-height alone. */
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
    click-outside-to-close. One primary action belongs in the footer. Its top edge lights outward from the control
    that opened it, and on closing an inert copy drains the edge and fades while the dialog itself closes at once
    (ADR-0045). */
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
  // The surface and its edge, kept in a box so the unmount cleanup reads the nodes it is leaving.
  const [nodes] = useState(() => ({
    dialog: null as HTMLDialogElement | null,
    surface: null as HTMLDivElement | null,
    edge: null as HTMLSpanElement | null,
    origin: "50%"
  }));
  const frame = cx("nh-modal", `nh-modal--${size}`, align !== "center" && `nh-modal--${align}`, className);
  const leave = align === "bottom" ? "drop" : "fade";

  // A dialog closed by its `open` prop keeps its surface for one render, so its copy can be taken before it goes.
  const [shown, setShown] = useState(open);
  const [held, setHeld] = useState(false);
  if (shown !== open) {
    setShown(open);
    setHeld(!open && canMove());
  }
  useLayoutEffect(() => {
    if (!held) return;
    const dialog = nodes.dialog;
    if (dialog?.open && nodes.surface) {
      ghostOut(nodes.surface, { origin: nodes.origin, leave, scrim: true, frame, whenGone: true });
      dialog.close();
    }
    setHeld(false);
  }, [held, nodes, leave, frame]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const opener = openerNow();
      dialog.showModal();
      if (nodes.surface && nodes.edge && canMove()) {
        const at = openerX(nodes.surface, opener);
        nodes.origin = edgeIn(nodes.surface, nodes.edge, at === null ? { sweep: "right" } : { at });
      }
    } else if (!open && !held && dialog.open) dialog.close();
  }, [open, held, nodes]);

  // Unmounted while open (a caller that renders the dialog only while it shows): the copy leaves in its place.
  useLayoutEffect(
    () => () => {
      if (nodes.dialog?.open && nodes.surface)
        ghostOut(nodes.surface, { origin: nodes.origin, leave, scrim: true, frame, whenGone: true });
    },
    // Read once, at unmount: the box holds the latest nodes and the frame never changes for a mounted dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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
      ref={(dialog) => {
        ref.current = dialog;
        nodes.dialog = dialog;
      }}
      className={cx(frame, align === "bottom" ? "anim-sheet" : "anim-dialog")}
      style={style}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined && title != null ? titleId : undefined}
    >
      {(open || held) && (
        <div
          ref={(surface) => {
            nodes.surface = surface;
          }}
          className={cx("nh-modal-surface", accent !== "none" && `nh-modal--accent-${accent}`)}
        >
          {accent !== "none" && (
            <OverlayEdge
              ref={(edge) => {
                nodes.edge = edge;
              }}
            />
          )}
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
