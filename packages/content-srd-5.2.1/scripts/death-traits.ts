/**
 * The stat block traits that cheat death or come apart as they take damage, read once from the SRD 5.2.1 printings when
 * the bundle is built (`ActorDefinition.traitMechanics`): Misty Escape, the Restoration traits, Multiple Heads and
 * Loathsome Limbs, and the actions whose failed save kills by the target's Hit Points. The server runs them
 * (`apps/server/src/death-traits.ts`, `fatal-saves.ts`).
 */
import {
  DamageTypeSchema,
  type ActorAction,
  type DamageType,
  type HitPointBand,
  type TraitMechanic
} from "@vtt/schemas";

type Trait = Readonly<{ name: string; description: string }>;
type DeathAction = Readonly<{
  failureByHitPoints?: HitPointBand[];
  damage?: Array<{ formula: string; type: DamageType }>;
  raisesCorpse?: NonNullable<ActorAction["raisesCorpse"]>;
  targets?: NonNullable<ActorAction["targets"]>;
}>;

/** Stat block actions that kill or raise the dead, keyed `<creature>/<action>`: a save whose failure acts by the
 *  target's Hit Points, with the printed damage for a target above the band, and a corpse raised as a new creature. */
const MONSTER_DEATH_ACTIONS: Readonly<Record<string, DeathAction>> = {
  // "Failure: If the target has 20 Hit Points or fewer, it drops to 0 Hit Points. Otherwise, the target takes 13 (3d8)
  // Psychic damage."
  "sea-hag/death-glare": {
    failureByHitPoints: [{ atOrBelow: 20, dropsToZero: true }],
    damage: [{ formula: "3d8", type: "psychic" }]
  },
  // "Failure: If the creature has 100 Hit Points or fewer, it dies. It otherwise takes 24 (4d8 + 6) Piercing damage
  // plus 36 (8d8) Radiant damage."
  "solar/slaying-bow": {
    failureByHitPoints: [{ atOrBelow: 100, dies: true }],
    damage: [
      { formula: "4d8 + 6", type: "piercing" },
      { formula: "8d8", type: "radiant" }
    ]
  },
  // "The wraith targets a Humanoid corpse within 10 feet of itself that has been dead for no longer than 1 minute. The
  // target's spirit rises as a Specter in the space of its corpse ... The wraith can have no more than seven specters
  // under its control at a time."
  "wraith/create-specter": {
    raisesCorpse: { monsterId: "specter", withinMinutes: 1, most: 7 },
    targets: { count: 1, rangeFeet: 10, creatureTypes: ["humanoid"] }
  }
};

/** The death fields of one stat block action. */
export function monsterDeathFor(creature: string, actionId: string): DeathAction {
  return structuredClone(MONSTER_DEATH_ACTIONS[`${creature}/${actionId}`] ?? {});
}

/** The reviewed keys, so a test can check each still names a real action. */
export const MONSTER_DEATH_KEYS: readonly string[] = Object.keys(MONSTER_DEATH_ACTIONS);

const NUMBER_WORDS: Readonly<Record<string, number>> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const slugOf = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** "If the vampire drops to 0 Hit Points outside its resting place, the vampire uses Shape-Shift to become mist". */
function mistyEscape(trait: Trait): TraitMechanic | null {
  return /\bdrops to 0 Hit Points outside its resting place, the [\w -]+? uses Shape-Shift to become mist\b/.test(
    trait.description
  )
    ? { kind: "misty-escape", name: trait.name }
    : null;
}

/** "If the devil dies outside the Nine Hells, its body disappears in sulfurous smoke, and it gains a new body
 *  instantly", "If destroyed, the lich reforms in 1d10 days", "it returns to life in 1d6 days". */
