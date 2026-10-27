import type { Actor, PendingSave, SpellZone } from "@vtt/domain";
import { parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import { conditionLabel } from "../condition-rules.js";
import type { EffectNarration } from "../effects.js";
import { OFF_PLANE_TAG } from "../off-plane.js";
import { createPendingSaves } from "../saving-throws.js";
import { recordRoll, type ResolveContext } from "./context.js";
import { failureEffectFor, isMagicalAction, spellCastOf } from "./pending.js";

type LiveTarget = ResolveContext["targets"][number];

/** SRD Prismatic Spray's rays, by the d8 rolled for each creature in the Cone (8 is two rays, rerolling any 8). */
const RAYS = [
  { colour: "Red", damageType: "fire" },
  { colour: "Orange", damageType: "acid" },
  { colour: "Yellow", damageType: "lightning" },
  { colour: "Green", damageType: "poison" },
  { colour: "Blue", damageType: "cold" },
  { colour: "Indigo" },
  { colour: "Violet" }
] as const;
type Ray = (typeof RAYS)[number];

const withoutDuration = <T extends { duration?: unknown }>(effect: T): Omit<T, "duration"> => {
  const { duration: _lasting, ...rest } = effect;
  return rest;
};

/** "12d6 ... damage on a failed save or half as much damage on a successful one", rolled once for the cast. */
const RAY_DAMAGE = "12d6";

/** The rays the d8 gives one creature: one, or two for an 8, each of those rerolling an 8. */
function raysFor(ctx: ResolveContext, target: LiveTarget): Ray[] {
  const roll = (label: string) => {
    const rolled = resolveDice(parseDiceFormula("1d8"), ctx.deps.random);
    recordRoll(ctx, rolled, "manual", label.slice(0, 80));
    return rolled.total;
  };
  const first = roll(`Prismatic Spray ray for ${target.name}`);
  if (first < 8) return [RAYS[first - 1]!];
  const twice: Ray[] = [];
  while (twice.length < 2) {
    const again = roll(`Prismatic Spray second ray for ${target.name}`);
    if (again < 8) twice.push(RAYS[again - 1]!);
  }
  return twice;
}

/**
 * SRD Prismatic Spray: "Roll 1d8 for each target to determine which color ray affects it." 1-5 deal 12d6 Fire, Acid,
 * Lightning, Poison or Cold, half on a success; 6 (Indigo) Restrains on a failure, with a Constitution save at the end
 * of each of its turns until three successes end it or three failures Petrify it; 7 (Violet) Blinds on a failure until
 * the start of the caster's next turn, when a Wisdom save ends it or sends the creature off the map to another plane; 8
 * strikes with two rays. Each ray is a save of its own. Returns true when it handled the cast.
 */
export function prismaticSpray(ctx: ResolveContext, saving: readonly LiveTarget[]): boolean {
  const { state, action, attacker, deps } = ctx;
  const save = action.save;
  if (action.spellId !== "prismatic-spray" || !save) return false;
  const rolled = resolveDice(parseDiceFormula(RAY_DAMAGE), deps.random);
  recordRoll(ctx, rolled, "damage", "Prismatic Spray");
  const cast = spellCastOf(ctx);
  const effectFor = (conditionId: "restrained" | "blinded") =>
    failureEffectFor(
      { ...ctx, action: { ...action, save: { ...save, failureConditions: [conditionId] } } },
      [conditionId],
      cast
    );
  for (const target of saving) {
    for (const ray of raysFor(ctx, target)) {
      const named = `${action.name} (${ray.colour} ray)`;
      const base = {
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        actionName: named,
        ability: save.ability,
        dc: save.dc,
        targetIds: [target.id],
        replaceExisting: false,
        magical: isMagicalAction(ctx),
        newSaveId: deps.newRollId,
        createdAt: Date.parse(deps.now())
      };
      if ("damageType" in ray) {
        createPendingSaves(state, {
          ...base,
          proposedDamage: rolled.total,
          proposedDamageParts: [{ amount: rolled.total, type: ray.damageType }],
          halfOnSuccess: true,
          conditionIds: []
        });
        continue;
      }
      const conditionId = ray.colour === "Indigo" ? "restrained" : "blinded";
      const effect = effectFor(conditionId);
      if (!effect) continue;
      const name = `${conditionLabel(conditionId)} by ${attacker.name} (${named})`.slice(0, 120);
      createPendingSaves(state, {
        ...base,
        proposedDamage: 0,
        halfOnSuccess: false,
        conditionIds: [conditionId],
        onFailEffect:
          ray.colour === "Indigo"
            ? {
                // No duration: it lasts until the tally ends it. "Makes a Constitution saving throw at the end of each
                // of its turns. If it successfully saves three times, the condition ends. If it fails three times, it
                // has the Petrified condition until it is freed by an effect like the Greater Restoration spell."
                ...withoutDuration(effect),
                name,
                repeatSave: {
                  ability: "con",
                  dc: save.dc,
                  tally: { needed: 3, successes: 0, failures: 0 },
                  next: {
                    name: `Petrified by ${attacker.name} (${named})`.slice(0, 120),
                    linkedConditionIds: ["petrified"]
                  }
                }
              }
            : {
                // "The target has the Blinded condition and makes a Wisdom saving throw at the start of your next turn.
                // On a successful save, the condition ends. On a failed save, the condition ends, and the creature
                // teleports to another plane": off the map until the GM brings it back (off-plane.ts).
                ...withoutDuration(effect),
                name,
                repeatSave: {
                  ability: "wis",
                  dc: save.dc,
                  timing: "source-turn-start",
                  once: true,
                  next: {
                    name: `Sent to another plane by ${attacker.name} (${named})`.slice(0, 120),
                    linkedConditionIds: [],
                    tags: [OFF_PLANE_TAG]
                  }
                }
              }
      });
    }
  }
  return true;
}

/** SRD Prismatic Wall's layers, Red to Violet, in the order a creature passes them. */
const LAYERS = RAYS;

type WallState = Parameters<typeof createPendingSaves>[0];

/**
 * SRD Prismatic Wall: "When a creature reaches into or passes through the wall, it does so one layer at a time through
 * all the layers. Each layer forces the creature to make a Dexterity saving throw or be affected by that layer's
 * properties." Red to Blue deal 12d6 Fire, Acid, Lightning, Poison and Cold, half on a success; Indigo Restrains, with
 * the Constitution tally Prismatic Spray's ray has; Violet Blinds, with the Wisdom save at the start of the caster's
 * next turn that sends the creature to another plane. Each layer is a save of its own, owed at once.
 */
export function prismaticWallLayers(
  state: WallState,
  input: Readonly<{
    zone: Pick<SpellZone, "id" | "dc" | "name">;
    caster: Pick<Actor, "id" | "name">;
    creature: Pick<Actor, "id" | "name">;
    random: RandomSource;
    newId: () => string;
    now: () => string;
  }>
): EffectNarration[] {
  const { zone, caster, creature } = input;
  for (const layer of LAYERS) {
    const named = `${zone.name} (${layer.colour} layer)`;
    const base = {
      sourceActorId: caster.id,
      sourceName: caster.name,
      actionName: named,
      ability: "dex" as const,
      dc: zone.dc,
      targetIds: [creature.id],
      replaceExisting: false,
      magical: true,
      extra: { zoneId: zone.id },
      newSaveId: input.newId,
      createdAt: Date.parse(input.now())
    };
    if ("damageType" in layer) {
      const rolled = Math.max(0, resolveDice(parseDiceFormula(RAY_DAMAGE), input.random).total);
      createPendingSaves(state, {
        ...base,
        proposedDamage: rolled,
        proposedDamageParts: [{ amount: rolled, type: layer.damageType }],
        halfOnSuccess: true,
        conditionIds: []
      });
      continue;
    }
    const conditionId = layer.colour === "Indigo" ? "restrained" : "blinded";
    const effect: NonNullable<PendingSave["onFailEffect"]> = {
      name: `${conditionLabel(conditionId)} by ${caster.name} (${named})`.slice(0, 120),
      tags: [],
      linkedConditionIds: [conditionId],
      escapeDc: null,
      sourceActorId: caster.id,
      sourceName: caster.name,
      modifiers: [],
      repeatSave:
        layer.colour === "Indigo"
          ? {
              ability: "con",
              dc: zone.dc,
              tally: { needed: 3, successes: 0, failures: 0 },
              next: { name: `Petrified by ${caster.name} (${named})`.slice(0, 120), linkedConditionIds: ["petrified"] }
            }
          : {
              ability: "wis",
              dc: zone.dc,
              timing: "source-turn-start",
              once: true,
              next: {
                name: `Sent to another plane by ${caster.name} (${named})`.slice(0, 120),
                linkedConditionIds: [],
                tags: [OFF_PLANE_TAG]
              }
            }
    };
    createPendingSaves(state, {
      ...base,
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [conditionId],
      onFailEffect: effect
    });
  }
  return [
    {
      kind: "effect",
      text: `${creature.name} passes into ${zone.name} and makes a Dexterity save (DC ${zone.dc}) for each of its seven layers.`,
      actorId: creature.id
    }
  ];
}
