import type { KeyboardEvent, ReactNode, Ref } from "react";
import { cx } from "./util";
import { IconCheck, IconWarning } from "./icons";
import "./ChoiceCard.css";

export interface ChoiceCardProps {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  /** One or two lines of prose. Clamped so a grid of cards keeps an even rhythm. */
  description?: ReactNode;
  /** Leading glyph: an SVG from the app's icon set, never an emoji. */
  icon?: ReactNode;
  /** Provenance slot: the SRD / Homebrew `Badge` (info = SRD, primary = Homebrew). */
  badge?: ReactNode;
  /** Short mono metadata line (hit die, ability bonuses, prerequisites…). */
  meta?: ReactNode;
  disabled?: boolean;
  /** Shown under the title when disabled; a locked option must say why. */
  disabledReason?: ReactNode;
  /** Roving tabindex, set by ChoiceGrid. Standalone cards leave it at 0. */
  tabIndex?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** "radio" (pick one, default) or "checkbox" (pick several), set by `ChoiceGrid`. Both look identical. */
  selectionRole?: "radio" | "checkbox";
  id?: string;
  /** Points at a reason stated once outside the card (ChoiceGrid's "you have already chosen N"). */
  "aria-describedby"?: string;
  /** A second control beside the card (e.g. reading a spell's rules). A sibling, never a child, because the card
   * is a button and browsers reparent a nested button; with `action` the card is wrapped in `.nh-choice-wrap`. */
  action?: ReactNode;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** The selectable content card behind every "pick one" step (species, class, background, feat, subclass).
    `aria-checked` under `role="radio"` or `role="checkbox"` so keyboard and screen-reader users can tell
    pick-one from pick-N. One chosen treatment everywhere, a cyan edge with the selection glow plus a check
    mark; don't add a second cue. */
export function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  icon,
  badge,
  meta,
  disabled = false,
  disabledReason,
  tabIndex,
  onKeyDown,
  selectionRole = "radio",
  id,
  action,
  className,
  ref,
  "aria-describedby": describedBy
}: ChoiceCardProps) {
  const card = (
    <button
      ref={ref}
      id={id}
      type="button"
      role={selectionRole}
      aria-checked={selected}
      aria-describedby={describedBy}
      disabled={disabled}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onClick={onSelect}
      className={cx("nh-choice", selected && "is-selected", "interactive", className)}
    >
      <span className="nh-choice-head">
        {icon != null && (
          <span className="nh-choice-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="nh-choice-title">{title}</span>
        {badge != null && <span className="nh-choice-badge">{badge}</span>}
      </span>
      {description != null && <span className="nh-choice-desc">{description}</span>}
      {meta != null && <span className="nh-choice-meta tabular">{meta}</span>}
      {disabled && disabledReason != null && (
        <span className="nh-choice-locked">
          <span className="nh-choice-locked-icon" aria-hidden="true">
            <IconWarning />
          </span>
          {disabledReason}
        </span>
      )}
      {/* The check is the chosen mark; aria-checked carries it for assistive tech. */}
      <span className="nh-choice-check" aria-hidden="true">
        <IconCheck />
      </span>
    </button>
  );
  /* No wrapper without an action, so a large grid doesn't grow an extra element per card. */
  return action == null ? (
    card
  ) : (
    <div className="nh-choice-wrap">
      {card}
      {action}
    </div>
  );
}
