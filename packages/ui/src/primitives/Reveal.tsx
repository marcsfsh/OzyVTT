import { Badge } from "./Badge";
import { Tooltip } from "./Tooltip";
import { cx } from "./util";
import { IconEye, IconEyeOff } from "./icons";
import "./Reveal.css";

/**
 * The shared "shown to players vs GM-only" vocabulary. Two axes:
 *  - Record: is this whole record shown to players? `RevealSwitch` (pressable), `VisibilityBadge` (read-only)
 *    and `HiddenFromPlayers` (the off state alone) all draw the same icon-only eye.
 *  - Content: `GmOnlyTag`, the violet "GM only" pill for a GM-only piece of content.
 * The record axis says "Hidden from players" so it never collides with the content pill's "GM only".
 * Every surface that asks "do the players see this?" uses these components and these words.
 */

/** The words are the contract; written once here. */
const SHOWN = "Shown to players";
const HIDDEN = "Hidden from players";

/**
 * The reveal toggle: an icon-only eye. The accessible name is required: `aria-label` for assistive tech,
 * the tooltip for pointers, and `title` for long-press on touch devices. A GM misreading this state leaks
 * secrets, so all three must stay.
 */
export function RevealSwitch({
  revealed,
  onChange,
  ariaLabel,
  banded = false,
  disabled = false,
  className
}: Readonly<{
  revealed: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  /** Pass in a form grid so the control aligns with the input wells beside it. */
  banded?: boolean;
  disabled?: boolean;
  className?: string;
}>) {
  const state = revealed ? SHOWN : HIDDEN;
  return (
    <Tooltip content={state} className={cx("nh-reveal", banded && "nh-reveal--banded", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={revealed}
        aria-label={ariaLabel ?? "Show to players"}
        title={state}
        disabled={disabled}
        onClick={() => onChange(!revealed)}
        className={cx("nh-reveal-toggle", revealed && "is-revealed", "tap-target", "interactive")}
      >
        {revealed ? <IconEye /> : <IconEyeOff />}
      </button>
    </Tooltip>
  );
}

/** The read-only twin of `RevealSwitch`: the same eye, same name carriers. `role="img"` gives the
 * `aria-label` effect; it is a status, so it is neither a switch nor focusable. */
export function VisibilityBadge({ revealed }: Readonly<{ revealed: boolean }>) {
  return <RevealMark revealed={revealed} />;
}

/** The shared mark; a fixed 1.75rem square, so a header never shifts when a record flips. */
function RevealMark({ revealed, className }: Readonly<{ revealed: boolean; className?: string }>) {
  const state = revealed ? SHOWN : HIDDEN;
  return (
    <Tooltip content={state} className={cx("nh-reveal", className)}>
      <span role="img" aria-label={state} title={state} className={cx("nh-reveal-mark", revealed && "is-revealed")}>
        {revealed ? <IconEye /> : <IconEyeOff />}
      </span>
    </Tooltip>
  );
}

/** "This whole record is hidden" for lists with no switch on the row; `VisibilityBadge`'s off state. */
export function HiddenFromPlayers() {
  return <RevealMark revealed={false} />;
}

/** The "this content is GM-only" pill (violet is reserved for GM-only). `floating` pins it to the
 * block's top-right corner; the block supplies the positioning context. */
export function GmOnlyTag({ floating = false }: Readonly<{ floating?: boolean }>) {
  return (
    <Badge tone="violet" className={`nh-reveal-pill${floating ? " nh-reveal-pill--floating" : ""}`}>
      GM only
    </Badge>
  );
}
