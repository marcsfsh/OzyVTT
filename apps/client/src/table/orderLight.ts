import { useLayoutEffect, useRef, type RefObject } from "react";
import { burst, canMove, comet, drain, fadeIn, flipFrom, lightLamps, px, sunFrame, type Axis, type Box } from "@vtt/ui";

/** How a list of turns lights (ADR-0045, Turn flow and Initiative): what to measure, and where its rail runs. */
export interface OrderLight {
  /** The order, by key (an actor id). */
  keys: readonly string[];
  acting: string | null;
  /** The round while an encounter runs; null between encounters. */
  round: number | null;
  /** A key's row or tile: it slides when the order changes. */
  item: (key: string) => HTMLElement | null;
  /** Where on it the light lands; the item unless given (a tile's portrait). */
  point?: (key: string) => HTMLElement | null;
  /** A key's sun-framed picture, so the frame can slide to the next one. */
  frame?: (key: string) => HTMLElement | null;
  /** The round counter: a new round runs back to it, and an encounter starts from it and ends at it. */
  counter?: () => HTMLElement | null;
  axis: Axis;
  /** Where the rail runs across the trip, in the host's coordinates. */
  rail: (host: HTMLElement) => number;
  /** Lights the turn's lamps in order on a new turn and as an encounter starts. One list on screen does this. */
  lamps?: boolean;
}

interface Seen {
  keys: readonly string[];
  acting: string | null;
  round: number | null;
  items: Map<string, DOMRect>;
  points: Map<string, DOMRect>;
  frames: Map<string, DOMRect>;
  counter: DOMRect | null;
}

function measure(o: OrderLight): Seen {
  const rects = (find?: (key: string) => HTMLElement | null) => {
    const found = new Map<string, DOMRect>();
    if (find)
      for (const key of o.keys) {
        const el = find(key);
        if (el) found.set(key, el.getBoundingClientRect());
      }
    return found;
  };
  return {
    keys: [...o.keys],
    acting: o.acting,
    round: o.round,
    items: rects(o.item),
    points: rects(o.point ?? o.item),
    frames: rects(o.frame),
    counter: o.counter?.()?.getBoundingClientRect() ?? null
  };
}

/** Keys whose place in the order changed, with both places. */
function moved(before: readonly string[], after: readonly string[]) {
  return after
    .map((key, index) => ({ key, from: before.indexOf(key), to: index }))
    .filter((entry) => entry.from !== -1 && entry.from !== entry.to);
}

/**
 * Runs the turn order's light after each render that changed it. A new turn runs a comet along the rail from the
 * acting creature to the next, with a burst where it lands, and the sun frame slides across. A new round runs the
 * light back to the round counter. An encounter starting runs it from the counter to the first creature; ending runs
 * it back. When the order changes the rows slide to their new places, a creature that joins fades into the gap, one
 * that leaves drains its line away and a swap sends a comet each way.
 */
