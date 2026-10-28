import { useRef } from "react";
import { useOnChange } from "../motion/hooks";
import { cool, pop, rel, warm } from "../motion/lightRail";
import { cx } from "./util";
import "./Lamp.css";

/** A lamp lighting warms up with a burst in its colour; one going out holds an afterglow as it cools (ADR-0045). */
function useLampLight(lit: boolean) {
  const lamp = useRef<HTMLDivElement>(null);
  useOnChange(lit, (_was, now) => {
    const tile = lamp.current;
    const light = tile?.querySelector<HTMLElement>(".nh-lamp-light, .nh-lamp-gauge");
    if (!tile || !light) return;
    if (now) {
      warm(light);
      const box = rel(light, tile);
      pop(tile, { x: box.cx, y: box.cy, size: 38, color: "var(--nh-lamp)" });
    } else cool(light, "var(--nh-lamp)", "var(--nh-lamp-afterglow)");
  });
  return lamp;
}

/** Which economy a lamp shows. Action is magenta, Bonus yellow and Reaction cyan; `on` marks a live or ready thing. */
export type LampKind = "action" | "bonus" | "reaction" | "on";

/**
 * A cabinet lamp on the turn panel: a square light, its name and its value. Lit means available; an unlit lamp is a
 * dark square with the value `--`. The light is decoration: the name and value carry the state, so the tile reads the
 * same without colour.
 */
export function Lamp({
  kind,
  lit,
  label,
  value,
  unavailableReason,
  className
}: Readonly<{
  kind: LampKind;
  lit: boolean;
  label: string;
  /** The words under a lit lamp ("1 LEFT", "READY"); an unlit lamp shows `--`. */
  value?: string;
  /** Why it is unlit, for assistive technology ("Used this turn"). */
  unavailableReason?: string;
  className?: string;
}>) {
  const lamp = useLampLight(lit);
  const shown = lit ? (value ?? "READY") : "--";
  const spoken = lit ? `${label}: ${value ?? "ready"}` : `${label}: ${unavailableReason ?? "not available"}`;
  return (
    <div
      ref={lamp}
      className={cx("nh-lamp", `nh-lamp--${kind}`, lit && "is-lit", className)}
      role="group"
      aria-label={spoken}
    >
      <span className="nh-lamp-light" aria-hidden="true" />
      <span className="nh-lamp-label" aria-hidden="true">
        {label}
      </span>
      <span className="nh-lamp-value" aria-hidden="true">
        {shown}
      </span>
    </div>
  );
}

/** At most this many squares; past it the squares would be too small to count, and the feet still say it. */
const MAX_SQUARES = 12;

/**
 * The Move lamp: a gauge of squares, one per 5 ft of speed, lit for what is left. Speed past 60 ft keeps twelve
 * squares and the feet stay exact.
 */
export function MoveLamp({
  feetLeft,
  speedFeet,
  className
}: Readonly<{ feetLeft: number; speedFeet: number; className?: string }>) {
  const left = Math.max(0, feetLeft);
  const total = Math.max(0, speedFeet);
  const squares = Math.min(MAX_SQUARES, Math.max(1, Math.ceil(total / 5)));
  const litSquares = total === 0 ? 0 : Math.min(squares, Math.round((left / total) * squares));
  const lit = left > 0;
  const lamp = useLampLight(lit);
  return (
    <div
      ref={lamp}
      className={cx("nh-lamp", "nh-lamp--move", lit && "is-lit", className)}
      role="group"
      aria-label={`Move: ${left} of ${total} feet left`}
    >
      <span className="nh-lamp-gauge" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${squares}, 1fr)` }}>
        {Array.from({ length: squares }, (_, index) => (
          <span key={index} className={cx("nh-lamp-square", index < litSquares && "is-lit")} />
        ))}
      </span>
      <span className="nh-lamp-label" aria-hidden="true">
        Move
      </span>
      <span className="nh-lamp-value" aria-hidden="true">
        {lit ? `${left} FT` : "--"}
      </span>
    </div>
  );
}

/** A small square lamp beside a status line (the table screen, a live scene). The words beside it name the state. */
export function StatusLamp({ lit, className }: Readonly<{ lit: boolean; className?: string }>) {
  return <span className={cx("nh-status-lamp", lit && "is-lit", className)} aria-hidden="true" />;
}
