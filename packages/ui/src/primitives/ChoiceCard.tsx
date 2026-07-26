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
  id?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** The selectable content card behind every "pick one" step: species, class,
    background, feat, subclass.

    It has radio semantics (`role="radio"` + `aria-checked`) because these grids are
    single-select — a pressed-button grid would let a keyboard user believe several
    can be on at once.

    There is exactly ONE chosen treatment in the system: a cyan edge with the
    selection glow plus a check mark. Do not add a second cue (no "Selected" label,
    no filled background) — cyan is selection everywhere else too, and one card
    selected means one glowing element per region. */
export function ChoiceCard({
  selected, onSelect, title, description, icon, badge, meta,
  disabled = false, disabledReason, tabIndex, onKeyDown, id, className, ref
}: ChoiceCardProps) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="radio"
      aria-checked={selected}
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
