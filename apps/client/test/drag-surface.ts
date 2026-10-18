/** Sends a cancelable touchmove to `element` and reports whether the page cancelled it, as a drag surface must. */
export function touchMoveCancelled(element: Element): boolean {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}
