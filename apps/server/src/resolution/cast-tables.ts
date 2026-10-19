import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { makeEffect } from "../effects.js";
import { recordRoll, type ResolveContext } from "./context.js";

/** The spells whose answers fail more often the more they are cast before a Long Rest. */
const CUMULATIVE: ReadonlySet<string> = new Set(["augury", "commune"]);

/** The tag on the marker each casting leaves until its caster's next Long Rest. */
const CAST_SINCE_REST_TAG = "cast-since-long-rest";

/** The most effects a creature carries (`ActorSchema`). */
const MAX_EFFECTS = 20;

/** "A cumulative 25 percent chance for each casting after the first". */
const CHANCE_PER_CASTING = 25;

/**
 * SRD Augury and Commune: "If you cast the spell more than once before finishing a Long Rest, there is a cumulative 25
 * percent chance for each casting after the first that you get no answer." Each casting leaves a marker that a Long
 * Rest ends; from the second on, the server rolls the d100 and says whether an answer comes.
 */
export function divinationChance(ctx: ResolveContext): void {
  const { state, action, attacker, input } = ctx;
  const spellId = action.spellId;
  if (spellId === undefined || !CUMULATIVE.has(spellId)) return;
  const earlier = attacker.effects.filter(
    (effect) => effect.tags.includes(CAST_SINCE_REST_TAG) && effect.sourceActionId === spellId
  ).length;
  const chance = Math.min(100, earlier * CHANCE_PER_CASTING);
  if (chance > 0) {
    const rolled = resolveDice(parseDiceFormula("1d100"), ctx.deps.random);
    recordRoll(ctx, rolled, "manual", `${action.name}: no answer on ${chance} or lower`);
    const silent = rolled.total <= chance;
    ctx.tableNarration.push({
      kind: "effect",
      text: silent
        ? `${action.name} gives ${attacker.name} no answer (d100 ${rolled.total}, ${chance} or lower fails).`
        : `${action.name} answers ${attacker.name} (d100 ${rolled.total}, over ${chance}).`,
      actorIds: [attacker.id]
    });
  }
  // The marker is its own each time, so the castings add up until the Long Rest ends them all. A creature with no room
  // for another effect keeps the count it has.
  if (attacker.effects.length >= MAX_EFFECTS) return;
  attacker.effects = [
    ...attacker.effects,
    makeEffect({
      id: `${input.commandId}:${spellId}:cast`,
      name: `${action.name} cast since the last Long Rest`.slice(0, 120),
      tags: [CAST_SINCE_REST_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: spellId,
      startedRound: state.combat.round,
      duration: { type: "until-rest", rest: "long" }
    })
  ];
}

/** SRD Reincarnate's d10, rolling a 1 again. */
const REINCARNATIONS = [
  "Dragonborn",
  "Dwarf",
  "Elf",
  "Gnome",
  "Goliath",
  "Halfling",
  "Human",
  "Orc",
  "Tiefling"
] as const;

/**
 * SRD Reincarnate: "Roll 1d10 and consult the following table to determine the creature's new species, or the GM
 * chooses the species" (a 1 rolls again). The server rolls it and says what comes back; the GM brings the creature
 * back and rebuilds its species.
 */
export function reincarnation(ctx: ResolveContext): void {
  if (ctx.action.spellId !== "reincarnate") return;
  let face = 1;
  for (let guard = 0; guard < 20 && face === 1; guard += 1) {
    const rolled = resolveDice(parseDiceFormula("1d10"), ctx.deps.random);
    recordRoll(ctx, rolled, "manual", "Reincarnate: new species");
    face = rolled.total;
  }
  const species = REINCARNATIONS[Math.max(2, face) - 2]!;
  const target = ctx.targets[0];
  ctx.tableNarration.push({
    kind: "effect",
    text: `Reincarnate rolls ${face}: ${target ? `${target.name} comes back` : "the creature comes back"} as ${/^[AEIOU]/.test(species) ? "an" : "a"} ${species}, unless the GM chooses another species.`,
    actorIds: [ctx.attacker.id, ...(target ? [target.id] : [])]
  });
  ctx.warnings.push(
    `Revive ${target?.name ?? "the creature"} and rebuild its species as ${species}: its old species traits go, everything else stays.`
  );
}

/**
 * SRD Chromatic Orb: "If you roll the same number on two or more of the d8s, the orb leaps to a different creature of
 * your choice within 30 feet of the target. Make an attack roll against the new target, and make a new damage roll."
 * The server sees the dice, so it says when the orb leaps and how many leaps the slot allows (one for a level 1 slot,
 * one per level above that); the next target is the caster's to aim at.
 */
export function orbLeap(ctx: ResolveContext): void {
  const { action, attack, state, input } = ctx;
  if (action.spellId !== "chromatic-orb" || attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit"))
    return;
  const faces = state.rolls
    .filter((roll) => roll.commandId === input.commandId && roll.purpose === "damage")
    .flatMap((roll) => roll.dice.filter((die) => die.sides === 8 && die.kept).map((die) => die.face));
  if (new Set(faces).size === faces.length) return;
  const slot = ctx.plan.castLevel ?? 1;
  const leaps = slot <= 1 ? 1 : slot;
  const target = ctx.targets[0];
  ctx.tableNarration.push({
    kind: "effect",
    text: `Two of Chromatic Orb's d8s match: the orb leaps to a different creature of ${ctx.attacker.name}'s choice within 30 feet of ${target?.name ?? "the target"}, with a new attack roll and damage roll of the same type (up to ${leaps} ${leaps === 1 ? "leap" : "leaps"}, each creature once).`,
    actorIds: [ctx.attacker.id]
  });
}
