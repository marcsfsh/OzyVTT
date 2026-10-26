import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { catalogIdOf, type ActorAction, type StoredCast } from "@vtt/schemas";
import { commanderOf } from "./authorization.js";
import { addEffect, endEffectIfPresent, makeEffect } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import {
  castAreaOf,
  isItemActionId,
  laterRowOf,
  spellActivationOf,
  spellCastMechanics,
  upcastAction
} from "./item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { traitMechanicsOf } from "./statblock-traits.js";
import { casterSpellNumbers } from "./resolution/grant-extras.js";
import { tableLineOf, type ResolveContext } from "./resolution/context.js";
import { spellOf } from "./resolution/concentration.js";

/**
 * Spells cast now and held for later at their caster's numbers (SRD 5.2.1): Contingency's contingent spell, which its
 * caster releases on itself when the trigger it described happens; a spell glyph's spell, released on the creature that
 * sets the glyph off; a Ring of Spell Storing's spells, cast by its attuned wearer; and a shield guardian's stored spell.
 *
 * A store waits for its spell (`storeAwaits`): Contingency's cast and a glyph's leave their caster a minute in which the
 * next spell it casts that fits is held, and a ring held out takes the next spell cast at its wearer or by it. The
 * cast spends its slot and components and does nothing else; what holds it keeps the spell, its level and its caster's
 * spell save DC, attack bonus and modifier (`StoredCast`). A held spell is an action of the creature that may release
 * it, at those numbers, with no slot or components, and releasing it spends it.
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

export const STORED_CAST_PREFIX = "stored-cast-";
export const isStoredCast = (actionId: string) => actionId.startsWith(STORED_CAST_PREFIX);
const STORE_AWAITS_TAG = "store-awaits";
const RING_ID = "ring-of-spell-storing";
/** "The ring can store up to 5 levels worth of spells at a time." */
export const RING_LEVELS = 5;
/** How long a store waits for its spell: the minute of the cast it is part of. */
const WINDOW_ROUNDS = 10;

/** The spell levels a ring holds now. */
const levelsHeld = (casts: readonly StoredCast[] | undefined) =>
  (casts ?? []).reduce((sum, cast) => sum + Math.max(1, cast.level), 0);

/**
 * Opens a store's window as its grant lands. Contingency's lasts its 10 days and holds the spell, so a marker of a
 * minute waits beside it; a glyph's and a ring's effect is the window itself. A spell glyph takes a spell of up to the
 * glyph's own level.
 */
export function openStoreWindow(
  ctx: ResolveContext,
  bearer: Actor,
  holder: Effect,
  awaits: NonNullable<Effect["storeAwaits"]>,
  castLevel: number | null
): void {
  const via = awaits.via;
  const maxLevel = via === "glyph" && castLevel !== null ? castLevel : awaits.maxLevel;
  const what = via === "contingency" ? "Contingency" : via === "glyph" ? "the glyph" : "the ring";
  if (via === "contingency")
    addEffect(
      ctx.state,
      bearer.id,
      makeEffect({
        id: `${holder.id}:awaits`.slice(0, 120),
        name: `${holder.name}: waiting for a spell`.slice(0, 120),
        tags: [STORE_AWAITS_TAG],
        sourceActorId: bearer.id,
        sourceName: bearer.name,
        sourceActionId: `${holder.sourceActionId ?? "store"}:awaits`.slice(0, 120),
        startedRound: ctx.state.combat.round,
        duration: { type: "rounds", remaining: WINDOW_ROUNDS },
        storeAwaits: { via, maxLevel, holderEffectId: holder.id }
      })
    );
  else
    bearer.effects = bearer.effects.map((effect) =>
      effect.id === holder.id ? { ...effect, storeAwaits: { via, maxLevel } } : effect
    );
  ctx.warnings.push(
    `${bearer.name}: the next spell of level ${maxLevel} or lower cast ${via === "ring" ? "at or by it" : "by it"} within a minute is stored in ${what}.`
  );
}

/** Whether a spell can be Contingency's: "a spell of level 5 or lower that you can cast, that has a casting time of an
 *  action, and that can target you". */
function contingentSpell(spell: SpellReference): boolean {
  if (!/^(?:1 )?action\b/i.test(spell.castingTime.trim())) return false;
  return /^(?:self|touch)/i.test(spell.range.text ?? "") || spell.target?.type === "creature";
}

/** The window open on a creature for a spell of `via`, if any. */
const windowOf = (actor: Actor, via: "contingency" | "glyph" | "ring") =>
  actor.effects.find((effect) => effect.storeAwaits?.via === via);

/**
 * Stores the cast instead of letting it act, when a store is waiting for it: true when it did, and the cast's slot and
 * components are spent with nothing else. A spell that doesn't fit what waits is cast as usual, except in a ring held
 * out to it, where it is lost ("the spell is expended without effect").
 */
