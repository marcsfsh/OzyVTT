import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@vtt/ui";
import { revealInRegion } from "../lib/reveal";

/**
 * Where an opened detail (a cast, an item, a copy into the spellbook) shows: in place of the list on a player's phone,
 * in the right column of a laptop's sheet, or in a drawer over the GM's narrow sheet.
 */
export type DetailPlace = Readonly<
  { kind: "inline" } | { kind: "drawer" } | { kind: "column"; host: HTMLElement | null }
>;

/**
 * One detail, placed as the sheet's width says. The tab that opens it owns it, so a detail closes with its tab. In
 * place it replaces the list it was opened from; the caller hides that list while it shows.
 */
export function SheetDetail({
  place,
  title,
  onClose,
  children
}: Readonly<{ place: DetailPlace; title: string; onClose: () => void; children: ReactNode }>) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The right column may be scrolled to its Hit Points, and a phone's list down to the tapped row: the new detail's
  // top comes into view.
  useEffect(() => {
    if (place.kind !== "drawer") revealInRegion(ref.current, "nearest", place.kind === "column" ? "smooth" : "auto");
  }, [place.kind, title]);
  if (place.kind === "drawer")
    return (
      <Modal open onClose={onClose} align="bottom" title={title}>
        {children}
      </Modal>
    );
  const body = (
    <div ref={ref} className="cs-detail">
      {children}
    </div>
  );
  if (place.kind === "column" && place.host) return createPortal(body, place.host);
  return body;
}
