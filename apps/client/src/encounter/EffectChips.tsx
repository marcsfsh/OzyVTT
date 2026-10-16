import { useState } from "react";
import { type PlayerEffect } from "@vtt/domain";
import { Button, Chip } from "@vtt/ui";
import { command } from "../lib/command";
import { newId } from "../lib/ids";
import "./effect-chips.css";

type ChipEffect = PlayerEffect & { escapeDc?: number | null };

/** How long an effect has left, in the table's words. */
export function effectDurationLabel(effect: Pick<PlayerEffect, "duration">): string {
  const duration = effect.duration;
  switch (duration.type) {
    case "rounds":
      return `${duration.remaining} ${duration.remaining === 1 ? "round" : "rounds"} left`;
    case "until-source-next-turn":
      return "until its source's next turn";
    case "until-bearer-turn-end":
      return duration.skipsCurrentTurn ? "until the end of its next turn" : "until the end of its turn";
    case "until-source-turn-end":
      return duration.skipsCurrentTurn
        ? "until the end of its source's next turn"
        : "until the end of its source's turn";
    case "encounter":
      return "this encounter";
    case "manual":
      return "until ended";
  }
}

/** What else ends it: a repeated save, Escape, taking damage. */
function endingNotes(effect: ChipEffect): string[] {
  const notes: string[] = [];
  if (effect.repeatSave)
    notes.push(`${effect.repeatSave.ability.toUpperCase()} save DC ${effect.repeatSave.dc} at the end of each turn`);
  if (effect.escapeDc) notes.push(`escape DC ${effect.escapeDc}`);
  if (effect.endsOnDamage) notes.push("ends on taking damage");
  return notes;
}

/**
 * Active rules-engine effects (Rage, a grapple, Concentration) as chips beside the condition chips. Tapping one
 * opens where it came from, how long it lasts and what else ends it, so the details read on a phone; ending it is
 * an explicit button there. Ending is a real engine transition: linked conditions clear and on-end grants fire
 * server-side (ADR-0020). `canEnd` is the GM's right to end anything; a player may end what their own character is
 * the source of (`yours`), and asks the GM about anything imposed on them (in a fight, where the GM's queue is).
 */
export function EffectChips({
  actorId,
  effects,
  canEnd,
  canAsk = false,
  onFeedback
}: Readonly<{
  actorId: string;
  effects: ReadonlyArray<ChipEffect>;
  canEnd: boolean;
  canAsk?: boolean;
  onFeedback: (text: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  if (effects.length === 0) return null;
  const open = effects.find((effect) => effect.id === shown);
  const end = (effectId: string, name: string) => {
    setBusy(true);
    void command("effect:end", { actorId, effectId }).then((result) => {
      setBusy(false);
      onFeedback(result.ok ? `${name} ended.` : (result.message ?? "The effect could not be ended."));
      if (result.ok) setShown(null);
    });
  };
  const ask = (effectId: string) => {
    setBusy(true);
    void command("rules:ask", { type: "effect.end", payload: { commandId: newId(), actorId, effectId } }).then(
      (result) => {
        setBusy(false);
        if (!result.ok) onFeedback(result.message ?? "That question could not be sent.");
        else onFeedback(result.ran ? "Done - no question needed." : "Asked the GM. Waiting for their call.");
      }
    );
  };
  return (
    <div className="effect-chips-block">
      <span className="effect-chips">
        {effects.map((effect) => (
          <Chip
            key={effect.id}
            tone="info"
            pressed={shown === effect.id}
            aria-expanded={shown === effect.id}
            disabled={busy}
            title={`${effect.name}${effect.sourceName ? ` - from ${effect.sourceName}` : ""} · ${effectDurationLabel(effect)}`}
            onClick={() => setShown((current) => (current === effect.id ? null : effect.id))}
          >
            {effect.name}
            {effect.escapeDc ? <small> DC {effect.escapeDc}</small> : null}
          </Chip>
        ))}
      </span>
      {open && (
        <div className="effect-detail" role="region" aria-label={`${open.name} details`}>
          <p className="effect-detail-name">{open.name}</p>
          <p className="effect-detail-line">
            {open.sourceName ? `From ${open.sourceName} · ` : ""}
            {effectDurationLabel(open)}
            {endingNotes(open).length > 0 ? ` · ${endingNotes(open).join(" · ")}` : ""}
          </p>
          <div className="effect-detail-actions">
            {canEnd || open.yours ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => end(open.id, open.name)}>
                End {open.name}
              </Button>
            ) : canAsk ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => ask(open.id)}>
                Ask the GM to end it
              </Button>
            ) : (
              <p className="effect-detail-muted">It ends by its own rules or when the GM ends it.</p>
            )}
            <Button size="sm" variant="ghost" onClick={() => setShown(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
