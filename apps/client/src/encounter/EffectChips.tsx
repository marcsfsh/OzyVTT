import { useState } from "react";
import { withArticle, type EffectInstance, type PlayerEffect } from "@vtt/domain";
import { Button, Chip } from "@vtt/ui";
import { command } from "../lib/command";
import { newId } from "../lib/ids";
import "./effect-chips.css";

/** The GM's copy also carries the ongoing damage dice, which players never receive. */
type ChipEffect = PlayerEffect & { escapeDc?: number | null; ongoingDamage?: EffectInstance["ongoingDamage"] };

/** How long an effect has left, in the table's words. */
export function effectDurationLabel(effect: Pick<PlayerEffect, "duration">): string {
  const duration = effect.duration;
  switch (duration.type) {
    case "rounds":
      return `${duration.remaining} ${duration.remaining === 1 ? "round" : "rounds"} left`;
    case "until-source-next-turn":
      return "until its source's next turn";
    case "until-bearer-next-turn":
      return "until the start of its next turn";
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

const capitalised = (type: string) => (type.length > 0 ? `${type[0].toUpperCase()}${type.slice(1)}` : type);

/** What it deals as a turn starts or ends while it lasts ("6d6 Acid at the start of each of its source's turns", "loses
 *  1d10 hit points at the start of each of its turns"). */
function ongoingDamageNote(effect: ChipEffect): string | null {
  const ongoing = effect.ongoingDamage;
  if (!ongoing) return null;
  const dice = ongoing.damage
    .map((part) => (part.type ? `${part.formula} ${capitalised(part.type)}` : part.formula))
    .join(" + ");
  const what = ongoing.hitPointLoss ? `loses ${dice} hit points` : dice;
  const when = ongoing.at.startsWith("bearer-") ? "its turns" : "its source's turns";
  const edge = ongoing.at.endsWith("-end") ? "end" : "start";
  const save = ongoing.saveToEnd
    ? `, then ${withArticle(`${ongoing.saveToEnd.ability.toUpperCase()} save`)} DC ${ongoing.saveToEnd.dc} that ends it`
    : "";
  return `${what} at the ${edge} of each of ${when}${save}`;
}

/** The SRD Burning hazard's tag, and the builtin action that puts the fire out on its bearer. */
const BURNING_TAG = "burning";
const PUT_OUT_FIRE_ACTION_ID = "extinguish-fire";

/**
 * Active rules-engine effects (Rage, a grapple, Concentration) as chips beside the condition chips. Tapping one
 * opens where it came from, how long it lasts and what else ends it, so the details read on a phone; ending it is
 * an explicit button there. Ending is a real engine transition: linked conditions clear and on-end grants fire
 * server-side (ADR-0020). `canEnd` is the GM's right to end anything; a player may end what their own character is
 * the source of (`yours`), and asks the GM about anything imposed on them (in a fight, where the GM's queue is).
 * `canAct` (the GM, or the bearer's owner) may put out a fire the bearer is burning in, which takes its action.
 */
export function EffectChips({
  actorId,
  effects,
  canEnd,
  canAsk = false,
  canAct = canEnd,
  onFeedback
}: Readonly<{
  actorId: string;
  effects: ReadonlyArray<ChipEffect>;
  canEnd: boolean;
  canAsk?: boolean;
  canAct?: boolean;
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
  // The server routes it: the bearer's action in its turn, a question for the GM off it, free outside a fight.
  const putOut = () => {
    setBusy(true);
    void command("action:use", { actorId, actionId: PUT_OUT_FIRE_ACTION_ID }).then((result) => {
      setBusy(false);
      onFeedback(result.ok ? "The fire is out." : (result.message ?? "The fire could not be put out."));
      if (result.ok) setShown(null);
    });
  };
  const ask = (effectId: string) => {
    setBusy(true);
    void command("rules:ask", { type: "effect.end", payload: { commandId: newId(), actorId, effectId } }).then(
      (result) => {
        setBusy(false);
        if (!result.ok) onFeedback(result.message ?? "That question could not be sent.");
        else onFeedback(result.ran ? "Done. No question was needed." : "Asked the GM. Waiting for their call.");
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
            title={`${effect.name}${effect.sourceName ? ` · from ${effect.sourceName}` : ""} · ${effectDurationLabel(effect)}`}
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
          {ongoingDamageNote(open) ? (
            <p className="effect-detail-line">{ongoingDamageNote(open)}</p>
          ) : open.tags.includes(BURNING_TAG) ? (
            <p className="effect-detail-line">1d4 Fire at the start of each of its turns until the fire is put out</p>
          ) : null}
          {canAct && open.tags.includes(BURNING_TAG) && (
            <p className="effect-detail-line">
              Rolling on the ground puts it out: it takes an action and leaves it Prone.
            </p>
          )}
          <div className="effect-detail-actions">
            {canAct && open.tags.includes(BURNING_TAG) && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={putOut}>
                Put out the fire
              </Button>
            )}
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
