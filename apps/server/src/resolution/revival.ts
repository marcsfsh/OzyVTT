import { isDead, ROUNDS_PER_MINUTE, type GameState } from "@vtt/domain";
import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { setCondition } from "../actor-conditions.js";
import { limitWords, returnToLife, roundsDead, timeWords } from "../death.js";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "../effects.js";
import { laterRowOf } from "../item-actions.js";
import type { RuleId } from "../rules-families.js";
import { endCursesOn } from "../spell-endings.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { spellOf } from "./concentration.js";
import { tableLineOf, type LiveActor, type ResolveContext } from "./context.js";

/**
 * Casts that bring the dead back (SRD Revivify, Raise Dead, Resurrection, True Resurrection, Reincarnate) and keep a
 * corpse for one (Gentle Repose), as the spell's `revives` and `reposes` say. Before anything is spent the cast's
 * targets are checked: dead, within the spell's time limit (game time, less any Gentle Repose), not Undead when they
 * died where the spell says so, and with a body unless the spell makes a new one. As the cast resolves each target
 * returns to life (`returnToLife`) with what the spell gives back.
 */

type Violation = Readonly<{ rule: RuleId; message: string }>;

/** The tag on Resurrection's toll: its caster can't cast spells until it finishes a Long Rest. */
export const NO_CASTING_TAG = "no-casting";

/** Reincarnate's d10 table: a 1 rolls again. */
const REINCARNATE_SPECIES: Readonly<Record<number, string>> = {
  2: "Dragonborn",
  3: "Dwarf",
  4: "Elf",
  5: "Gnome",
  6: "Goliath",
  7: "Halfling",
  8: "Human",
  9: "Orc",
  10: "Tiefling"
};

/** The dead creatures this spell can't take, each with the sentence that says why. */
export function revivalViolations(
  input: Readonly<{
    state: GameState;
    spell: SpellReference;
    targetIds: readonly string[];
    resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
  }>
): Violation[] {
  const { state, spell } = input;
  const revives = spell.effect?.revives;
  if (!revives && !spell.effect?.reposes) return [];
  const violations: Violation[] = [];
  const refuse = (message: string) => violations.push({ rule: "target.revival", message });
  for (const targetId of new Set(input.targetIds)) {
    const target = state.actors.find((candidate) => candidate.id === targetId);
    if (!target) continue;
    const name = target.name;
    if (!isDead(target)) {
      refuse(
        revives
          ? `${name} isn't dead, so ${spell.name} has no one to bring back.`
          : `${spell.name} touches a corpse, and ${name} isn't dead.`
      );
      continue;
    }
    if (!revives) continue;
    const death = target.death;
    if (death?.bodyGone && !revives.newBody)
      refuse(
        `Nothing is left of ${name}'s body${death.cause ? ` (${death.cause})` : ""}. Only a spell that makes a new body, such as True Resurrection, brings ${name} back.`
      );
    const rounds = roundsDead(state, target);
    if (rounds !== null && rounds > revives.withinMinutes * ROUNDS_PER_MINUTE)
      refuse(
        `${name} died ${timeWords(rounds)} ago, and ${spell.name} reaches back ${limitWords(revives.withinMinutes)}.`
      );
    if (revives.notUndead && input.resolveDefinition) {
      const definition = target.definitionId ? input.resolveDefinition(target.definitionId) : undefined;
      if (creatureTypeOf(target, definition) === "undead")
        refuse(`${spell.name} can't revive ${name}, who was Undead at death.`);
    }
  }
  return violations;
}

/** Brings each dead target of a revival spell back to life as the spell says. A GM override can aim it at a creature
 *  the check refused; one still alive is left alone. */