export function storeOnCast(ctx: ResolveContext): boolean {
  const { state, action, attacker, input } = ctx;
  const spell = spellOf(ctx);
  if (!spell || input.commit === false || input.economyPaid === true) return false;
  if (laterRowOf(spell, action.id) || isStoredCast(action.id) || isItemActionId(action.id)) return false;
  const level = ctx.plan.castLevel ?? spell.level;
  const numbers = casterSpellNumbers(ctx.deps.definition, action.spellId);
  const held = (via: StoredCast["via"]): StoredCast => ({
    spellId: spell.id,
    level,
    saveDc: action.save?.dc ?? numbers.saveDc,
    attackBonus: action.attack?.bonus ?? numbers.attackBonus,
    modifier: Math.max(-5, Math.min(15, numbers.modifier)),
    casterId: attacker.id,
    casterName: attacker.name,
    via
  });
  const say = (text: string, actorId = attacker.id) =>
    ctx.tableNarration.push(tableLineOf(ctx, { kind: "effect", text, actorId }));

  const contingency = windowOf(attacker, "contingency");
  if (contingency && level <= contingency.storeAwaits!.maxLevel && contingentSpell(spell)) {
    const holderId = contingency.storeAwaits!.holderEffectId;
    endEffectIfPresent(state, attacker.id, contingency.id);
    attacker.effects = attacker.effects.map((effect) =>
      effect.id === holderId
        ? { ...effect, name: `Contingency (${spell.name})`.slice(0, 120), storedCast: held("contingency") }
        : effect
    );
    say(`${attacker.name} casts ${spell.name} into Contingency, to take effect when its trigger happens.`);
    return true;
  }

  const glyphWindow = windowOf(attacker, "glyph");
  if (glyphWindow && level <= glyphWindow.storeAwaits!.maxLevel) {
    const glyph = [...state.combat.spellZones]
      .reverse()
      .find((zone) => zone.casterId === attacker.id && zone.spellId === "glyph-of-warding" && !zone.storedCast);
    endEffectIfPresent(state, attacker.id, glyphWindow.id);
    if (glyph) {
      state.combat = {
        ...state.combat,
        spellZones: state.combat.spellZones.map((zone) =>
          zone.id === glyph.id ? { ...zone, storedCast: held("glyph") } : zone
        )
      };
      say(`${attacker.name} casts ${spell.name} into the glyph, to take effect on the creature that sets it off.`);
      return true;
    }
  }

  // "Any creature can cast a spell of level 1 through 5 into the ring by touching the ring as the spell is cast."
  const wearers = [attacker, ...ctx.targets.filter((target) => target.id !== attacker.id)];
  for (const wearer of wearers) {
    const open = windowOf(wearer, "ring");
    if (!open) continue;
    const ring = wearer.inventory.find((row) => catalogIdOf(row) === RING_ID && row.quantity > 0);
    endEffectIfPresent(state, wearer.id, open.id);
    if (!ring) continue;
    if (level < 1 || level > open.storeAwaits!.maxLevel || levelsHeld(ring.storedCasts) + level > RING_LEVELS) {
      say(`${spell.name} doesn't fit in ${wearer.name}'s ${ring.name} and is lost.`, wearer.id);
      return true;
    }
    wearer.inventory = wearer.inventory.map((row) =>
      row.id === ring.id ? { ...row, storedCasts: [...(row.storedCasts ?? []), held("ring")] } : row
    );
    say(`${attacker.name} casts ${spell.name} into ${wearer.name}'s ${ring.name}.`, wearer.id);
    return true;
  }

  // A shield guardian's Spell Storing: its amulet's wearer, the creature that commands it, casts at it within 5 feet.
  const guardian = ctx.targets.length === 1 ? ctx.targets[0]! : undefined;
  const storing = guardian
    ? traitMechanicsOf(guardian.definitionId ? ctx.deps.resolveDefinition?.(guardian.definitionId) : undefined).find(
        (mechanic) => mechanic.kind === "spell-storing"
      )
    : undefined;
  if (guardian && storing?.kind === "spell-storing" && commanderOf(state, guardian)?.id === attacker.id) {
    const apart = ctx.deps.distanceFeet?.(attacker.id, guardian.id) ?? null;
    if (level <= storing.maxLevel && (apart === null || apart <= 5 + DISTANCE_TOLERANCE_FEET)) {
      // "Any previously stored spell is lost when a new spell is stored."
      for (const effect of guardian.effects.filter((entry) => entry.storedCast?.via === "guardian"))
        endEffectIfPresent(state, guardian.id, effect.id);
      addEffect(
        state,
        guardian.id,
        makeEffect({
          id: `${input.commandId}:stored`,
          name: `${storing.name} (${spell.name})`.slice(0, 120),
          sourceActorId: attacker.id,
          sourceName: attacker.name,
          sourceActionId: `${action.id}:stored`.slice(0, 120),
          startedRound: state.combat.round,
          duration: { type: "manual" },
          storedCast: held("guardian")
        })
      );
      say(`${attacker.name} casts ${spell.name} into ${guardian.name}, which stores it.`, guardian.id);
      return true;
    }
  }
  return false;
}

