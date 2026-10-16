import { isDead, makeHitDicePool, type GameState, type HitDiceEntry } from "@vtt/domain";
import type { Actor, ActorAction, ActorDefinition } from "@vtt/schemas";
import { abilityModifier as scoreModifier, collectRiders } from "@vtt/rules-5e";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { CommandRejectedError } from "./game-store.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";
import { endEffectsAtLongRest, reduceExhaustion, removeConditionDirect, type EffectNarration } from "./effects.js";
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

/** The sizes of the next `count` Hit Dice a pool spends, biggest first, matching `spendFromPool`: a
 *  Fighter 3 / Wizard 2 rolls d10s, then d6s. Short when the pool holds fewer. */
export function hitDieSizesToSpend(entries: readonly HitDiceEntry[], count: number): number[] {
  return [...entries]
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)))
    .flatMap((entry) => Array.from({ length: entry.remaining }, () => Number(entry.die.slice(1))))
    .slice(0, count);
}

/** Spends Hit Point Dice to heal (SRD 5.2.1 Short Rest): each die heals `face + Con modifier`, minimum 1.
 *  The caller rolls the faces before the store executes (so retries never reroll) and records them; this
 *  owns validation, healing (via healActor) and the pool decrement. */
export function spendHitDice(
  state: GameState,
  actorId: string,
  faces: readonly number[],
  scope: Initiator,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  count: number = faces.length
): { healed: number; events: EffectNarration[]; conModifier: number } {
  requireActorAccess(scope, state, actorId, "resource");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("Hit Dice are spent on a rest - end the encounter first.");
  refuseRestAtZero(actor, "Hit Dice are spent on a Short Rest, which needs");
  if (!actor.hitDice)
    throw new CommandRejectedError(`${actor.name} has no Hit Dice pool (its stat block has no hit-point formula).`);
  if (actor.hitDice.remaining < count || faces.length < count)
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

/** SRD Resting: "To start a Short Rest [or a Long Rest], you must have at least 1 Hit Point", and nothing brings
 *  the dead back but a revival. `needs` finishes the refusal: what asks for that 1 Hit Point. */
function refuseRestAtZero(actor: Actor, needs: string): void {
  if (isDead(actor)) throw new CommandRejectedError(`${actor.name} is dead - a rest can't bring them back.`);
  if (actor.hp.current < 1)
    throw new CommandRejectedError(`${actor.name} has 0 Hit Points - ${needs} at least 1. Heal them first.`);
}

/** The pools a Short Rest partly or wholly refills beyond their own recharge, from the `short-rest-regain` riders the
 *  character's features carry (Rage, Second Wind, Channel Divinity, Wild Shape: one use; Font of Inspiration: all).
 *  Read live, so a sheet built before a feature gained its rider gets it too. Two printings of one rule don't add. */
export function shortRestRegains(derivation: EquipmentDerivation): ReadonlyMap<string, number | "all"> {
  const regains = new Map<string, number | "all">();
  for (const rider of collectRiders(derivation.carriers, { ...derivation.context, moment: null })) {
    if (rider.modifier.type !== "short-rest-regain" || !rider.modifier.poolId) continue;
    const pool = rider.modifier.poolId;
    const amount = rider.modifier.amount ?? "all";
    const known = regains.get(pool);
    if (known === "all" || (typeof known === "number" && amount !== "all" && known >= amount)) continue;
    regains.set(pool, amount);
  }
  return regains;
}

/**
 * What is still spent after a Short Rest: short-rest and recharge pools come back, and so do pools that come back
 * when Initiative is rolled or on any rest (Boon of Fate's "until you roll Initiative or finish a Short or Long Rest");
 * a long-rest pool with a `short-rest-regain` rider gets that many uses back.
 */
function usesAfterShortRest(
  spent: Actor["actionUses"],
  actions: readonly ActorAction[],
  regains: ReadonlyMap<string, number | "all">
): Actor["actionUses"] {
  const after: Record<string, number> = { ...spent };
  const settled = new Set<string>();
  for (const action of actions) {
    if (!action.uses || action.uses.per === "turn") continue;
    const key = action.uses.pool ?? action.id;
    if (settled.has(key) || after[key] === undefined) continue;
    settled.add(key);
    const per = action.uses.per;
    const regain = regains.get(key);
    if (per === "short-rest" || per === "recharge" || per === "encounter" || regain === "all") delete after[key];
    else if (regain !== undefined) {
      const left = after[key] - regain;
      if (left > 0) after[key] = left;
      else delete after[key];
    }
  }
  return after;
}

/** Which re-choices a rest ends: a short rest clears those naming it; a long rest clears everything. */
function clearOverrides(overrides: Actor["choiceOverrides"], kind: "long" | "short"): Actor["choiceOverrides"] {
  if (kind === "long") return {};
  return Object.fromEntries(Object.entries(overrides).filter(([, override]) => override.per !== "short-rest"));
}

/**
 * Applies a rest to a rostered actor outside combat (SRD Resting, ADR-0020). Either needs at least 1 Hit Point, so
 * the dying and the dead get nothing from it.
 * Short: per-short-rest, recharge and per-encounter pools re-arm, and long-rest pools a feature partly refills
 * (Rage's one use) get those uses back; healing is only by spending Hit Point Dice.
 * Long: Concentration and turn-measured effects end first (onEnd grants land), then HP to max, temp HP cleared, all
 * pools refreshed, all Hit Point Dice restored, Exhaustion drops one level.
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
  refuseRestAtZero(actor, `a ${kind === "long" ? "Long" : "Short"} Rest needs`);
  const events: EffectNarration[] = [];
  if (kind === "short") {
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    actor.actionUses = usesAfterShortRest(
      actor.actionUses,
      // Effective actions: a wand's charges live on a derived action and must re-arm too.
      effectiveActions(definition, actor, catalog),
      shortRestRegains(deriveEquipment(actor, definition, catalog))
    );
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
  reduceExhaustion(actor);
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
