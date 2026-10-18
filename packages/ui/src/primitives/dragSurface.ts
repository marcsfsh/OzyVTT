import { useCallback, type Ref, type RefCallback } from "react";

const cancel = (event: Event) => event.preventDefault();

/**
 * The ref for an element a finger drags, which has `touch-action: none`. That rule stops the page scrolling, yet a
 * drag that lifts mid-motion still starts a browser fling, and the browser spends the next tap on stopping it, so a
 * button tapped right after the drag does nothing. This ref cancels the element's touchmove, so a drag never becomes a
 * scroll and no fling starts. Taps, long presses and pointer gestures such as a pinch are unaffected. React's touch
 * listeners are passive, so this one is native. One ref can go on many elements; `forward` is also given the element.
 */
export function useDragSurface<T extends Element>(forward?: Ref<T>): RefCallback<T> {
  return useCallback(
    (element: T | null) => {
      const forwardCleanup = typeof forward === "function" ? forward(element) : undefined;
      if (forward && typeof forward === "object") forward.current = element;
      if (!element) return;
      element.addEventListener("touchmove", cancel, { passive: false });
      return () => {
        element.removeEventListener("touchmove", cancel);
        if (typeof forward === "function") {
          if (forwardCleanup) forwardCleanup();
          else forward(null);
        } else if (forward) forward.current = null;
      };
    },
    [forward]
  );
}
