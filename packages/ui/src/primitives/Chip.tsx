import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { ghostOut } from "../motion/overlay";
import { cx } from "./util";
import { IconX } from "./icons";
import "./Chip.css";

export type ChipTone = "neutral" | "harmful" | "beneficial" | "magical" | "info";

interface ChipProps {
  tone?: ChipTone;
  /** Short glyph/icon so the category reads without relying on color. */
  icon?: ReactNode;
  /** Steady stronger violet glow, e.g. concentration-at-risk. No pulse. */
  atRisk?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
  /** Selectable/toggle chip: renders a <button aria-pressed> with press feedback. */
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Trailing remove control (display/filter chips; omit on pressable chips). */
  onRemove?: () => void;
  removeLabel?: string;
  /** How it leaves when its strip drops it: `split` comes apart as it fades, as Concentration breaking does. */
  leave?: "split";
  "aria-label"?: string;
  "aria-expanded"?: boolean;
}

/** Condition/tag pill. Category reads from icon + label + border (never color
    alone); the label stays --text for contrast. Renders a <button> when it's
    pressable (onClick/pressed) and a <span> otherwise. */
export function Chip({
  tone = "neutral",
  icon,
  atRisk = false,
  className,
  children,
  title,
  pressed,
  disabled,
  onClick,
  onRemove,
  removeLabel,
  leave,
  ...aria
}: ChipProps) {
  const ref = useChipLeave(leave);
  const isButton = pressed !== undefined || onClick !== undefined;
  const cls = cx(
    "nh-chip",
    tone !== "neutral" && `nh-chip--${tone}`,
    atRisk && "nh-chip--at-risk",
    isButton && "nh-chip--pressable tap-target interactive",
    className
  );
  const body = (
    <>
      {icon != null && (
        <span className="nh-chip-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="nh-chip-label">{children}</span>
    </>
  );
  if (isButton) {
    return (
      <button
        ref={ref}
        type="button"
        className={cls}
        aria-pressed={pressed}
        disabled={disabled}
        title={title}
        onClick={onClick}
        {...aria}
      >
        {body}
      </button>
    );
  }
  return (
    <span ref={ref} className={cls} title={title} {...aria}>
      {body}
      {onRemove && (
        <button
          type="button"
          className="nh-chip-remove tap-target"
          aria-label={removeLabel ?? "Remove"}
          onClick={onRemove}
        >
          <IconX />
        </button>
      )}
    </span>
  );
}

/**
 * A chip that leaves with light (ADR-0045, group 5). An unmount's cleanup runs while the chip is still on the page, so
 * an inert copy can be taken there; it plays only when the chip left a strip that stayed, so leaving a page plays
 * nothing.
 */
function useChipLeave(leave: "split" | undefined) {
  const chip = useRef<HTMLElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    chip.current = el;
  }, []);
  useLayoutEffect(() => {
    const el = chip.current;
    if (!el || !leave) return;
    return () => ghostOut(el, { leave, whenGone: true, within: el.parentElement });
  }, [leave]);
  return ref;
}
