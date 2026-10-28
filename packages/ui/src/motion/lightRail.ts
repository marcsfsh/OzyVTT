/**
 * Light rail (ADR-0045): the one motion language for change. Light travels along a line that is already on screen,
 * from where something was to where it is going: the old place drains, a comet runs, a burst lands and the new place
 * fills. A wash may fall onto what changed. The content itself only fades, so light never moves or resizes it.
 *
 * Each part takes the element it is drawn in (a positioned host) and returns its Animation, or null when the light
 * does not run. `canMove()` is the one guard: the Web Animations API ignores the stylesheet's reduced-motion rule.
 * Parts are throwaway `.lr-part` elements (styles/light-rail.css), hidden from assistive tech and from the pointer,
 * removed when their animation finishes or is cancelled.
 */
import { motionReleased } from "./gate";

export type Axis = "x" | "y";
export type Tone = "gold" | "cyan" | "red";

/** Easings. `travel` mirrors `--ease-travel` and `settle` mirrors `--ease-settle` (a test compares them). */
export const EASE = {
  settle: "cubic-bezier(0.22, 0.61, 0.36, 1)",
  travel: "cubic-bezier(0.45, 0, 0.25, 1)",
  out: "cubic-bezier(0.2, 0.7, 0.3, 1)",
  in: "cubic-bezier(0.5, 0, 0.75, 0)"
} as const;

/** The light's timings in ms, from the tokens in design-tokens.css. */
export interface LightTiming {
  drain: number;
  comet: number;
  fill: number;
  burst: number;
  wash: number;
  content: number;
  count: number;
  delayContent: number;
  delayFill: number;
  delayBurst: number;
  delayWash: number;
}

/** The token values, for when no stylesheet is loaded. A test keeps them equal to design-tokens.css. */
export const LIGHT_TIMING: Readonly<LightTiming> = {
  drain: 130,
  comet: 230,
  fill: 140,
  burst: 200,
  wash: 260,
  content: 200,
  count: 300,
  delayContent: 60,
  delayFill: 170,
  delayBurst: 210,
  delayWash: 200
};

export const TIMING_TOKENS: Readonly<Record<keyof LightTiming, string>> = {
  drain: "--dur-drain",
  comet: "--dur-comet",
  fill: "--dur-fill",
  burst: "--dur-burst",
  wash: "--dur-wash",
  content: "--dur-content",
  count: "--dur-count",
  delayContent: "--delay-content",
  delayFill: "--delay-fill",
  delayBurst: "--delay-burst",
  delayWash: "--delay-wash"
};

/** The comet leaves this long after the old place starts to drain. */
const COMET_DELAY = 40;
/** A comet's tail is as long as its trip, up to this. The table screen passes its own, larger cap. */
export const COMET_MAX = 260;
export const COMET_MAX_SCREEN = 320;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether light may run now. The media query is read on every call, because people change it with the app open;
 * jsdom has no `Element.prototype.animate`, so no unit test ever runs the light by accident.
 */
export function canMove(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return false;
  if (window.matchMedia?.(REDUCED_MOTION).matches) return false;
  if (document.visibilityState === "hidden") return false;
  return motionReleased();
}

/** A duration token such as `130ms` or `0.13s`, in ms. */
export function parseDuration(value: string): number | null {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] === "s" ? amount * 1000 : amount;
}