function restoration(trait: Trait): TraitMechanic | null {
  const returns =
    /^If (?:destroyed|(?:the [\w -]+?|it) dies)\b[^.]*?\b(?:gains a new body|reforms|returns to life|revives with all its Hit Points)\b/.test(
      trait.description
    );
  if (!returns) return null;
  const bodyGoes = /\bits body (?:disappears|dissolves|turns to)\b/.test(trait.description);
  return { kind: "restoration", name: trait.name, ...(bodyGoes ? { bodyGoes: true as const } : {}) };
}

/** "The hydra has five heads. Whenever the hydra takes 25 damage or more on a single turn, one of its heads dies. ...
 *  unless it has taken Fire damage since its last turn. The hydra regains 20 Hit Points when it grows new heads." */
function multipleHeads(trait: Trait): Extract<TraitMechanic, { kind: "multiple-heads" }> | null {
  const text = trait.description;
  const heads =
    /\bhas (\w+) heads\. Whenever the [\w -]+? takes (\d+) damage or more on a single turn, one of its heads dies\b/.exec(
      text
    );
  if (!heads || NUMBER_WORDS[heads[1]!.toLowerCase()] === undefined) return null;
  const stopped = /\bunless it has taken ([A-Z][a-z]+) damage since its last turn\b/.exec(text);
  const type = stopped ? DamageTypeSchema.safeParse(stopped[1]!.toLowerCase()) : null;
  const regains = /\bregains (\d+) Hit Points when it grows new heads\b/.exec(text);
  return {
    kind: "multiple-heads",
    name: trait.name,
    heads: NUMBER_WORDS[heads[1]!.toLowerCase()]!,
    damagePerHead: Number(heads[2]),
    regrowHitPoints: regains ? Number(regains[1]) : 0,
    stoppedBy: type?.success ? [type.data as DamageType] : []
  };
}

/** "If the troll ends any turn Bloodied and took 15+ Slashing damage during that turn, one of the troll's limbs is
 *  severed, falls into the troll's space, and becomes a Troll Limb." Its uses are the name's "(4/Day)". */
function severedLimbs(trait: Trait): TraitMechanic | null {
  const severed =
    /\bends any turn Bloodied and took (\d+)\+ Slashing damage during that turn, one of the [\w -]+?'s limbs is severed, falls into the [\w -]+?'s space, and becomes an? ([A-Z][\w ]+?)\./.exec(
      trait.description
    );
  if (!severed) return null;
  const perDay = /\((\d+)\/Day\)/.exec(trait.name);
  return {
    kind: "severed-limbs",
    name: trait.name.replace(/\s*\(\d+\/Day\)\s*$/, ""),
    uses: perDay ? Number(perDay[1]) : 1,
    slashing: Number(severed[1]),
    limbMonsterId: slugOf(severed[2]!)
  };
}

/** The death-cheating traits a stat block's traits print, with what its actions say of them: the Multiattack that
 *  makes "as many Bite attacks as it has heads", and Reactive Heads. */
export function deathTraitMechanicsOf(traits: readonly Trait[], actions: readonly ActorAction[]): TraitMechanic[] {
  const reactiveHeads = traits.some((trait) =>
    /\bFor each head the [\w -]+? has beyond one, it gets an extra Reaction that can be used only for Opportunity Attacks\b/.test(
      trait.description
    )
  );
  const perHead = actions
    .map((action) => /\bmakes as many ([A-Z][\w ]+?) attacks as it has heads\b/.exec(action.description)?.[1])
    .find((name) => name !== undefined);
  const attackId = perHead ? actions.find((action) => action.name.trim() === perHead)?.id : undefined;
  return traits.flatMap((trait) => {
    const heads = multipleHeads(trait);
    if (heads)
      return [
        {
          ...heads,
          ...(attackId ? { attackId } : {}),
          ...(reactiveHeads ? { reactiveHeads: true as const } : {})
        }
      ];
    const other = mistyEscape(trait) ?? restoration(trait) ?? severedLimbs(trait);
    return other ? [other] : [];
  });
}
