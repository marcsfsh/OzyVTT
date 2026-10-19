import type { RollCall } from "@vtt/domain";
import "./roll-calls.css";

type Situation = NonNullable<RollCall["entries"][number]["situations"]>[number];

/**
 * The situations a call's card offers for one character (a Book's topic, prying with a Crowbar): toggles whose picks
 * ride the check. The GM judges whether the check really fits.
 */
export function CallSituations({
  situations,
  picked,
  busy,
  onToggle
}: Readonly<{
  situations: readonly Situation[] | undefined;
  picked: readonly string[];
  busy: boolean;
  onToggle: (situation: string) => void;
}>) {
  if (!situations || situations.length === 0) return null;
  return (
    <div className="roll-call-situations" role="group" aria-label="Situations the check fits">
      {situations.map((entry) => {
        const on = picked.includes(entry.situation);
        return (
          <button
            key={entry.situation}
            type="button"
            className="roll-call-who-chip roll-call-situation"
            aria-pressed={on}
            disabled={busy}
            title={entry.source}
            onClick={() => onToggle(entry.situation)}
          >
            {entry.situation.charAt(0).toUpperCase() + entry.situation.slice(1)} ({entry.effect})
          </button>
        );
      })}
    </div>
  );
}

/** One toggle flipped in a list of picked situations. */
export const toggled = (picked: readonly string[], situation: string): string[] =>
  picked.includes(situation) ? picked.filter((one) => one !== situation) : [...picked, situation];