export function reviveOnCast(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  const revives = spell?.effect?.revives;
  if (!spell || !revives || laterRowOf(spell, ctx.action.id) !== undefined || ctx.input.commit === false) return;
  for (const target of ctx.targets) {
    if (!isDead(target)) {
      ctx.warnings.push(`${target.name} isn't dead, so ${spell.name} does nothing to ${target.name}.`);
      continue;
    }
    const rounds = roundsDead(ctx.state, target);
    if (rounds === null)
      ctx.warnings.push(
        `When ${target.name} died isn't known, so ${spell.name}'s limit of ${limitWords(revives.withinMinutes)} is the GM's to judge.`
      );
    const definition = target.definitionId ? ctx.deps.resolveDefinition?.(target.definitionId) : undefined;
    const events = returnToLife(target, revives.hitPoints === "all" ? target.hp.maximum : 1, {
      definition,
      ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
    });
    if (revives.endsPoison) events.push(...curePoison(ctx.state, target, spell.name));
    if (revives.endsCurses) events.push(...liftCurses(ctx.state, target));
    if (revives.newBody && creatureTypeOf(target, definition) === "undead")
      events.push({
        kind: "condition",
        text: `${target.name} is restored to a living form. Its stat block is the GM's to set.`,
        actorId: target.id,
        gmOnly: true
      });
    if (revives.rollsSpecies) events.push(...newSpecies(ctx, target));
    if (
      revives.taxesCasterAfterMinutes !== undefined &&
      rounds !== null &&
      rounds >= revives.taxesCasterAfterMinutes * ROUNDS_PER_MINUTE
    )
      events.push(...taxCaster(ctx, spell.name));
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
  }
}

/** "This spell also neutralizes any poisons that affected the creature." */
function curePoison(state: GameState, target: LiveActor, spellName: string): EffectNarration[] {
  if (!target.conditions.some((condition) => condition.id === "poisoned")) return [];
  setCondition(state, target.id, "poisoned", false, undefined, { role: "gm" });
  return [{ kind: "effect", text: `${target.name} is no longer Poisoned (${spellName}).`, actorId: target.id }];
}

/** True Resurrection "cures all magical contagions, and lifts any curses": the curses end, and so does Contagion. */
function liftCurses(state: GameState, target: LiveActor): EffectNarration[] {
  const events = endCursesOn(state, target.id);
  for (const effect of target.effects.filter((candidate) => candidate.spell?.id === "contagion"))
    events.push(...endEffect(state, target.id, effect.id));
  return events;
}

/** Reincarnate: "Roll 1d10 and consult the table below to determine the body's species", a 1 rolling again. The
 *  server rolls it; remaking the sheet with the new species' traits is the GM's, so a lasting note says which. */
function newSpecies(ctx: ResolveContext, target: LiveActor): EffectNarration[] {
  let face = 1;
  for (let tries = 0; face === 1 && tries < 20; tries += 1) face = Math.max(1, Math.min(10, ctx.deps.random(10)));
  const species = REINCARNATE_SPECIES[face] ?? "Human";
  addEffect(
    ctx.state,
    target.id,
    makeEffect({
      id: `${ctx.input.commandId}:${target.id}:reincarnated`,
      name: `Reincarnated as a ${species}`,
      sourceActorId: ctx.attacker.id,
      sourceName: ctx.attacker.name,
      startedRound: ctx.state.combat.round,
      duration: { type: "manual" }
    })
  );
  return [
    {
      kind: "effect",
      text: `${target.name}'s new body is a ${species} (d10: ${face}). The sheet takes the ${species} traits when the GM rebuilds it.`,
      actorId: target.id
    }
  ];
}

/** Resurrection on a creature dead a year or more: "Until you finish a Long Rest, you can't cast spells again, and you
 *  have Disadvantage on D20 Tests." */
function taxCaster(ctx: ResolveContext, spellName: string): EffectNarration[] {
  const caster = ctx.attacker;
  const disadvantage = (roll: "attack" | "save" | "check" | "initiative") => ({
    type: "roll-mode" as const,
    roll,
    mode: "disadvantage" as const
  });
  addEffect(
    ctx.state,
    caster.id,
    makeEffect({
      id: `${ctx.input.commandId}:ordeal`,
      name: `${spellName}'s toll`,
      tags: [NO_CASTING_TAG],
      sourceActorId: caster.id,
      sourceName: caster.name,
      startedRound: ctx.state.combat.round,
      duration: { type: "until-rest", rest: "long" },
      modifiers: [disadvantage("attack"), disadvantage("save"), disadvantage("check"), disadvantage("initiative")]
    })
  );
  return [
    {
      kind: "effect",
      text: `Raising one so long dead taxes ${caster.name}: no spells and Disadvantage on D20 Tests until a Long Rest.`,
      actorId: caster.id
    }
  ];
}
