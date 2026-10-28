import { useEffect, useLayoutEffect, useRef } from "react";

/** The value from the previous render, or undefined on the first. */
export function usePrevious<T>(value: T): T | undefined {
  const previous = useRef<T | undefined>(undefined);
  useEffect(() => {
    previous.current = value;
  });
  return previous.current;
}

/**
 * Runs `onChange(previous, next)` after a render that changed `value`, once the new state is in the DOM, so light can
 * measure and then animate. It never runs for the first render: opening a sheet doesn't play healing from 0. A
 * returned function runs before the next change, as an effect's cleanup does.
 */
export function useOnChange<T>(
  value: T,
  onChange: (previous: T, next: T) => void | (() => void),
  same: (a: T, b: T) => boolean = Object.is
): void {
  const previous = useRef(value);
  const handler = useRef(onChange);
  useLayoutEffect(() => {
    handler.current = onChange;
  });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (same(before, value)) return;
    return handler.current(before, value) ?? undefined;
    // `same` is a comparison, not an input: a new function each render must not rerun the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
