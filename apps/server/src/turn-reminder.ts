import { gameTimeSpanLabel, type GameState } from "@vtt/domain";
import { conditionLabel } from "./condition-rules.js";
import { HIDDEN_SOURCE, withoutSourceName } from "./hidden-source.js";

type Effect = GameState["actors"][number]["effects"][number];

/** How long an effect has left, read at the start of its bearer's turn. */
function timeLeft(effect: Effect, bearerId: string, sourceName: string): string {
  const duration = effect.duration;
  const ownTurn = (effect.sourceActorId ?? bearerId) === bearerId;
  switch (duration.type) {
    case "rounds":
      return `${duration.remaining} ${duration.remaining === 1 ? "round" : "rounds"} left`;
    case "minutes":
      return `${gameTimeSpanLabel(duration.remaining)} left`;
    case "until-rest":
      return duration.rest === "long" ? "until its next Long Rest" : "until its next Short or Long Rest";
    case "until-source-next-turn":
      return `until ${sourceName}'s next turn starts`;
    case "until-bearer-next-turn":
      return "until the start of its next turn";
    case "until-bearer-turn-end":
      return duration.skipsCurrentTurn ? "until the end of its next turn" : "ends at the end of this turn";
    case "until-source-turn-end":
      if (!ownTurn) return `until the end of ${sourceName}'s turn`;
      return duration.skipsCurrentTurn ? "until the end of its next turn" : "ends at the end of this turn";
    case "encounter":
      return "for this encounter";
    case "manual":
      return "until ended";
  }
}

/**
 * The turn-start reminder: the incoming combatant's conditions and effects, with where each came from and how long
 * it has left ("Borin: Prone; Paralyzed (ends at the end of this turn)."), so whatever the engine
 * can't end by itself is in front of the table. Null when there is nothing to remind. A hidden source is named
 * "A hidden threat", as in the player projection, since the line is read by the whole table. `hiddenFromTable` is the
 * shared check (`hiddenFrom`), so a source out of every character's sight or under the fog is masked too; without it
 * only GM-only sources are.
 */
export function turnReminder(
  state: GameState,
  actorId: string,
  hiddenFromTable: (actorId: string) => boolean = (id) =>
    state.actors.find((candidate) => candidate.id === id)?.visibility !== "public"
): string | null {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return null;
  const hidden = (sourceActorId: string | null) => sourceActorId !== null && hiddenFromTable(sourceActorId);
  const items: string[] = [];
  for (const condition of actor.conditions) {
    if (actor.effects.some((effect) => effect.linkedConditionIds.includes(condition.id))) continue;
    items.push(`${conditionLabel(condition.id)}${condition.level !== undefined ? ` ${condition.level}` : ""}`);
  }
  for (const effect of actor.effects) {
    const masked = hidden(effect.sourceActorId);
    const name = masked ? withoutSourceName(effect.name, effect.sourceName) : effect.name;
    const sourceName = masked ? HIDDEN_SOURCE : (effect.sourceName ?? "its source");
    const notes = [timeLeft(effect, actor.id, sourceName)];
    if (effect.repeatSave)
      notes.push(
        `repeats the ${effect.repeatSave.ability.toUpperCase()} save (DC ${effect.repeatSave.dc}) as this turn ends`
      );
    if (effect.escapeDc !== null) notes.push(`escape DC ${effect.escapeDc}`);
    if (effect.endsOnDamage) notes.push("ends if it takes damage");
    items.push(`${name} (${notes.join(", ")})`);
  }
  return items.length === 0 ? null : `${actor.name}: ${items.join("; ")}.`;
}
