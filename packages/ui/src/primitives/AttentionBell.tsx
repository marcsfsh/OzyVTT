import { useRef } from "react";
import { useOnChange } from "../motion/hooks";
import { pop, rel } from "../motion/lightRail";
import { IconBell } from "./icons";
import { cx } from "./util";
import "./AttentionBell.css";

/**
 * What waits on the GM, as a bell with its count on a small amber badge (ADR-0058). It renders nothing at 0, so no
 * words ever say Needs you. When the count rises it rings once with a burst, as a lamp lights (ADR-0045); reduced
 * motion keeps it still. `label` names it for a screen reader when it stands alone ("Waiting, 2"); beside words that
 * already say it, leave it out and the bell is decoration.
 */
export function AttentionBell({
  count,
  label,
  className
}: Readonly<{ count: number; label?: string; className?: string }>) {
  const bell = useRef<HTMLSpanElement>(null);
  useOnChange(count, (was, now) => {
    const host = bell.current;
    if (!host || now <= was) return;
    const box = rel(host, host);
    pop(host, { x: box.cx, y: box.cy, size: 30, color: "var(--caution)" });
  });
  if (count <= 0) return null;
  return (
    <span
      ref={bell}
      className={cx("nh-bell", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <IconBell />
      <span className="nh-bell-count">{count}</span>
    </span>
  );
}
