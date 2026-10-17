import { useState } from "react";
import type { ContentActionSummary, ContentSpellSummary } from "@vtt/domain";
import { Button, IconChevronLeft } from "@vtt/ui";
import { signed } from "../encounter/format";
import { castLabel, countNoun, shortRange, targetCountAt, type CastOption, type SheetSpellEntry } from "./spell-model";

/** What happens after the cast is chosen, in one line. */
function nextLine(
  option: CastOption,
  content: ContentSpellSummary | undefined,
  action: ContentActionSummary | null,
  aimed: boolean
): string {
  const spends =
    option.kind === "slot"
      ? ` and spends the level ${option.level} spell slot`
      : option.kind === "free"
        ? " and spends the free cast"
        : "";
  if (!aimed) return `The server rolls what it needs${spends}.`;
  const count = targetCountAt(content, option.level);
  const noun = countNoun(content);
  if (action?.area)
    return `Next you place its area on the map. The server rolls${spends.replace(" and", ",")} and applies it.`;
  if (count && count > 1)
    return `Next you choose a target for each of the ${count} ${noun}. The server rolls each one${spends}.`;
  if (action?.targeting === "none") return `It takes effect at once. The server records it${spends}.`;
  return `Next you choose its ${action?.targeting === "multi" ? "targets" : "target"}. The server rolls${spends.replace(" and", ",")} and applies it.`;
}

/**
 * One spell's cast: its slot levels (each with what is left and what it buys), a free casting or a Ritual where it
 * has one, a line on what happens next, and one primary that names the result. The sheet places it per width: in
 * place on a phone, in the right column on a laptop, in a drawer on the GM's phone.
 */
export function CastDetail({
  spell,
  action,
  content,
  options,
  aimed,
  busy,
  onCast,
  onBack
}: Readonly<{
  spell: SheetSpellEntry;
  /** The action the cast resolves through, with the server's numbers. */
  action: ContentActionSummary | null;
  content: ContentSpellSummary | undefined;
  options: readonly CastOption[];
  /** The cast goes on to targeting (the character's turn in a fight); otherwise the server rolls it at once. */
  aimed: boolean;
  busy: boolean;
  onCast: (option: CastOption) => void;
  onBack: () => void;
}>) {
  const first = options.find((option) => option.available) ?? options[0] ?? null;
  const [picked, setPicked] = useState<string | null>(first?.key ?? null);
  const chosen = options.find((option) => option.key === picked) ?? first;
  const line = [
    content?.castingTime,
    shortRange(content?.rangeText),
    action?.attackBonus !== null && action?.attackBonus !== undefined ? `${signed(action.attackBonus)} to hit` : null,
    action?.saveAbility ? `DC ${action.saveDc} ${action.saveAbility.toUpperCase()} save` : null,
    action && action.damage.length > 0 ? action.damage.map((part) => `${part.formula} ${part.type}`).join(" + ") : null
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="cs-cast" aria-label={`Cast ${spell.name}`}>
      <div className="cs-cast-head">
        <button type="button" className="cs-back interactive" aria-label="Back" onClick={onBack}>
          <IconChevronLeft />
        </button>
        <span className="cs-cast-title">
          <strong className="cs-cast-name">{spell.name}</strong>
          {line && <span className="cs-sub">{line}</span>}
        </span>
      </div>
      {options.some((option) => option.kind === "slot") && <span className="cs-eyebrow">Spell slot</span>}
      <div className="cs-cast-options" role="group" aria-label="How to cast it">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`cs-cast-option${option.key === chosen?.key ? " is-on" : ""}${option.available ? "" : " is-off"}`}
            aria-pressed={option.key === chosen?.key}
            disabled={!option.available}
            onClick={() => setPicked(option.key)}
          >
            <strong>{option.title}</strong>
            <span>{option.detail}</span>
            {!option.available && option.reason && <span className="cs-cast-reason">{option.reason}</span>}
          </button>
        ))}
      </div>
      {chosen && <p className="cs-sub">{nextLine(chosen, content, action, aimed)}</p>}
      <Button
        variant="primary"
        block
        disabled={busy || !chosen || !chosen.available}
        onClick={() => chosen && onCast(chosen)}
      >
        {chosen ? castLabel(chosen) : "Cast"}
      </Button>
    </section>
  );
}
