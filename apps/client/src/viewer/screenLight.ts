import { useLayoutEffect, useRef, type RefObject } from "react";
import { burst, canMove, comet, EASE, wash } from "@vtt/ui";

/** How a viewBox lands on the screen: scale `k`, then offset (`preserveAspectRatio="xMidYMid meet"`). */
type Mapping = Readonly<{ k: number; x: number; y: number }>;

function mappingOf(svg: SVGSVGElement, viewBox: string): Mapping | null {
  const [vx, vy, vw, vh] = viewBox.split(" ").map(Number);
  const width = svg.clientWidth;
  const height = svg.clientHeight;
  if (!vw || !vh || !width || !height) return null;
  const k = Math.min(width / vw, height / vh);
  return { k, x: (width - vw * k) / 2 - vx * k, y: (height - vh * k) / 2 - vy * k };
}

/** The transform a running glide shows now, as scale and offset about the top left. */
function shownNow(svg: SVGSVGElement): Mapping {
  const matrix = new DOMMatrixReadOnly(
    getComputedStyle(svg).transform === "none" ? undefined : getComputedStyle(svg).transform
  );
  return { k: matrix.a, x: matrix.e, y: matrix.f };
}

/**
 * The table screen's light (ADR-0045, groups 6 and 14). Following the GM's camera, the view glides to each new framing
 * in 320 ms and a wash falls as it settles; a move mid-glide starts from where the view is. A new map is uncovered from
 * the left behind an edge of light, with a comet along the screen's top and a wash as it lands. Only the map's own
 * layer moves; the stage around it never does.
 */
export function useScreenLight(
  stage: RefObject<HTMLElement | null>,
  svg: RefObject<SVGSVGElement | null>,
  viewBox: string,
  mapId: string | null,
  following: boolean
): void {
  const last = useRef<{ viewBox: string; mapId: string | null; mapping: Mapping | null } | null>(null);
  useLayoutEffect(() => {
    const el = svg.current;
    const host = stage.current;
    const before = last.current;
    const mapping = el ? mappingOf(el, viewBox) : null;
    last.current = { viewBox, mapId, mapping };
    if (!el || !host || !before || !canMove()) return;
    if (before.mapId !== mapId && mapId !== null && before.mapId !== null) {
      sceneSweep(host, el);
      return;
    }
    if (!following || before.viewBox === viewBox || !before.mapping || !mapping) return;
    // Where the old view shows now (part way through a glide, or at rest), as a transform over the new one.
    const running = el.getAnimations().filter((animation) => animation.id === "screen-glide");
    const now = shownNow(el);
    const shown = {
      k: now.k * before.mapping.k,
      x: now.k * before.mapping.x + now.x,
      y: now.k * before.mapping.y + now.y
    };
    for (const animation of running) animation.cancel();
    const r = shown.k / mapping.k;
    const tx = shown.x - r * mapping.x;
    const ty = shown.y - r * mapping.y;
    const glide = el.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${r})` },
        { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1)" }
      ],
      { duration: 320, easing: EASE.travel }
    );
    glide.id = "screen-glide";
    // While it glides the map draws past its framing, so a zoom in never shows a cropped view shrunk in the middle of
    // the screen. The stage still clips at its edges.
    el.style.overflow = "visible";
    const settle = () => {
      if (!el.getAnimations().some((animation) => animation.id === "screen-glide" && animation.playState === "running"))
        el.style.overflow = "";
    };
    glide.finished.then(settle, settle);
    wash(host, { at: host.clientWidth / 2, h: host.clientHeight * 0.6, delay: 300, dur: 280 });
  }, [stage, svg, viewBox, mapId, following]);
}

/** A new scene: the map is uncovered from the left behind an edge of light, under a comet along the top. */
function sceneSweep(host: HTMLElement, map: SVGSVGElement) {
  const width = host.clientWidth;
  map.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], {
    duration: 700,
    easing: EASE.travel
  });
  const edge = host.ownerDocument.createElement("span");
  edge.className = "lr-part lr-edge-v";
  edge.setAttribute("aria-hidden", "true");
  Object.assign(edge.style, { left: "-1px", top: "0px", height: `${host.clientHeight}px` });
  host.append(edge);
  const sweep = edge.animate(
    [
      { transform: "translateX(0)", opacity: 1 },
      { offset: 0.9, opacity: 1 },
      { transform: `translateX(${width}px)`, opacity: 0 }
    ],
    { duration: 700, easing: EASE.travel, fill: "both" }
  );
  const remove = () => edge.remove();
  sweep.finished.then(remove, remove);
  comet(host, { from: 0, to: width, line: 1, delay: 0, dur: 700, maxLen: 320 });
  burst(host, { at: width - 30, line: 1, delay: 660, w: 160 });
  wash(host, { at: width * 0.8, h: host.clientHeight * 0.7, delay: 640, dur: 320 });
}