export function useOrderLight(host: RefObject<HTMLElement | null>, o: OrderLight): void {
  const last = useRef<Seen | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    const before = last.current;
    const now = measure(o);
    last.current = now;
    if (!el || !before || !canMove()) return;

    const frame = el.getBoundingClientRect();
    const local = (r: DOMRect): Box => {
      const x = r.left - frame.left - el.clientLeft + el.scrollLeft;
      const y = r.top - frame.top - el.clientTop + el.scrollTop;
      return {
        x,
        y,
        w: r.width,
        h: r.height,
        cx: x + r.width / 2,
        cy: y + r.height / 2,
        r: x + r.width,
        b: y + r.height
      };
    };
    // A trip stays inside the host, so a tile scrolled out of view never pushes light past the page's edge.
    const end = o.axis === "x" ? el.clientWidth : el.clientHeight;
    const along = (r: DOMRect) => {
      const box = local(r);
      return Math.max(0, Math.min(end, o.axis === "x" ? box.cx : box.cy));
    };
    const line = o.rail(el);
    const trip = (from: number, to: number, delay: number, dur: number) =>
      comet(el, { from, to, line, axis: o.axis, thick: 3, delay, dur });
    const land = (at: number, delay: number, w = 90) => burst(el, { at, line, axis: o.axis, delay, w, h: 8 });

    if (before.round === null && o.round !== null) {
      const first = o.acting ? now.points.get(o.acting) : undefined;
      if (now.counter && first) {
        trip(along(now.counter), along(first), 80, 250);
        land(along(first), 300);
      }
      const framed = o.acting ? now.frames.get(o.acting) : undefined;
      if (framed) sunFrame(el, { from: local(framed), mode: "arrive", delay: 300 });
      // Each creature's number lands in turn.
      o.keys.forEach((key, index) => {
        const score = o.item(key)?.querySelector(".turn-tile-score");
        if (score) fadeIn(score, { delay: index * 60, dur: 160 });
      });
      if (o.lamps) lightLamps(document, { delay: 340 });
      return;
    }
    if (before.round !== null && o.round === null) {
      const from = before.acting ? before.points.get(before.acting) : undefined;
      if (from && now.counter) {
        trip(along(from), along(now.counter), 220, 260);
        land(along(now.counter), 450);
      }
      // The sun frame leaves only while its picture is still on screen: the strip swaps its tiles for the status line.
      const framed = before.acting ? before.frames.get(before.acting) : undefined;
      if (framed && before.acting && o.frame?.(before.acting))
        sunFrame(el, { from: local(framed), mode: "leave", delay: 200 });
      return;
    }
    if (o.round === null) return;

    const same = before.keys.length === o.keys.length && before.keys.every((key, index) => key === o.keys[index]);
    if (!same) {
      for (const key of o.keys) {
        const item = o.item(key);
        const was = before.items.get(key);
        if (!item) continue;
        if (was) flipFrom(item, was);
        else {
          fadeIn(item, { delay: 120, dur: 180 });
          const at = now.points.get(key);
          if (at) land(along(at), 200, 70);
        }
      }
      for (const key of before.keys) {
        const was = before.items.get(key);
        if (o.keys.includes(key) || !was) continue;
        dropMark(el, local(was), o.axis, line);
      }
      const swapped = moved(before.keys, o.keys);
      if (swapped.length === 2) {
        const [a, b] = swapped.map((entry) => now.points.get(entry.key));
        if (a && b) {
          trip(along(a), along(b), 60, 240);
          trip(along(b), along(a), 60, 240);
        }
      }
    }

    if (!o.acting || !before.acting || o.acting === before.acting) return;
    const from = before.points.get(before.acting);
    const to = now.points.get(o.acting);
    const newRound = before.round !== null && o.round > before.round;
    if (newRound && now.counter && from) {
      trip(along(from), along(now.counter), 0, 280);
      land(along(now.counter), 250);
    } else if (from && to) {
      trip(along(from), along(to), 0, 220);
      land(along(to), 190);
    }
    const framedFrom = before.frames.get(before.acting);
    const framedTo = now.frames.get(o.acting);
    if (framedFrom && framedTo)
      sunFrame(el, { from: local(framedFrom), to: local(framedTo), mode: "slide", dur: newRound ? 260 : 200 });
    if (o.lamps) lightLamps(document, { delay: newRound ? 320 : 200 });
  });
}

/** A creature leaving the order: its stretch of the rail drains away where it was. */
function dropMark(host: HTMLElement, was: Box, axis: Axis, line: number) {
  const mark = host.ownerDocument.createElement("span");
  mark.className = "lr-part lr-drop-mark";
  mark.setAttribute("aria-hidden", "true");
  Object.assign(
    mark.style,
    axis === "x"
      ? { left: px(was.x), width: px(was.w), top: px(line - 1), height: "2px" }
      : { top: px(was.y), height: px(was.h), left: px(line - 1), width: "2px" }
  );
  host.append(mark);
  const gone = drain(mark, { axis, origin: "50%", fill: "forwards", dur: 260 });
  const remove = () => mark.remove();
  if (gone) gone.finished.then(remove, remove);
  else remove();
}
