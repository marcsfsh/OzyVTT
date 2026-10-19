import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { conditionLabel } from "../condition-rules.js";
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
 * the start of the caster's next turn, when a Wisdom save decides whether it is sent to another plane (the GM's); 8
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
            : { ...effect, name, duration: { type: "until-source-next-turn" } },
        ...(ray.colour === "Violet"
          ? {
              extra: {
                failureNote: `At the start of ${attacker.name}'s next turn, ${target.name} makes a DC ${save.dc} Wisdom save. On a failure it is sent to another plane of the GM's choice.`
              }
            }
          : {})
      });
    }
  }
  return true;
}