/** The action that casts a held spell at its caster's numbers: no slot, no components, at the level it was cast. */
function heldAction(
  spell: SpellReference,
  cast: StoredCast,
  id: string,
  name: string,
  activation: ActorAction["activation"],
  description: string
): ActorAction {
  const mechanics = spellCastMechanics(spell, {
    attackBonus: cast.attackBonus,
    saveDc: cast.saveDc,
    bearersDc: false,
    modifier: cast.modifier
  });
  const built: ActorAction = {
    id,
    name,
    activation,
    description: `${description} ${spell.description}`.slice(0, 12000),
    ...mechanics,
    ...castAreaOf(spell, mechanics),
    spellId: spell.id
  };
  return cast.level > spell.level ? upcastAction(built, spell, cast.level) : built;
}

/**
 * The held spells a creature may release now: Contingency's on its caster, with no action ("the contingent spell takes
 * effect immediately after the circumstance is met"); a guardian's at the spell's casting time; and each spell a Ring of
 * Spell Storing its bearer is attuned to holds, at the spell's casting time.
 */
export function storedCastActions(actor: Actor, catalog: EquipmentCatalog | undefined): ActorAction[] {
  const spellOfCast = (cast: StoredCast) => catalog?.spellRecord?.(cast.spellId);
  const fromEffects = actor.effects.flatMap((effect): ActorAction[] => {
    const cast = effect.storedCast;
    const spell = cast ? spellOfCast(cast) : undefined;
    if (!cast || !spell) return [];
    return cast.via === "contingency"
      ? [
          heldAction(
            spell,
            cast,
            `${STORED_CAST_PREFIX}${effect.id}`,
            `Contingency: ${spell.name}`,
            "other",
            "When the circumstance Contingency describes happens, its spell takes effect on you alone, and Contingency ends."
          )
        ]
      : [
          heldAction(
            spell,
            cast,
            `${STORED_CAST_PREFIX}${effect.id}`,
            `Spell Storing: ${spell.name}`,
            spellActivationOf(spell.castingTime),
            `Cast at ${cast.casterName}'s numbers, with no components, and then lost.`
          )
        ];
  });
  const fromRings = actor.inventory.flatMap((row): ActorAction[] =>
    catalogIdOf(row) === RING_ID && row.attuned
      ? (row.storedCasts ?? []).flatMap((cast, index) => {
          const spell = spellOfCast(cast);
          return spell
            ? [
                heldAction(
                  spell,
                  cast,
                  `${STORED_CAST_PREFIX}${row.id}-${index}`,
                  `${row.name}: ${spell.name}`,
                  spellActivationOf(spell.castingTime),
                  `Cast from the ring at ${cast.casterName}'s numbers, freeing its space.`
                )
              ]
            : [];
        })
      : []
  );
  return [...fromEffects, ...fromRings];
}

/** The Contingency a release spends, when the action releases one. */
function contingencyOf(actor: Actor, actionId: string): Effect | undefined {
  if (!isStoredCast(actionId)) return undefined;
  const effectId = actionId.slice(STORED_CAST_PREFIX.length);
  const effect = actor.effects.find((entry) => entry.id === effectId);
  return effect?.storedCast?.via === "contingency" ? effect : undefined;
}

/**
 * Checks a release before anything rolls: Contingency's spell "takes effect only on you", and only while its caster
 * carries the statuette ("the spell ends if the statuette isn't on your person").
 */
export function checkStoredRelease(attacker: Actor, actionId: string, targetIds: readonly string[]): void {
  const contingency = contingencyOf(attacker, actionId);
  if (!contingency) return;
  if (targetIds.some((id) => id !== attacker.id))
    throw new CommandRejectedError(`Contingency's spell takes effect on ${attacker.name} alone.`);
  if (!attacker.inventory.some((row) => row.quantity > 0 && /statuette/i.test(row.name)))
    throw new CommandRejectedError(
      `${attacker.name} isn't carrying the statuette Contingency needs, so the spell has ended. End its effect.`
    );
}

/** A released spell is spent: Contingency ends, a guardian's stored spell is lost, and a ring's space is freed. */
export function spendStoredCast(ctx: ResolveContext): void {
  const { state, action, attacker, input } = ctx;
  if (!isStoredCast(action.id) || input.commit === false) return;
  const rest = action.id.slice(STORED_CAST_PREFIX.length);
  const effect = attacker.effects.find((entry) => entry.id === rest);
  if (effect) {
    for (const event of endEffectIfPresent(state, attacker.id, effect.id))
      ctx.tableNarration.push(tableLineOf(ctx, event));
    return;
  }
  const ring = attacker.inventory.find((row) => rest.startsWith(`${row.id}-`) && row.storedCasts);
  if (!ring) return;
  const index = Number(rest.slice(ring.id.length + 1));
  attacker.inventory = attacker.inventory.map((row) =>
    row.id === ring.id ? { ...row, storedCasts: (row.storedCasts ?? []).filter((_, at) => at !== index) } : row
  );
}
