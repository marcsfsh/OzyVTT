import { canMove, EASE } from "@vtt/ui";
import "./map-light.css";

const SVG = "http://www.w3.org/2000/svg";
type Point = Readonly<{ x: number; y: number }>;

/** A throwaway SVG part in map units that removes itself when its animation ends. */
function part<K extends keyof SVGElementTagNameMap>(
  layer: Element,
  tag: K,
  className: string,
  attrs: Readonly<Record<string, string | number>>,
  before?: Element | null
): SVGElementTagNameMap[K] {
  const el = layer.ownerDocument.createElementNS(SVG, tag);
  el.setAttribute("class", `lr-part ${className}`);
  el.setAttribute("aria-hidden", "true");
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  layer.insertBefore(el, before ?? null);
  return el;
}

function removeWhenDone(el: Element, animation: Animation) {
  const remove = () => el.remove();
  animation.finished.then(remove, remove);
}

/**
 * A token moving (ADR-0045, group 6): it glides from where it was in 240 ms, and a trail in its ring's colour draws
 * behind it and drains from the start. `token` is the token's group, placed with a translate to its centre.
 */
export function glideToken(token: SVGGElement, from: Point, to: Point, size: number, tone: string): void {
  if (!canMove() || !token.parentNode) return;
  token.animate(
    [{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: `translate(${to.x}px, ${to.y}px)` }],
    { duration: 240, easing: EASE.settle }
  );
  const trail = part(
    token.parentNode as Element,
    "line",
    `lr-trail ${tone}`,
    { x1: from.x, y1: from.y, x2: to.x, y2: to.y, pathLength: 1, "stroke-width": Math.max(3, size * 0.12) },
    token
  );
  removeWhenDone(
    trail,
    trail.animate([{ strokeDashoffset: 1 }, { offset: 0.55, strokeDashoffset: 0 }, { strokeDashoffset: -1 }], {
      duration: 440,
      easing: "linear",
      fill: "both"
    })
  );
  svgPop(token.parentNode as Element, to, size * 0.65, tone, 220);
}

/** The round burst in map units: a ring that grows and fades where something landed. */
export function svgPop(layer: Element, at: Point, radius: number, tone: string, delay = 0): void {
  if (!canMove()) return;
  const ring = part(layer, "circle", `lr-svg-pop ${tone}`, { cx: at.x, cy: at.y, r: radius });
  removeWhenDone(
    ring,
    ring.animate(
      [
        { opacity: 0, transform: "scale(0.3)" },
        { offset: 0.25, opacity: 1 },
        { opacity: 0, transform: "scale(1.3)" }
      ],
      { duration: 240, delay, easing: "ease-out", fill: "both" }
    )
  );
}

/** A door swinging open on its hinge (`a`), as a copy of its line that turns and fades, with a burst at the hinge. */
export function swingDoor(layer: Element, a: Point, b: Point, width: number): void {
  if (!canMove()) return;
  const leaf = part(layer, "line", "lr-door-swing", {
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    "stroke-width": width
  });
  leaf.style.transformOrigin = `${a.x}px ${a.y}px`;
  removeWhenDone(
    leaf,
    leaf.animate(
      [
        { transform: "rotate(0deg)", opacity: 1 },
        { transform: "rotate(-80deg)", opacity: 0 }
      ],
      { duration: 200, easing: EASE.out, fill: "both" }
    )
  );
  svgPop(layer, a, Math.hypot(b.x - a.x, b.y - a.y) * 0.35, "lr-tone-spark");
}

/** One red flash on a square as a trap springs. */
export function trapFlash(layer: Element, x: number, y: number, size: number): void {
  if (!canMove()) return;
  const square = part(layer, "rect", "lr-trap-flash", { x, y, width: size, height: size });
  removeWhenDone(
    square,
    square.animate([{ opacity: 0 }, { offset: 0.2, opacity: 0.85 }, { opacity: 0 }], {
      duration: 200,
      easing: "ease-out",
      fill: "both"
    })
  );
  svgPop(layer, { x: x + size / 2, y: y + size / 2 }, size, "lr-tone-red");
}

/** A light or a spell zone opening from its centre: it grows from half its size as it fades up, with a gold burst. */
export function spreadFrom(el: SVGGraphicsElement, at: Point, radius: number, layer: Element): void {
  if (!canMove()) return;
  el.style.transformOrigin = `${at.x}px ${at.y}px`;
  el.animate(
    [
      { opacity: 0, transform: "scale(0.5)" },
      { opacity: 1, transform: "scale(1)" }
    ],
    { duration: 280, easing: EASE.out }
  );
  svgPop(layer, at, radius * 0.4, "lr-tone-gold");
}

/**
 * Fog clearing (ADR-0045, group 6): a cover in the fog's colour over the newly revealed area clips away from its left
 * side, behind a thin edge of light that crosses ahead of the reveal.
 */
export function revealArea(
  layer: Element,
  area: Readonly<{ x: number; y: number; width: number; height: number }>,
  fogClass: string
): void {
  if (!canMove()) return;
  const cover = part(layer, "rect", fogClass, { x: area.x, y: area.y, width: area.width, height: area.height });
  removeWhenDone(
    cover,
    cover.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }], {
      duration: 340,
      easing: EASE.settle,
      fill: "both"
    })
  );
  const edge = part(layer, "rect", "lr-fog-edge", {
    x: area.x - 1,
    y: area.y,
    width: Math.max(2, area.width * 0.01),
    height: area.height
  });
  removeWhenDone(
    edge,
    edge.animate(
      [
        { transform: "translateX(0)", opacity: 1 },
        { offset: 0.85, opacity: 1 },
        { transform: `translateX(${area.width}px)`, opacity: 0 }
      ],
      { duration: 340, easing: EASE.settle, fill: "both" }
    )
  );
}