/** The light's timings as `el` sees the tokens, so a theme or a later setting can change them. */
export function lightTiming(el?: Element | null): LightTiming {
  if (!el || typeof getComputedStyle !== "function") return { ...LIGHT_TIMING };
  const style = getComputedStyle(el);
  const timing = { ...LIGHT_TIMING };
  for (const key of Object.keys(TIMING_TOKENS) as Array<keyof LightTiming>) {
    const value = parseDuration(style.getPropertyValue(TIMING_TOKENS[key]));
    if (value !== null) timing[key] = value;
  }
  return timing;
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Rounded to a tenth of a pixel, as a CSS length. */
export function px(n: number): string {
  return `${Math.round(n * 10) / 10}px`;
}

/** An element's box in a positioned host's padding-box coordinates, including the host's scroll offset. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  r: number;
  b: number;
}

export function rel(el: Element, host: Element): Box {
  const a = host.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  const x = b.left - a.left - host.clientLeft + host.scrollLeft;
  const y = b.top - a.top - host.clientTop + host.scrollTop;
  return { x, y, w: b.width, h: b.height, cx: x + b.width / 2, cy: y + b.height / 2, r: x + b.width, b: y + b.height };
}

interface Timed {
  dur?: number;
  delay?: number;
}

function play(el: Element, frames: Keyframe[], o: { dur: number; delay?: number; ease?: string; fill?: FillMode }) {
  return el.animate(frames, {
    duration: o.dur,
    delay: o.delay ?? 0,
    easing: o.ease ?? EASE.settle,
    fill: o.fill ?? "backwards"
  });
}

type Css = Readonly<Record<string, string>>;

function spawn(host: Element, className: string, css: Css): HTMLElement {
  const part = host.ownerDocument.createElement("span");
  part.className = `lr-part ${className}`.trim();
  part.setAttribute("aria-hidden", "true");
  for (const [key, value] of Object.entries(css)) part.style.setProperty(key, value);
  host.appendChild(part);
  return part;
}

/** A throwaway part that plays once and removes itself, whether it finishes or is cancelled. */
function temp(
  host: Element,
  className: string,
  css: Css,
  frames: Keyframe[],
  o: { dur: number; delay?: number; ease?: string }
): Animation {
  const part = spawn(host, className, css);
  const animation = play(part, frames, { ...o, fill: "both" });
  const remove = () => part.remove();
  animation.finished.then(remove, remove);
  return animation;
}

/** Cancels the light still running in `host`, so a new change starts from a clean line. */
export function clearLight(host: Element): void {
  for (const part of host.querySelectorAll(":scope > .lr-part"))
    for (const animation of part.getAnimations?.() ?? []) animation.cancel();
}

const toneClass = (tone?: Tone) => (tone ? ` lr-${tone}` : "");

export interface CometOptions extends Timed {
  /** Where the trip starts and ends along the line, in host coordinates. */
  from: number;
  to: number;
  /** The line across the trip: its y for a horizontal line, its x for a vertical one. */
  line: number;
  axis?: Axis;
  thick?: number;
  /** The tail's longest length; `COMET_MAX` unless given. */
  maxLen?: number;
  tone?: Tone;
}

/**
 * Where a comet sits and how it moves. The tail is as long as the trip up to the cap, reaches full length at 65% of
 * the time and shrinks into its head on arrival.
 */
export function cometPath(o: CometOptions) {
  const axis = o.axis ?? "x";
  const travel = o.to - o.from;
  const dir: 1 | -1 = travel >= 0 ? 1 : -1;
  const len = Math.max(24, Math.min(o.maxLen ?? COMET_MAX, Math.abs(travel)));
  const thick = o.thick ?? 4;
  const mid = o.from + travel * 0.85;
  const move = axis === "x" ? "translateX" : "translateY";
  const scale = axis === "x" ? "scaleX" : "scaleY";
  const face = axis === "x" ? (dir > 0 ? "lr-face-r" : "lr-face-l") : dir > 0 ? "lr-face-d" : "lr-face-u";
  const css: Css =
    axis === "x"
      ? { top: px(o.line - thick / 2), height: px(thick), width: px(len), left: px(dir > 0 ? -len : 0) }
      : { left: px(o.line - thick / 2), width: px(thick), height: px(len), top: px(dir > 0 ? -len : 0) };
  const frames: Keyframe[] = [
    { transform: `${move}(${px(o.from)}) ${scale}(0)` },
    { offset: 0.65, transform: `${move}(${px(mid)}) ${scale}(1)` },
    { transform: `${move}(${px(o.to)}) ${scale}(0)` }
  ];
  return { dir, len, face, css, frames };
}

/** A comet: travels from `from` to `to` along a line. */
export function comet(host: Element, o: CometOptions): Animation | null {
  if (!canMove()) return null;
  const path = cometPath(o);
  return temp(host, `lr-comet ${path.face}${toneClass(o.tone)}`, path.css, path.frames, {
    dur: o.dur ?? lightTiming(host).comet,
    delay: o.delay ?? COMET_DELAY,
    ease: EASE.travel
  });
}

export interface BurstOptions extends Timed {
  /** Where on the line it lands. */
  at: number;
  line: number;
  axis?: Axis;
  /** Its length along the line and its thickness across it. */
  w?: number;
  h?: number;
  tone?: Tone;
}

/** A burst: one short flash on a line. */
export function burst(host: Element, o: BurstOptions): Animation | null {
  if (!canMove()) return null;
  const axis = o.axis ?? "x";
  const w = o.w ?? 110;
  const h = o.h ?? 10;
  const move = axis === "x" ? "translateX" : "translateY";
  const scale = axis === "x" ? "scaleX" : "scaleY";
  const css: Css =
    axis === "x"
      ? { left: px(-w / 2), top: px(o.line - h / 2), width: px(w), height: px(h) }
      : { top: px(-w / 2), left: px(o.line - h / 2), height: px(w), width: px(h) };
  const at = px(o.at);
  const timing = lightTiming(host);
  return temp(
    host,
    `lr-burst${toneClass(o.tone)}`,
    css,
    [
      { opacity: 0, transform: `${move}(${at}) ${scale}(0.3)` },
      { offset: 0.25, opacity: 1, transform: `${move}(${at}) ${scale}(0.8)` },
      { opacity: 0, transform: `${move}(${at}) ${scale}(1.5)` }
    ],
    { dur: o.dur ?? timing.burst, delay: o.delay ?? timing.delayBurst, ease: "ease-out" }
  );
}

export interface PopOptions extends Timed {
  x: number;
  y: number;
  size?: number;
  tone?: Tone;
  /** A colour token, as `var(--…)`, in place of a tone. */
  color?: string;
}

/** A pop: the round burst, for points that are not on a line (pips, tokens, places on the map). */
export function pop(host: Element, o: PopOptions): Animation | null {
  if (!canMove()) return null;
  const size = o.size ?? 40;
  const css: Record<string, string> = {
    left: px(o.x - size / 2),
    top: px(o.y - size / 2),
    width: px(size),
    height: px(size)
  };
  if (o.color) css["--lr-burst"] = o.color;
  return temp(
    host,
    `lr-pop${toneClass(o.tone)}`,
    css,
    [
      { opacity: 0, transform: "scale(0.3)" },
      { offset: 0.25, opacity: 1 },
      { opacity: 0, transform: "scale(1.4)" }
    ],
    { dur: o.dur ?? 220, delay: o.delay ?? 0, ease: "ease-out" }
  );
}

export interface WashOptions extends Timed {
  /** Where across the host the light landed: the wash is strongest under it. */
  at: number;
  top?: number;
  h?: number;
}

/**
 * A wash: the line's colours falling onto what changed, from `top`. It animates opacity alone, so it may sit in the
 * pane. Reduced transparency sets its strength to 0, and then nothing is drawn.
 */
export function wash(host: Element, o: WashOptions): Animation | null {
  if (!canMove()) return null;
  const read = parseFloat(cssVar(host, "--wash-strength"));
  const strength = Number.isNaN(read) ? 0.24 : read;
  if (strength <= 0) return null;
  const timing = lightTiming(host);
  return temp(
    host,
    "lr-wash",
    { left: "0", right: "0", top: px(o.top ?? 0), height: px(o.h ?? 160), "--lr-at": px(o.at) },
    [{ opacity: strength }, { opacity: 0 }],
    { dur: o.dur ?? timing.wash, delay: o.delay ?? timing.delayWash, ease: "ease-out" }
  );
}

export interface LineOptions extends Timed {
  /** Where along the element it grows from or shrinks to: a percentage or a length, `50%` unless given. */
  origin?: string;
  axis?: Axis;
}

function originOf(o: LineOptions): string {
  const origin = o.origin ?? "50%";
  return (o.axis ?? "x") === "x" ? `${origin} 50%` : `50% ${origin}`;
}

/** Fills an element that is already there along its length, from `origin`: the new place lighting. */
export function fill(el: HTMLElement, o: LineOptions = {}): Animation | null {
  if (!canMove()) return null;
  const scale = (o.axis ?? "x") === "x" ? "scaleX" : "scaleY";
  el.style.transformOrigin = originOf(o);
  const timing = lightTiming(el);
  return play(el, [{ transform: `${scale}(0)` }, { transform: `${scale}(1)` }], {
    dur: o.dur ?? timing.fill,
    delay: o.delay ?? timing.delayFill,
    ease: EASE.settle
  });
}

/** Drains an element that is already there toward `origin`: the old place letting go. */
export function drain(el: HTMLElement, o: LineOptions & { fill?: FillMode } = {}): Animation | null {
  if (!canMove()) return null;
  const scale = (o.axis ?? "x") === "x" ? "scaleX" : "scaleY";
  el.style.transformOrigin = originOf(o);
  return play(el, [{ transform: `${scale}(1)` }, { transform: `${scale}(0)` }], {
    dur: o.dur ?? lightTiming(el).drain,
    delay: o.delay ?? 0,
    ease: EASE.in,
    fill: o.fill ?? "backwards"
  });
}

export interface FadeOptions extends Timed {
  /** A rise or a sink in px. Never on the pane or its child: a transform there traps fixed overlays. */
  y?: number;
}

/** The content part: fades in, starting at `--delay-content`. */
export function fadeIn(el: Element, o: FadeOptions = {}): Animation | null {
  if (!canMove()) return null;
  const from: Keyframe = { opacity: 0 };
  const to: Keyframe = { opacity: 1 };
  if (o.y) {
    from.transform = `translateY(${px(o.y)})`;
    to.transform = "translateY(0)";
  }
  const timing = lightTiming(el);
  return play(el, [from, to], { dur: o.dur ?? timing.content, delay: o.delay ?? timing.delayContent });
}

/** Fades out and holds there; the caller hides or removes the element after `finished`. */
export function fadeOut(el: Element, o: FadeOptions = {}): Animation | null {
  if (!canMove()) return null;
  const from: Keyframe = { opacity: 1 };
  const to: Keyframe = { opacity: 0 };
  if (o.y) {
    from.transform = "translateY(0)";
    to.transform = `translateY(${px(o.y)})`;
  }
  return play(el, [from, to], { dur: o.dur ?? 160, delay: o.delay ?? 0, fill: "forwards", ease: EASE.in });
}

const counting = new WeakMap<Element, object>();

/**
 * Counts an element's number from `from` to `to`, easing out. A newer count on the same element stops this one.
 * Without motion it shows `to` at once.
 */
export function countUp(
  el: Element,
  from: number,
  to: number,
  o: Timed & { format?: (n: number) => string } = {}
): Promise<void> {
  const format = o.format ?? String;
  const run = {};
  counting.set(el, run);
  if (!canMove()) {
    el.textContent = format(to);
    return Promise.resolve();
  }
  const dur = o.dur ?? lightTiming(el).count;
  el.textContent = format(from);
  // Timed from the first frame's own clock: a slowed animation clock (DevTools at 10%) runs frames behind
  // performance.now(), and a start taken from it would never come.
  let start: number | null = null;
  return new Promise((resolve) => {
    const step = (now: number) => {
      if (counting.get(el) !== run) return resolve();
      start ??= now + (o.delay ?? 0);
      if (now < start) {
        requestAnimationFrame(step);
        return;
      }
      const progress = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = format(Math.round(from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/**
 * A tape counter: the old value leaves upward and the new one arrives from below. `roll` holds one `span` per value
 * and is managed here, never by React.
 */
export function rollTo(roll: HTMLElement, text: string, o: Timed = {}): Animation | null {
  for (const leaving of roll.querySelectorAll(":scope > .lr-roll-out")) leaving.remove();
  const old = roll.querySelector<HTMLElement>(":scope > span");
  const next = roll.ownerDocument.createElement("span");
  next.textContent = text;
  if (!canMove()) {
    roll.replaceChildren(next);
    return null;
  }
  const dur = o.dur ?? 180;
  if (old) {
    old.classList.add("lr-roll-out");
    const out = play(
      old,
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(-100%)", opacity: 0 }
      ],
      { dur, delay: o.delay ?? 0, ease: EASE.in, fill: "forwards" }
    );
    const remove = () => old.remove();
    out.finished.then(remove, remove);
  }
  roll.appendChild(next);
  return play(
    next,
    [
      { transform: "translateY(100%)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 }
    ],
    { dur, delay: (o.delay ?? 0) + 50, ease: EASE.out }
  );
}

/**
 * A tape counter's roll, for a value React renders (`Roll`): the old value leaves upward as a throwaway part over
 * `now`, which arrives from below. `roll` is positioned, and clips only while the roll runs.
 */
export function rollOver(roll: HTMLElement, now: HTMLElement, before: string, o: Timed = {}): Animation | null {
  if (!canMove()) return null;
  for (const leaving of roll.querySelectorAll(":scope > .lr-roll-out")) leaving.remove();
  const dur = o.dur ?? 180;
  const delay = o.delay ?? 0;
  roll.style.overflow = "hidden";
  const leaving = spawn(roll, "lr-roll-out", {});
  leaving.textContent = before;
  const out = play(
    leaving,
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: "translateY(-100%)", opacity: 0 }
    ],
    { dur, delay, ease: EASE.in, fill: "both" }
  );
  const remove = () => leaving.remove();
  out.finished.then(remove, remove);
  const arrive = play(
    now,
    [
      { transform: "translateY(100%)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 }
    ],
    { dur, delay: delay + 50, ease: EASE.out }
  );
  const unclip = () => {
    roll.style.overflow = "";
  };
  arrive.finished.then(unclip, unclip);
  return arrive;
}

/**
 * The sun frame moving: a frame-only part that slides from one box to another (the next turn), pops in on one (an
 * encounter starting) or drains away from one (an encounter ending). Boxes are in `host` coordinates.
 */
export function sunFrame(
  host: Element,
  o: Timed & { from: Box; to?: Box; mode: "slide" | "arrive" | "leave" }
): Animation | null {
  if (!canMove()) return null;
  const { from } = o;
  const css = { left: px(from.x), top: px(from.y), width: px(from.w), height: px(from.h) };
  const frames: Keyframe[] =
    o.mode === "slide" && o.to
      ? [
          { transform: "translate(0, 0)", opacity: 1 },
          { offset: 0.85, opacity: 1 },
          { transform: `translate(${px(o.to.x - from.x)}, ${px(o.to.y - from.y)})`, opacity: 0 }
        ]
      : o.mode === "arrive"
        ? [
            { transform: "scale(0.6)", opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
            { transform: "scale(1)", opacity: 0 }
          ]
        : [
            { transform: "scale(1)", opacity: 1 },
            { transform: "scale(0.6)", opacity: 0 }
          ];
  return temp(host, "lr-sunframe", css, frames, {
    dur: o.dur ?? (o.mode === "slide" ? 200 : 180),
    delay: o.delay ?? 0,
    ease: EASE.settle
  });
}

/**
 * Lamps lighting one after another, as a new turn or an encounter starts: each light in `scope` warms with a small
 * burst in its own colour, `step` apart.
 */
export function lightLamps(scope: ParentNode, o: { delay?: number; step?: number } = {}): void {
  if (!canMove()) return;
  const lamps = [...scope.querySelectorAll<HTMLElement>(".nh-lamp.is-lit")];
  lamps.forEach((lamp, index) => {
    const light = lamp.querySelector<HTMLElement>(".nh-lamp-light, .nh-lamp-gauge");
    if (!light) return;
    const delay = (o.delay ?? 0) + index * (o.step ?? 60);
    warm(light, { delay });
    const box = rel(light, lamp);
    pop(lamp, { x: box.cx, y: box.cy, size: 38, delay, color: "var(--nh-lamp)" });
  });
}

/** Chrome catch: one sweep of the horizon's colours across an element's letters. `el` must be positioned. */
export function sheen(el: HTMLElement, o: Timed = {}): Animation | null {
  if (!canMove()) return null;
  for (const old of el.querySelectorAll(":scope > .lr-sheen")) old.remove();
  const overlay = spawn(el, "lr-sheen", {});
  overlay.textContent = el.textContent;
  const animation = play(overlay, [{ backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0" }], {
    dur: o.dur ?? 420,
    delay: o.delay ?? 0,
    fill: "both"
  });
  const remove = () => overlay.remove();
  animation.finished.then(remove, remove);
  return animation;
}

function splitFrames(el: Element) {
  const cyan = cssVar(el, "--split-cyan");
  const pink = cssVar(el, "--split-pink");
  const cyan0 = cssVar(el, "--split-cyan-0");
  const pink0 = cssVar(el, "--split-pink-0");
  const apart: Keyframe = {
    opacity: 0,
    textShadow: `-5px 0 ${cyan}, 5px 0 ${pink}`,
    boxShadow: `-4px 0 0 ${cyan}, 4px 0 0 ${pink}`
  };
  const together: Keyframe = {
    opacity: 1,
    textShadow: `0 0 ${cyan0}, 0 0 ${pink0}`,
    boxShadow: `0 0 0 ${cyan0}, 0 0 0 ${pink0}`
  };
  return { apart, together };
}

/** Chroma settle: a pink and cyan split settling into register as the element fades in. */
export function splitIn(el: Element, o: Timed = {}): Animation | null {
  if (!canMove()) return null;
  const { apart, together } = splitFrames(el);
  return play(el, [apart, together], { dur: o.dur ?? 200, delay: o.delay ?? 0 });
}

/** The split coming apart as the element fades out; it holds there for the caller to remove it. */
export function splitOut(el: Element, o: Timed = {}): Animation | null {
  if (!canMove()) return null;
  const { apart, together } = splitFrames(el);
  return play(el, [together, apart], { dur: o.dur ?? 220, delay: o.delay ?? 0, fill: "forwards", ease: EASE.in });
}

/**
 * A lamp or pip switching off: it holds its colour and an afterglow for a moment, then cools into its own unlit style.
 * `color` and `glow` are token references (`var(--lamp-action)`, `var(--lamp-afterglow)`).
 */
export function cool(el: Element, color: string, glow: string, o: Timed = {}): Animation | null {
  if (!canMove()) return null;
  // No last keyframe: the animation ends on whatever the stylesheet paints an unlit lamp with.
  return play(
    el,
    [
      { offset: 0, backgroundColor: color, borderColor: color, boxShadow: glow },
      { offset: 0.2, backgroundColor: color, borderColor: color, boxShadow: glow }
    ],
    { dur: o.dur ?? 320, delay: o.delay ?? 0, ease: "ease-out" }
  );
}

/** A lamp lighting. */
export function warm(el: Element, o: Timed = {}): Animation | null {
  if (!canMove()) return null;
  return play(
    el,
    [
      { opacity: 0.2, transform: "scale(0.5)" },
      { opacity: 1, transform: "scale(1)" }
    ],
    { dur: o.dur ?? 150, delay: o.delay ?? 0, ease: EASE.out }
  );
}

/** How far an element moved between two measurements, or null when it did not move. */
export function flipDelta(before: DOMRectReadOnly, after: DOMRectReadOnly): { dx: number; dy: number } | null {
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  return Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? null : { dx, dy };
}

/** Slides an element from where it was (`before`, measured before the change) to where it is now. */
export function flipFrom(el: Element, before: DOMRectReadOnly, o: Timed = {}): Animation | null {
  if (!canMove() || !el.isConnected) return null;
  const delta = flipDelta(before, el.getBoundingClientRect());
  if (!delta) return null;
  return play(el, [{ transform: `translate(${px(delta.dx)}, ${px(delta.dy)})` }, { transform: "translate(0, 0)" }], {
    dur: o.dur ?? 240,
    delay: o.delay ?? 0,
    ease: EASE.settle
  });
}

/** Moves elements to new places with `mutate` and slides each from where it was, so a reorder reads as motion. */
export function flip(els: readonly Element[], mutate: () => void, o: Timed = {}): Animation[] {
  const before = els.map((el) => el.getBoundingClientRect());
  mutate();
  return els.flatMap((el, index) => flipFrom(el, before[index], o) ?? []);
}

/** Text that rises from a point and fades: a damage number or MISS. `className` sets its face. */
export function floatText(
  host: Element,
  text: string,
  className: string,
  x: number,
  y: number,
  o: Timed & { w?: number } = {}
): Animation | null {
  if (!canMove()) return null;
  const w = o.w ?? 90;
  const part = spawn(host, `lr-float ${className}`, { left: px(x - w / 2), top: px(y), width: px(w) });
  part.textContent = text;
  const animation = play(
    part,
    [
      { opacity: 0, transform: "translateY(6px) scale(0.8)" },
      { offset: 0.2, opacity: 1, transform: "translateY(-6px) scale(1)" },
      { offset: 0.75, opacity: 1, transform: "translateY(-18px)" },
      { opacity: 0, transform: "translateY(-26px)" }
    ],
    { dur: o.dur ?? 900, delay: o.delay ?? 0, ease: "ease-out", fill: "both" }
  );
  const remove = () => part.remove();
  animation.finished.then(remove, remove);
  return animation;
}

/** A line that waited unlit lights from the left: a comet along `host`'s top edge, and `lit` fills behind it. */
export function lightLine(host: Element, lit: HTMLElement, o: Timed & { line?: number } = {}): Animation | null {
  if (!canMove()) return null;
  const delay = o.delay ?? 0;
  const dur = o.dur ?? 260;
  const line = o.line ?? 0;
  const w = host.clientWidth;
  comet(host, { from: 0, to: w, line, delay, dur });
  burst(host, { at: w, line, delay: delay + dur - 10, w: 90 });
  return fill(lit, { origin: "0%", delay: delay + 20, dur });
}

export interface StripSwitchOptions {
  /** The strip's one ink, already placed under the new tab. */
  ink: HTMLElement;
  /** The old and the new tab, in the host's coordinates. */
  from: Box;
  to: Box;
  /** The strip's line across the trip: the ink's centre. */
  line: number;
  axis?: Axis;
  /** False when the trip is drawn elsewhere (the top bar's sections run along the horizon). */
  travel?: boolean;
}

/**
 * A strip switch: the old ink drains toward the trip as a stand-in, a comet runs along the strip's line, a burst
 * lands and the ink fills from the side the light arrived on. Returns the ink's fill.
 */
export function stripSwitch(host: Element, o: StripSwitchOptions): Animation | null {
  if (!canMove()) return null;
  const axis = o.axis ?? "x";
  const from = axis === "x" ? o.from.cx : o.from.cy;
  const to = axis === "x" ? o.to.cx : o.to.cy;
  const dir = to >= from ? 1 : -1;
  clearLight(host);
  for (const running of o.ink.getAnimations?.() ?? []) running.cancel();
  const ghost = o.ink.cloneNode(false) as HTMLElement;
  ghost.classList.add("lr-part", "lr-ink-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.transform = "";
  if (axis === "x") {
    ghost.style.left = px(o.from.x);
    ghost.style.width = px(o.from.w);
  } else {
    ghost.style.top = px(o.from.y);
    ghost.style.height = px(o.from.h);
  }
  ghost.style.transformOrigin = originOf({ axis, origin: dir > 0 ? "100%" : "0%" });
  host.appendChild(ghost);
  const scale = axis === "x" ? "scaleX" : "scaleY";
  const drained = play(ghost, [{ transform: `${scale}(1)` }, { transform: `${scale}(0)` }], {
    dur: lightTiming(host).drain,
    ease: EASE.in,
    fill: "both"
  });
  const remove = () => ghost.remove();
  drained.finished.then(remove, remove);
  if (o.travel !== false) {
    comet(host, { from, to, line: o.line, axis, thick: 3, dur: 220 });
    burst(host, { at: to, line: o.line, axis, delay: 200, w: 70, h: 8 });
  }
  return fill(o.ink, { axis, origin: dir > 0 ? "0%" : "100%" });
}
