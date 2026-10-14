import { useEffect, useState } from "react";

/**
 * True in the 761-849px band, where `codex.css` fixes the sidebar to a 56px icon rail. The components must
 * know, because `SidebarNav` only adds each item's `title`/`aria-label` when `collapsed`; hiding labels in
 * CSS alone would leave unnamed icons.
 */
const RAIL_BAND = "(min-width: 761px) and (max-width: 849px)";

export function useSidebarRailBand(): boolean {
  const [inBand, setInBand] = useState(() => typeof window !== "undefined" && window.matchMedia(RAIL_BAND).matches);
  useEffect(() => {
    const query = window.matchMedia(RAIL_BAND);
    const onChange = () => setInBand(query.matches);
    query.addEventListener("change", onChange);
    // Read once on mount too: the viewport may cross the boundary before the listener attaches.
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, []);
  return inBand;
}
