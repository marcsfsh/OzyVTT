/**
 * Brings `element` into view by scrolling its own scroll region (the closest `.scroll-y`) alone. `scrollIntoView` also
 * scrolls every clipping box above the region once the region runs out of room, which moves the docked table out of
 * place on a phone. "start" puts the element's top at the region's top; "nearest" scrolls only as far as it must.
 */
export function revealInRegion(
  element: HTMLElement | null,
  block: "start" | "nearest" = "nearest",
  behavior: ScrollBehavior = "auto"
): void {
  const region = element?.parentElement?.closest<HTMLElement>(".scroll-y");
  if (!element || !region) return;
  // Inside a closed disclosure there is nothing to bring into view, and Chromium still lays the content out.
  if (element.closest("details:not([open])")) return;
  const box = element.getBoundingClientRect();
  const frame = region.getBoundingClientRect();
  const above = box.top - frame.top;
  const below = box.bottom - frame.bottom;
  const by = block === "start" ? above : above < 0 ? above : below > 0 ? Math.min(above, below) : 0;
  if (by !== 0) region.scrollTo({ top: region.scrollTop + by, behavior });
}
