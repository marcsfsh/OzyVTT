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
  /** Leading glyph — an SVG from the app's icon set, never an emoji. */
  icon?: ReactNode;
  /** Provenance slot: the SRD / Homebrew `Badge`. Reuse the existing tones
      (info = SRD, primary = Homebrew) — do not invent a second vocabulary. */
  badge?: ReactNode;
  /** Short mono metadata line (hit die, ability bonuses, prerequisites…). */
  meta?: ReactNode;
  disabled?: boolean;
  /** Shown under the title when disabled — a locked option must say why. */
  disabledReason?: ReactNode;
  /** Roving tabindex, set by ChoiceGrid. Standalone cards leave it at 0. */
  tabIndex?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** "radio" (pick one, the default) or "checkbox" (pick several). Set by
      `ChoiceGrid` from its own `selection` mode — the two look identical on
      purpose; only the semantics differ. */
  selectionRole?: "radio" | "checkbox";
  id?: string;
  /** Points at a reason stated ONCE outside the card — how `ChoiceGrid` says "you have already
      chosen N" to a screen reader without stamping the sentence onto every locked card. A locked
      option must still say why; this is the other way of saying it. */
  "aria-describedby"?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** The selectable content card behind every "pick one" step: species, class,
    background, feat, subclass.

    It carries `aria-checked` under either `role="radio"` (pick one — the default) or
    `role="checkbox"` (pick N of a list, e.g. three Weapon Masteries). A pressed-button
    grid would leave a keyboard user unable to tell the two apart; the roles say it
    outright, and `ChoiceGrid` sets the right one for its selection mode.

    There is exactly ONE chosen treatment in the system: a cyan edge with the
    selection glow plus a check mark — identical in both modes. Do not add a second cue
    (no "Selected" label, no filled background) — cyan is selection everywhere else too,
    and one card selected means one glowing element per region. */
export function ChoiceCard({
  selected, onSelect, title, description, icon, badge, meta,
  disabled = false, disabledReason, tabIndex, onKeyDown, selectionRole = "radio", id, className, ref,
  "aria-describedby": describedBy
}: ChoiceCardProps) {
  return (
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
        {icon != null && <span className="nh-choice-icon" aria-hidden="true">{icon}</span>}
        <span className="nh-choice-title">{title}</span>
        {badge != null && <span className="nh-choice-badge">{badge}</span>}
      </span>
      {description != null && <span className="nh-choice-desc">{description}</span>}
      {meta != null && <span className="nh-choice-meta tabular">{meta}</span>}
      {disabled && disabledReason != null && (
        <span className="nh-choice-locked"><span className="nh-choice-locked-icon" aria-hidden="true"><IconWarning /></span>{disabledReason}</span>
      )}
      {/* The check is the chosen mark. aria-checked already carries it for AT. */}
      <span className="nh-choice-check" aria-hidden="true"><IconCheck /></span>
    </button>
  );
}
