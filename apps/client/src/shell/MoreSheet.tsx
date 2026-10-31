import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton, IconX, OverlayEdge } from "@vtt/ui";
import "./more-sheet.css";

/**
 * The phone's More sheet (frame spec 2.2): it opens above the bottom tabs, which stay in view with More lit, its top
 * edge on the horizon and a grab handle, and holds who you are, Search and the laptop menu's rows in the same order.
 * The scrim covers the page and its header only. Focus moves in, and Escape, the scrim or More close it.
 */
export function MoreSheet({ onClose, children }: Readonly<{ onClose: () => void; children: ReactNode }>) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    sheet.current
      ?.querySelector<HTMLElement>("button, [href], input, select, [tabindex]:not([tabindex='-1'])")
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  // Closing after a row is chosen, as a menu does.
  const closeAfterRow = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[role='menuitem'], a")) onClose();
  };
  return createPortal(
    <>
      <div className="more-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={sheet} className="more-sheet" role="dialog" aria-modal="true" aria-label="More">
        <OverlayEdge />
        <span className="more-handle" aria-hidden="true" />
        <div className="more-head">
          <h2 className="more-title">More</h2>
          <IconButton label="Close" onClick={onClose}>
            <IconX />
          </IconButton>
        </div>
        <div className="more-rows scroll-y" role="menu" aria-label="More" onClick={closeAfterRow}>
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}
