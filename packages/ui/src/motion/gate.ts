/**
 * The motion gate (ADR-0045). A whole projection can change many things at once: on connect, on reconnect, when a tab
 * comes back from the background or when the GM switches encounter. Lighting all of them at once is noise, so the app
 * holds the gate shut across those renders and `canMove()` answers false while it is.
 */

let open = true;
let pending = 0;

/** Shuts the gate now, and drops a release that has not happened yet. */
export function holdMotion(): void {
  open = false;
  if (pending && typeof cancelAnimationFrame === "function") cancelAnimationFrame(pending);
  pending = 0;
}

/**
 * Opens the gate on the next animation frame, so whatever renders before it (the snapshot that arrived after a
 * reconnect) stays still. Call it after that render has committed.
 */
export function releaseMotion(): void {
  if (open || pending) return;
  if (typeof requestAnimationFrame !== "function") {
    open = true;
    return;
  }
  pending = requestAnimationFrame(() => {
    pending = 0;
    open = true;
  });
}

/** Whether the gate is open. */
export function motionReleased(): boolean {
  return open;
}
