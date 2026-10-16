import { makeHitDicePool, type GameState, type HitDiceEntry } from "@vtt/domain";
import type { Actor, ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier } from "@vtt/rules-5e";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { CommandRejectedError } from "./game-store.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { endEffectsAtLongRest, removeConditionDirect, type EffectNarration } from "./effects.js";
import { requireActorAccess, type Initiator } from "./authorization.js";
import { healActor } from "./hit-points.js";

/** Takes `count` dice off a multiclass pool, biggest die first (the order the roll uses). The caller has
 *  already checked the pool holds enough. */
function spendFromPool(entries: readonly HitDiceEntry[], count: number): HitDiceEntry[] {
  let left = count;
  return [...entries]
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)))
    .map((entry) => {
      const taken = Math.min(left, entry.remaining);
      left -= taken;
      return { ...entry, remaining: entry.remaining - taken };
    });
}

/** Spends Hit Point Dice to heal (SRD 5.2.1 Short Rest): each die heals `face + Con modifier`, minimum 1.
 *  The caller rolls the faces before the store executes (so retries never reroll) and records them; this
 *  owns validation, healing (via healActor) and the pool decrement. */
export function spendHitDice(
  state: GameState,
  actorId: string,
  faces: readonly number[],
  scope: Initiator,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): { healed: number; events: EffectNarration[]; conModifier: number } {
  requireActorAccess(scope, state, actorId, "resource");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("Hit Dice are spent on a rest - end the encounter first.");
  if (!actor.hitDice)
    throw new CommandRejectedError(`${actor.name} has no Hit Dice pool (its stat block has no hit-point formula).`);
  if (actor.hitDice.remaining < faces.length)
    throw new CommandRejectedError(
      `${actor.name} has ${actor.hitDice.remaining} Hit ${actor.hitDice.remaining === 1 ? "Die" : "Dice"} left.`
    );
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  const conModifier = definition ? scoreModifier(definition.abilityScores.con) : 0;
  const healed = faces.reduce((sum, face) => sum + Math.max(1, face + conModifier), 0);
  const events = healActor(state, actorId, healed, scope);
  // Decrement the pool, not a single counter: a Fighter 3 / Wizard 2 spends its d10s before its d6s.
  actor.hitDice = makeHitDicePool(spendFromPool(actor.hitDice.entries, faces.length));
  return { healed, events, conModifier };
}

/** Which re-choices a rest ends: a short rest clears those naming it; a long rest clears everything. */
function clearOverrides(overrides: Actor["choiceOverrides"], kind: "long" | "short"): Actor["choiceOverrides"] {
  if (kind === "long") return {};
  return Object.fromEntries(Object.entries(overrides).filter(([, override]) => override.per !== "short-rest"));
}

/**
 * Applies a rest to a rostered actor outside combat (SRD Resting, ADR-0020).
 * Short: per-short-rest and recharge pools re-arm; healing is only by spending Hit Point Dice.
 * Long: Concentration and turn-measured effects end first (onEnd grants land), then HP to max, temp HP cleared, dying
 * cleared, all pools refreshed, all Hit Point Dice restored, Exhaustion drops one level.
 */
export function applyRest(
  state: GameState,
  actorId: string,
  kind: "long" | "short",
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("End the encounter before resting a combatant who is in it.");
  const events: EffectNarration[] = [];
  if (kind === "short") {
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    // Effective actions: a wand's charges live on a derived action and must re-arm too.
    for (const action of effectiveActions(definition, actor, catalog)) {
      if (action.uses?.per !== "short-rest" && action.uses?.per !== "recharge") continue;
      const key = action.uses.pool ?? action.id;
      if (actor.actionUses[key] !== undefined) {
        const { [key]: _cleared, ...rest } = actor.actionUses;
        actor.actionUses = rest;
      }
    }
    // A pick re-made "whenever you finish a Short or Long Rest" lapses here; the build's own answer stands
    // until the character chooses again.
    actor.choiceOverrides = clearOverrides(actor.choiceOverrides, "short");
    return events;
  }
  // Eight hours of sleep: Concentration ends and turn-measured effects lapse; "until ended" ones (a curse) stay.
  events.push(...endEffectsAtLongRest(state, actorId));
  actor.hp.current = actor.hp.maximum;
  actor.hp.temporary = 0;
  // Every die size in the pool comes back, not just the largest (SRD 5.2.1 "Regain All HP").
  if (actor.hitDice)
    actor.hitDice = makeHitDicePool(actor.hitDice.entries.map((entry) => ({ ...entry, remaining: entry.maximum })));
  actor.deathSaves = null;
  removeConditionDirect(actor, "unconscious");
  actor.actionUses = {};
  // Both kinds lapse on a long rest.
  actor.choiceOverrides = clearOverrides(actor.choiceOverrides, "long");
  const exhaustion = actor.conditions.find((condition) => condition.id === "exhaustion");
  if (exhaustion) {
    if ((exhaustion.level ?? 1) <= 1) removeConditionDirect(actor, "exhaustion");
    else
      actor.conditions = actor.conditions.map((condition) =>
        condition.id === "exhaustion" ? { ...condition, level: (condition.level ?? 1) - 1 } : condition
      );
  }
  // SRD long rest: spell slots (and Pact Magic) refill and prepared spells reset to the sheet's defaults.
  // No spellcasting leaves these untouched.
  const longRestDefinition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  if (actor.spellSlots && longRestDefinition?.spellcasting) {
    // `spellSlotMaxima` covers derived multiclass tables and item-added slots, shared with seeding and the
    // spend clamp.
    const maxByLevel = new Map(
      spellSlotMaxima(longRestDefinition, deriveEquipment(actor, longRestDefinition, catalog).spellSlots).map(
        (entry) => [entry.level, entry.max] as const
      )
    );
    actor.spellSlots = actor.spellSlots.map((slot) => ({
      ...slot,
      remaining: maxByLevel.get(slot.level) ?? slot.remaining
    }));
  }
  const pactMaximum = actor.pactSlots ? pactSlotMaximum(longRestDefinition) : null;
  if (actor.pactSlots && pactMaximum) actor.pactSlots = { ...actor.pactSlots, remaining: pactMaximum.max };
  if (longRestDefinition?.spellcasting)
    actor.preparedSpellIds = longRestDefinition.spellcasting.spells
      .filter((spell) => spell.prepared || spell.alwaysPrepared)
      .map((spell) => spell.id);
  return events;
}
