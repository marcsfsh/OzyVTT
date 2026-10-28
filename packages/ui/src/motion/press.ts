import { cupPress } from "./lightRail";

/** Every primary is the Cup: the Button primitive's, and the encounter panel's own that share its look. */
const CUP = ".nh-btn--primary, .encounter-primary:not(.turn-prev, .is-quiet, .resume)";

function cupOf(target: EventTarget | null): HTMLElement | null {
  const button = target instanceof Element ? target.closest<HTMLElement>(CUP) : null;
  return button && !(button as HTMLButtonElement).disabled ? button : null;
}

/**
 * Lights every primary as it is pressed (ADR-0046), however it was rendered: a pointer lights the base from where it
 * went down, and a keyboard press, a click with no pointer, from the middle. Installed once per page; returns the
 * uninstall.
 */
export function installCupPress(doc: Document = document): () => void {
  const down = (event: PointerEvent) => {
    const button = cupOf(event.target);
    if (button) cupPress(button, event.clientX - button.getBoundingClientRect().left);
  };
  const click = (event: MouseEvent) => {
    if (event.detail !== 0) return;
    const button = cupOf(event.target);
    if (button) cupPress(button, button.offsetWidth / 2);
  };
  doc.addEventListener("pointerdown", down);
  doc.addEventListener("click", click);
  return () => {
    doc.removeEventListener("pointerdown", down);
    doc.removeEventListener("click", click);
  };
}
