import { useRef } from "react";
import { useOnChange } from "../motion/hooks";
import { rollOver } from "../motion/lightRail";
import { cx } from "./util";
import "./Roll.css";

/**
 * A value that rolls over like a tape counter when it changes (ADR-0045): the old value leaves upward and the new one
 * arrives from below. For a counter's digits and its words alike (RND 03, PLAY and STOP, ON and OFF). Without motion
 * it swaps at once, and it never rolls on the first render.
 */
export function Roll({
  value,
  delay = 0,
  className
}: Readonly<{
  value: string;
  /** How long after the change the roll starts, so it can land with the light that brought it. */
  delay?: number;
  className?: string;
}>) {
  const box = useRef<HTMLSpanElement>(null);
  useOnChange(value, (before) => {
    const roll = box.current;
    const now = roll?.querySelector<HTMLElement>(":scope > .nh-roll-now");
    if (roll && now) rollOver(roll, now, before, { delay });
  });
  return (
    <span ref={box} className={cx("nh-roll", className)}>
      <span className="nh-roll-now">{value}</span>
    </span>
  );
}
