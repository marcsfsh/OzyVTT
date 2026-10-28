/**
 * jsdom has no Web Animations API, so `canMove()` is false in every test. A test about the light installs this
 * stand-in: it records each `animate` call and settles when told. `restoreAnimate` takes it away again.
 */
export interface Played {
  el: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: () => void;
  finish: () => void;
}

export function stubAnimate(): Played[] {
  const played: Played[] = [];
  const byElement = new Map<Element, Animation[]>();
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
      let settle: (done: boolean) => void = () => {};
      const finished = new Promise<Animation>((resolve, reject) => {
        settle = (done) => (done ? resolve(animation) : reject(new DOMException("Cancelled", "AbortError")));
      });
      // As in a browser, a cancelled animation's `finished` rejects without an unhandled rejection.
      finished.catch(() => {});
      const animation = { finished, cancel: () => settle(false), finish: () => settle(true) } as unknown as Animation;
      played.push({ el: this, frames, options, cancel: () => settle(false), finish: () => settle(true) });
      byElement.set(this, [...(byElement.get(this) ?? []), animation]);
      return animation;
    }
  });
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value(this: Element) {
      return byElement.get(this) ?? [];
    }
  });
  return played;
}

export function restoreAnimate(): void {
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
}
