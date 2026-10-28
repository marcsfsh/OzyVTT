/**
 * Light rail for overlays (ADR-0045, group 2): a dialog, a menu, a drawer or a toast opens with its top edge lit from
 * the control that opened it, and closes with that edge draining back while the surface fades. The surface itself is
 * never held open for the light: an overlay that closes leaves an inert copy of itself behind for the fade, so focus,
 * Escape and the backdrop behave exactly as they would with no motion.
 */
import { burst, canMove, comet, drain, EASE, fill, lightTiming, px } from "./lightRail";

/** The element a person last pressed. Safari doesn't focus a button it taps, so focus alone can't name the opener. */
let pressed: { el: Element; at: number } | null = null;
if (typeof document !== "undefined")
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target instanceof Element) pressed = { el: event.target, at: performance.now() };
    },
    true
  );

/** What just opened an overlay: the control pressed in the last moment, or the focused one for a keyboard. */
export function openerNow(): Element | null {
  const recent = pressed && performance.now() - pressed.at < 1000 && pressed.el.isConnected ? pressed.el : null;
  if (recent) return recent.closest("button, a, summary, [role='button'], [role='tab']") ?? recent;
  const focused = typeof document === "undefined" ? null : document.activeElement;
  return focused && focused !== document.body ? focused : null;
}

/** Where along a surface's top edge the light starts: under the opener, kept 12px inside its ends. */
export function openerX(surface: Element, opener: Element | null): number | null {
  if (!opener?.isConnected) return null;
  const around = surface.getBoundingClientRect();
  const from = opener.getBoundingClientRect();
  if (from.width === 0 && from.height === 0) return null;
  const x = from.left + from.width / 2 - around.left;
  return Math.max(12, Math.min(around.width - 12, x));
}

export type EdgeEntry =
  /** Fills outward from a point on the edge, with a burst there: a dialog or menu from its opener. */
  | { at: number; delay?: number; dur?: number; burstW?: number }
  /** A comet runs the length of the edge and the edge fills behind it: a toast, or a drawer from its open side. */
  | { sweep: "right" | "left" };

/**
 * Lights an overlay's top edge as it opens. Returns where the light started, as a transform origin along the edge:
 * closing drains the line back there.
 */
export function edgeIn(surface: HTMLElement, edge: HTMLElement, entry: EdgeEntry): string {
  for (const running of edge.getAnimations?.() ?? []) running.cancel();
  const line = edge.offsetTop + edge.offsetHeight / 2;
  if ("at" in entry) {
    const delay = entry.delay ?? 40;
    fill(edge, { origin: px(entry.at), delay, dur: entry.dur ?? 220 });
    burst(surface, { at: entry.at, line, delay, w: entry.burstW ?? 100 });
    return px(entry.at);
  }
  const w = surface.clientWidth;
  const right = entry.sweep === "right";
  comet(surface, { from: right ? 0 : w, to: right ? w : 0, line, thick: 3, delay: 40, dur: 230 });
  fill(edge, { origin: right ? "0%" : "100%", delay: 60, dur: 230 });
  burst(surface, { at: right ? w : 0, line, delay: 240, w: 70 });
  return right ? "0%" : "100%";
}

export interface GhostOptions {
  /** Where the copy's top edge drains back to, from `edgeIn`. */
  origin?: string;
  /** How the surface leaves: it fades, it drops off the bottom of the screen, or it fades as it sinks a little. */
  leave: "fade" | "drop" | "sink";
  /** Fades a scrim with it, for a modal's backdrop. */
  scrim?: boolean;
  /** Classes the copy's frame carries, so styles keyed on the overlay's own element still apply. */
  frame?: string;
  /** Shows the copy only once the surface has left the page: React's StrictMode remounts a surface it never removed. */
  whenGone?: boolean;
}

/**
 * An overlay closing: an inert copy of `surface`, where it is now, drains its edge and leaves. The copy has no ids,
 * takes no pointer, is hidden from assistive tech and is removed when it has gone. Without motion nothing is drawn.
 */
export function ghostOut(surface: HTMLElement, o: GhostOptions): void {
  if (!canMove() || !surface.isConnected) return;
  const box = surface.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const doc = surface.ownerDocument;
  const frame = doc.createElement("div");
  frame.className = `lr-ghost ${o.frame ?? ""}`.trim();
  frame.setAttribute("aria-hidden", "true");
  frame.inert = true;
  Object.assign(frame.style, {
    position: "fixed",
    margin: "0",
    maxWidth: "none",
    maxHeight: "none",
    left: px(box.left),
    top: px(box.top),
    width: px(box.width),
    height: px(box.height)
  });
  const copy = surface.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  for (const named of copy.querySelectorAll("[id]")) named.removeAttribute("id");
  copy.classList.remove("anim-popover", "anim-dialog", "anim-sheet");
  Object.assign(copy.style, { position: "absolute", inset: "0", margin: "0", maxHeight: "none", maxWidth: "none" });
  frame.append(copy);
  const scrim = o.scrim ? doc.createElement("div") : null;
  if (scrim) {
    scrim.className = "lr-ghost lr-ghost-scrim";
    scrim.setAttribute("aria-hidden", "true");
  }

  const show = () => {
    if (o.whenGone && surface.isConnected) return;
    if (scrim) doc.body.append(scrim);
    doc.body.append(frame);
    const edge = copy.querySelector<HTMLElement>(".nh-overlay-edge");
    if (edge) drain(edge, { origin: o.origin ?? "50%", fill: "forwards", dur: lightTiming(edge).drain });
    const leaving =
      o.leave === "drop"
        ? frame.animate([{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], {
            duration: 180,
            delay: 60,
            easing: EASE.in,
            fill: "forwards"
          })
        : frame.animate(
            [
              { opacity: 1, transform: "translateY(0)" },
              { opacity: 0, transform: o.leave === "sink" ? "translateY(8px)" : "translateY(0)" }
            ],
            {
              duration: o.leave === "sink" ? 160 : 140,
              delay: o.leave === "sink" ? 120 : 60,
              easing: EASE.in,
              fill: "forwards"
            }
          );
    const fading = scrim?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 160,
      delay: 60,
      easing: EASE.in,
      fill: "forwards"
    });
    const remove = () => {
      frame.remove();
      scrim?.remove();
    };
    leaving.finished.then(remove, remove);
    fading?.finished.then(
      () => scrim?.remove(),
      () => scrim?.remove()
    );
  };
  if (o.whenGone) queueMicrotask(show);
  else show();
}
