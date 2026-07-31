import { useEffect, useState } from "react";

/**
 * **761–849px: the icon rail is the default, and the component has to know it.**
 *
 * `codex.css` pins `.codex-shell` to a 56px sidebar track from 761px up and only widens it to 220px at
 * 850px, so the whole band is a rail by layout. Neither shell knew: `collapsed` came solely from the
 * GM's persisted `codex-sidebar` preference (default "open") and the player passed none at all, so at
 * 768px — an iPad in portrait, a half-width laptop window — thirteen labels, three group eyebrows and
 * the ⌘K chip rendered into 20px of content box, spilling over the main column. The hamburger and the
 * phone drawer are both hidden in that band, so the broken strip was the only navigation there was.
 *
 * CSS alone would not have been enough. `SidebarNav` withholds each item's `title`/`aria-label` unless
 * `collapsed` is true, so hiding the labels in a stylesheet would have produced unlabelled icons with no
 * tooltip and no accessible name — worse than the rail it was imitating. The query lives here so both
 * shells read the same one, and `codex.css` carries the matching presentation as a belt for this brace.
 *
 * The bounds are the D25 ladder's own numbers (760 / 850); nothing new is introduced.
 */
const RAIL_BAND = "(min-width: 761px) and (max-width: 849px)";

export function useSidebarRailBand(): boolean {
  const [inBand, setInBand] = useState(() => typeof window !== "undefined" && window.matchMedia(RAIL_BAND).matches);
  useEffect(() => {
    const query = window.matchMedia(RAIL_BAND);
    const onChange = () => setInBand(query.matches);
    query.addEventListener("change", onChange);
    // Read once on mount as well: the viewport can have crossed the boundary between the initial state
    // and the listener being attached (a rotation during load is the realistic case).
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, []);
  return inBand;
}
