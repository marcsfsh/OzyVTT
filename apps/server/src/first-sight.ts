import type { GameState } from "@vtt/domain";
import { addEffect, endEffectIfPresent, makeEffect, type EffectNarration } from "./effects.js";
import { sightRules } from "./vision/rules.js";
import type { SightContent } from "./vision/senses.js";

/**
 * SRD Philter of Love: "The next time you see a creature within 10 minutes after drinking this philter, you have the
 * Charmed condition for 1 hour." The drink leaves a 10-minute effect with this tag; with dynamic vision on, the first
 * creature the drinker sees (the nearest, when several come into view at once) becomes the source of an hour of Charmed,
 * so the Charmed rules about the charmer apply to it. With vision off, sight is the GM's, who sets the condition naming
 * the charmer.
 */
export const FIRST_SIGHT_CHARMS_TAG = "first-sight-charms";

type Seen = Readonly<{ drinkerId: string; effectId: string; seenId: string }>;

/** Each waiting drinker and the creature it sees first. */
export function firstSightCharms(state: GameState, content: SightContent): Seen[] {
  const waiting = state.actors.filter((actor) =>
    actor.effects.some((effect) => effect.tags.includes(FIRST_SIGHT_CHARMS_TAG))
  );
  if (waiting.length === 0) return [];
  const rules = sightRules(state, content);
  const at = (actorId: string) => state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
  return waiting.flatMap((drinker) => {
    const from = at(drinker.id);
    const effect = drinker.effects.find((candidate) => candidate.tags.includes(FIRST_SIGHT_CHARMS_TAG))!;
    if (!from) return [];
    const seen = state.actors
      .filter(
        (other) =>
          other.id !== drinker.id &&
          !other.archived &&
          at(other.id) !== null &&
          rules.lineOfSight(drinker.id, other.id) === true &&
          rules.canSee(drinker.id, other.id)
      )
      .map((other) => {
        const to = at(other.id)!;
        return { id: other.id, apart: Math.hypot(to.x - from.x, to.y - from.y) };
      })
      .sort((a, b) => a.apart - b.apart);
    return seen[0] ? [{ drinkerId: drinker.id, effectId: effect.id, seenId: seen[0].id }] : [];
  });
}

/** Charms each waiting drinker by the creature it sees first, with a line for the table. */
export function settleFirstSight(state: GameState, content: SightContent): EffectNarration[] {
  return firstSightCharms(state, content).flatMap(({ drinkerId, effectId, seenId }) => {
    const drinker = state.actors.find((actor) => actor.id === drinkerId);
    const seen = state.actors.find((actor) => actor.id === seenId);
    if (!drinker || !seen) return [];
    const events: EffectNarration[] = [...endEffectIfPresent(state, drinkerId, effectId)];
    addEffect(
      state,
      drinkerId,
      makeEffect({
        id: `${effectId}:charmed`,
        name: `Charmed by ${seen.name} (Philter of Love)`,
        sourceActorId: seen.id,
        sourceName: seen.name,
        startedRound: state.combat.round,
        duration: { type: "minutes", remaining: 60 },
        linkedConditionIds: ["charmed"]
      }),
      events,
      {
        ...(content.definition ? { resolveDefinition: content.definition } : {}),
        ...(content.catalog ? { catalog: content.catalog } : {}),
        magical: true
      }
    );
    return [
      {
        kind: "condition" as const,
        text: `${drinker.name} sees ${seen.name} and is Charmed by it.`,
        actorId: drinkerId
      },
      ...events
    ];
  });
}
