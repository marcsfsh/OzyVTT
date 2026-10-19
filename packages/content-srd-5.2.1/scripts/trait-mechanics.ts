/**
 * What a stat block's traits do that play needs as data (`ActorDefinition.traitMechanics`), read once from the SRD
 * 5.2.1 printings when the bundle is built, so the engine never reads trait prose. A trait whose text doesn't match
 * one of these printings stays prose on the sheet.
 */
import {
  AbilitySchema,
  DamageTypeSchema,
  SaveConditionSchema,
  type AbilityId,
  type DamageType,
  type TraitMechanic
} from "@vtt/schemas";

type Trait = Readonly<{ name: string; description: string }>;

const ABILITY_NAMES: Readonly<Record<string, AbilityId>> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha"
};
const abilityOf = (word: string): AbilityId | null => {
  const parsed = AbilitySchema.safeParse(ABILITY_NAMES[word.toLowerCase()]);
  return parsed.success ? parsed.data : null;
};
const damageTypeOf = (word: string): DamageType | null => {
  const parsed = DamageTypeSchema.safeParse(word.toLowerCase());
  return parsed.success ? parsed.data : null;
};

const DICE = String.raw`\d+ \((\d+d\d+(?: [+-] \d+)?)\) ([A-Z][a-z]+) damage`;
type TraitDamage = Extract<TraitMechanic, { kind: "death-burst" }>["damage"];

/** "5 (2d4) Bludgeoning damage", optionally "plus 31 (9d6) Force damage"; undefined when the text prints none. */
function typedDamage(text: string): TraitDamage | undefined {
  const match = new RegExp(`${DICE}(?: plus ${DICE})?`).exec(text);
  if (!match) return undefined;
  const parts = [
    [match[1], match[2]],
    [match[3], match[4]]
  ].flatMap(([formula, type]) => {
    const damageType = type ? damageTypeOf(type) : null;
    return formula && damageType ? [{ formula, type: damageType }] : [];
  });
  return parts.length > 0 ? (parts as TraitDamage) : undefined;
}

/** "The troll regains 15 Hit Points at the start of each of its turns. If the troll takes Acid or Fire damage, this
 *  trait doesn't function on the troll's next turn. The troll dies only if it starts its turn with 0 Hit Points and
 *  doesn't regenerate." / "... at the start of each of its turns if it has at least 1 Hit Point." */
function regeneration(trait: Trait): TraitMechanic | null {
  const regains = /\bregains (\d+) Hit Points at the start of each of its turns( if it has at least 1 Hit Point)?/.exec(
    trait.description
  );
  if (!regains) return null;
  const stopped =
    /\bIf the [\w -]+? takes ([A-Z][a-z]+(?:(?:, | or |, or )[A-Z][a-z]+)*) damage, this trait doesn't function on the [\w -]+?'s next turn/.exec(
      trait.description
    );
  const stoppedBy = stopped
    ? stopped[1]!.split(/, or |, | or /).flatMap((word) => {
        const type = damageTypeOf(word);
        return type ? [type] : [];
      })
    : [];
  return {
    kind: "regeneration",
    name: trait.name,
    hitPoints: Number(regains[1]),
    ...(stoppedBy.length > 0 ? { stoppedBy } : {}),
    ...(regains[2] ? { needsHitPoints: true as const } : {}),
    ...(/\bdies only if it starts its turn with 0 Hit Points and doesn't regenerate\b/.test(trait.description)
      ? { deathWaitsForTurn: true as const }
      : {})
  };
}

/** "If damage reduces the zombie to 0 Hit Points, it makes a Constitution saving throw (DC 5 plus the damage taken)
 *  unless the damage is Radiant or from a Critical Hit. On a successful save, the zombie drops to 1 Hit Point instead." */
function undeadFortitude(trait: Trait): TraitMechanic | null {
  const match =
    /\bIf damage reduces the [\w -]+? to 0 Hit Points, it makes an? ([A-Z][a-z]+) saving throw \(DC (\d+) plus the damage taken\) unless the damage is ([A-Z][a-z]+)( or from a Critical Hit)?\. On a successful save, the [\w -]+? drops to 1 Hit Point instead\b/.exec(
      trait.description
    );
  const ability = match ? abilityOf(match[1]!) : null;
  const except = match ? damageTypeOf(match[3]!) : null;
  if (!match || !ability || !except) return null;
  return {
    kind: "undead-fortitude",
    name: trait.name,
    ability,
    dcBase: Number(match[2]),
    exceptDamageTypes: [except],
    ...(match[4] ? { exceptCritical: true as const } : {})
  };
}

const NOT_WHILE_INCAPACITATED =
  /\bwhile it doesn't have the Incapacitated condition\b|\bunless the [\w -]+? has the Incapacitated condition\b/;

/** "At the end of each of the balor's turns, each creature [of the azer's choice] in a 5-foot Emanation originating
 *  from the balor takes 13 (3d8) Fire damage [unless the azer has the Incapacitated condition]." A fire elemental's
 *  also sets what is in it burning. */
function turnEndAura(trait: Trait): TraitMechanic | null {
  const match =
    /^At the end of each of the [\w' -]+? turns, each creature( of the [\w' -]+? choice)? in a (\d+)-foot Emanation originating from the [\w -]+? takes /.exec(
      trait.description
    );
  const damage = match ? typedDamage(trait.description.slice(match[0].length)) : undefined;
  if (!match || !damage) return null;
  return {
    kind: "aura",
    name: trait.name,
    trigger: "bearer-turn-end",
    rangeFeet: Number(match[2]),
    affects: match[1] ? "chosen" : "all",
    ...(NOT_WHILE_INCAPACITATED.test(trait.description) ? { notWhileIncapacitated: true as const } : {}),
    damage,
    ...(/\bin the Emanation start\b.*\bburning\b/.test(trait.description) ? { hazard: "burning" as const } : {})
  };
}

/** "While underwater, the aboleth is surrounded by mucus. Constitution Saving Throw: DC 14, each creature in a 5-foot
 *  Emanation originating from the aboleth at the end of the aboleth's turn. Failure: The target is cursed. Until the
 *  curse ends, the target's skin becomes slimy, the target can breathe air and water, and it can't regain Hit Points
 *  unless it is underwater." Its acid every 10 minutes out of water is downtime, the GM's. */
function turnEndSaveAura(trait: Trait): TraitMechanic | null {
  const match =
    /^While underwater, the [\w -]+? is surrounded by mucus\. ([A-Z][a-z]+) Saving Throw: DC (\d+), each creature in a (\d+)-foot Emanation originating from the [\w -]+? at the end of the [\w' -]+? turn\. Failure: The target is cursed\./.exec(
      trait.description
    );
  const ability = match ? abilityOf(match[1]!) : null;
  if (!match || !ability) return null;
  return {
    kind: "aura",
    name: trait.name,
    trigger: "bearer-turn-end",
    rangeFeet: Number(match[3]),
    affects: "all",
    underwaterOnly: true,
    save: {
      ability,
      dc: Number(match[2]),
      successDamage: "none",
      failureConditions: [],
      failureEffect: {
        name: "Cursed (slimy skin)",
        tags: ["curse", "water-breathing", "no-healing-on-land"],
        modifiers: []
      }
    },
    reminder:
      "Out of water, the cursed creature takes 6 (1d12) Acid damage at the end of every 10 minutes unless moisture is applied to its skin."
  };
}

/** "Constitution Saving Throw: DC 10, any creature that starts its turn in a 5-foot Emanation originating from the
 *  ghast. Failure: The target has the Poisoned condition until the start of its next turn. Success: The target is
 *  immune to this ghast's Stench for 24 hours." A pit fiend's names "any enemy ... in the aura" of a 20-foot
 *  Emanation; a gibbering mouther's "within 20 feet", its failure a d8 table the server rolls; a sea hag's "any Beast or
 *  Humanoid that starts its turn within 30 feet of the hag and can see the hag's true form", whose sight the GM
 *  judges. */
function turnStartAura(trait: Trait): TraitMechanic | null {
  const text = trait.description;
  const match =
    /\b([A-Z][a-z]+) Saving Throw: DC (\d+), any (creature|enemy|[A-Z][a-z]+(?:,? (?:or )?[A-Z][a-z]+)*) that starts its turn (?:in a (\d+)-foot Emanation originating from the [\w -]+?|in the aura|within (\d+) feet of the [\w -]+?)(?: (?:while|and) [^.]+)?\. Failure: ([^]*?)(?: Success: ([^]*))?$/.exec(
      text
    );
  if (!match) return null;
  const creatureTypes =
    match[3] === "creature" || match[3] === "enemy"
      ? []
      : match[3]!.split(/,? or |, /).map((word) => word.toLowerCase());
  const ability = abilityOf(match[1]!);
  const rangeFeet = Number(match[4] ?? match[5] ?? /\bin a (\d+)-foot Emanation\b/.exec(text)?.[1] ?? NaN);
  if (!ability || !Number.isFinite(rangeFeet)) return null;
  const failure = match[6]!.trim();
  const imposed = /^The target has the ([A-Z][a-z]+) condition until the start of its next turn\.$/.exec(failure);
  const condition = imposed ? SaveConditionSchema.safeParse(imposed[1]!.toLowerCase()) : null;
  const conditionId = condition?.success ? condition.data : null;
  return {
    kind: "aura",
    name: trait.name,
    trigger: "turn-start-inside",
    rangeFeet,
    affects: match[3] === "enemy" ? "enemies" : "all",
    ...(creatureTypes.length > 0 ? { creatureTypes } : {}),
    ...(NOT_WHILE_INCAPACITATED.test(text) ? { notWhileIncapacitated: true as const } : {}),
    // "... and can see the hag's true form": only a creature that sees the bearer makes the save.
    ...(/\bthat starts its turn [^.]*\band can see the\b/.test(text) ? { seenOnly: true as const } : {}),
    save: {
      ability,
      dc: Number(match[2]),
      successDamage: "none",
      failureConditions: conditionId ? [conditionId] : [],
      ...(conditionId ? { failureDuration: { type: "until-bearer-next-turn" as const } } : {}),
      ...(match[7] && /^The target is immune to this\b/.test(match[7]) ? { immuneOnSuccess: true as const } : {})
    },
    // A gibbering mouther's "rolls 1d8 to determine what it does during the current turn" is a table the server rolls.
    ...(conditionId
      ? {}
      : /^The target rolls 1d8 to determine what it does during the current turn:/.test(failure)
        ? { failureTable: "gibbering" as const }
        : { reminder: `On a failed save: ${failure}`.slice(0, 600) })
  };
}

/** "At the start of each of its turns, the devil deals 5 (1d10) Piercing damage to any creature it is grappling or
 *  any creature grappling it." */
function grappleTurnStart(trait: Trait): TraitMechanic | null {
  const match =
    /^At the start of each of its turns, the [\w -]+? deals (.+?) to any creature it is grappling or any creature grappling it\.$/.exec(
      trait.description
    );
  const damage = match ? typedDamage(match[1]!) : undefined;
  if (!match || !damage) return null;
  return {
    kind: "aura",
    name: trait.name,
    trigger: "bearer-turn-start",
    rangeFeet: 5,
    affects: "grapple-partners",
    damage
  };
}

/** "The mephit explodes when it dies. Dexterity Saving Throw: DC 10, each creature in a 5-foot Emanation originating
 *  from the mephit. Failure: 5 (2d4) Bludgeoning damage. Success: Half damage." (Death Burst, a balor's Death
 *  Throes.) */
function deathBurst(trait: Trait): TraitMechanic | null {
  const match =
    /\bexplodes when it dies\. ([A-Z][a-z]+) Saving Throw: DC (\d+), each creature in a (\d+)-foot Emanation originating from the [\w -]+?\. Failure: (.+?)\. Success: (Half damage|No damage)\b/.exec(
      trait.description
    );
  const ability = match ? abilityOf(match[1]!) : null;
  const damage = match ? typedDamage(match[4]!) : undefined;
  if (!match || !ability || !damage) return null;
  return {
    kind: "death-burst",
    name: trait.name,
    rangeFeet: Number(match[3]),
    save: {
      ability,
      dc: Number(match[2]),
      successDamage: match[5] === "Half damage" ? "half" : "none",
      failureConditions: []
    },
    damage
  };
}

/** "A creature that hits the pudding with a melee attack roll takes 4 (1d8) Acid damage." */
function meleeHitDamage(trait: Trait): TraitMechanic | null {
  const match =
    /^A creature that hits the [\w -]+? with a melee attack roll takes (\d+ \([^)]+\) [A-Z][a-z]+ damage)\./.exec(
      trait.description
    );
  const damage = match ? typedDamage(match[1]!) : undefined;
  return match && damage ? { kind: "melee-hit-damage", name: trait.name, damage } : null;
}

/** "Whenever the golem starts its turn Bloodied, roll 1d6. On a 6, the golem goes berserk." A flesh golem's "creator,
 *  if within 60 feet of the berserk golem, can try to calm it by taking an action to make a DC 15 Charisma (Persuasion)
 *  check". */
function berserk(trait: Trait): TraitMechanic | null {
  const match =
    /^Whenever the [\w -]+? starts its turn Bloodied, roll 1d6\. On a (\d), the [\w -]+? goes berserk\./.exec(
      trait.description
    );
  const calm =
    /\bif within (\d+) feet of the berserk [\w -]+?, can try to calm it by taking an action to make a DC (\d+) Charisma \(Persuasion\) check\b/.exec(
      trait.description
    );
  return match
    ? {
        kind: "berserk",
        name: trait.name,
        on: Number(match[1]),
        ...(calm ? { calm: { dc: Number(calm[2]), withinFeet: Number(calm[1]) } } : {})
      }
    : null;
}

/** "The elemental sheds Bright Light in a 30-foot radius and Dim Light for an additional 30 feet." */
function illumination(trait: Trait): TraitMechanic | null {
  const match =
    /^The [\w' -]+? sheds Bright Light in a (\d+)-foot radius and Dim Light for an additional (\d+) feet\.$/.exec(
      trait.description
    );
  return match ? { kind: "light", name: trait.name, brightFeet: Number(match[1]), dimFeet: Number(match[2]) } : null;
}

const ROLLS_BY_WORD: Readonly<Record<string, ReadonlyArray<"attack" | "check" | "save">>> = {
  "ability checks and attack rolls": ["check", "attack"],
  "attack rolls and ability checks": ["attack", "check"],
  "attack rolls": ["attack"],
  // A D20 Test is an attack roll, an ability check or a saving throw.
  "D20 Test": ["attack", "check", "save"],
  "D20 Tests": ["attack", "check", "save"]
};

/** "While in sunlight, the drider has Disadvantage on ability checks and attack rolls." / "While in Bright Light, the
 *  cloaker has Disadvantage on attack rolls." / a vampire's "**Sunlight:** The vampire takes 20 Radiant damage if it
 *  starts its turn in sunlight. While in sunlight, it has Disadvantage on attack rolls and ability checks." */
function lightSensitivity(trait: Trait): TraitMechanic | null {
  const match = /While in (sunlight|Bright Light), (?:the [\w' -]+?|it) has Disadvantage on ([A-Za-z0-9 ]+?)\./.exec(
    trait.description
  );
  const rolls = match ? ROLLS_BY_WORD[match[2]!] : undefined;
  if (!match || !rolls) return null;
  const burns = /takes (\d+) ([A-Z][a-z]+) damage if it starts its turn in sunlight/.exec(trait.description);
  const type = burns ? damageTypeOf(burns[2]!) : null;
  return {
    kind: "light-sensitivity",
    name: trait.name,
    light: match[1] === "sunlight" ? "sunlight" : "bright",
    rolls: [...rolls],
    ...(burns && type ? { damageAtTurnStart: { amount: Number(burns[1]), type } } : {})
  };
}

/** "The stalker has the Invisible condition." */
function alwaysInvisible(trait: Trait): TraitMechanic | null {
  return /^The [\w' -]+? has the Invisible condition\.$/.test(trait.description)
    ? { kind: "invisible", name: trait.name }
    : null;
}

/** "Whenever the golem is subjected to Acid damage, it (takes no damage and instead) regains a number of Hit Points
 *  equal to the Acid damage dealt." */
function absorption(trait: Trait): TraitMechanic | null {
  const match =
    /^Whenever the [\w' -]+? is subjected to ([A-Z][a-z]+) damage, it (?:takes no damage and instead )?regains a number of Hit Points equal to the \1 damage dealt\.$/.exec(
      trait.description
    );
  return match ? { kind: "absorbs", name: trait.name, damageType: match[1]!.toLowerCase() as never } : null;
}

/** "If the golem takes Fire damage, it has Disadvantage on attack rolls and ability checks until the end of its next
 *  turn", "If the elemental takes Cold damage, its Speed decreases by 20 feet until the end of its next turn." */
function damageWeakens(trait: Trait): TraitMechanic | null {
  const match =
    /^If the [\w' -]+? takes ([A-Z][a-z]+) damage, (?:it has (Disadvantage) on attack rolls and ability checks|its Speed decreases by (\d+) feet) until the end of its next turn\.$/.exec(
      trait.description
    );
  if (!match) return null;
  const modifiers = match[2]
    ? [
        {
          type: "roll-mode" as const,
          roll: "attack" as const,
          mode: "disadvantage" as const,
          when: [{ type: "on-attack-roll" as const }]
        },
        {
          type: "roll-mode" as const,
          roll: "check" as const,
          mode: "disadvantage" as const,
          when: [{ type: "on-ability-check" as const }]
        }
      ]
    : [{ type: "speed" as const, amount: -Number(match[3]) }];
  return { kind: "damage-weakens", name: trait.name, damageType: match[1]!.toLowerCase() as never, modifiers };
}

/** "Attack rolls against the mephit are made with Disadvantage unless the mephit has the Incapacitated condition." */
function blurredForm(trait: Trait): TraitMechanic | null {
  return /^Attack rolls against the [\w' -]+? are made with Disadvantage unless the [\w' -]+? has the Incapacitated condition\.$/.test(
    trait.description
  )
    ? { kind: "blurred", name: trait.name }
    : null;
}

/** "Other creatures can enter that space, but a creature that does so is subjected to the cube's Engulf and has
 *  Disadvantage on the saving throw." */
function engulfsEntrants(trait: Trait): TraitMechanic | null {
  const match =
    /\bOther creatures can enter that space, but a creature that does so is subjected to the [\w -]+?[\u2019']s ([A-Z][\w ]*?) and has Disadvantage on the saving throw\b/.exec(
      trait.description
    );
  return match
    ? { kind: "engulfs-entrants", name: trait.name, actionId: match[1]!.toLowerCase().replace(/[^a-z0-9]+/g, "-") }
    : null;
}

/** "A spellcaster who wears the guardian's amulet can cause the guardian to store one spell of level 4 or lower." */
function spellStoring(trait: Trait): TraitMechanic | null {
  const match = /\bcan cause the [\w -]+? to store one spell of level (\d) or lower\b/.exec(trait.description);
  return match ? { kind: "spell-storing", name: trait.name, maxLevel: Number(match[1]) } : null;
}

const READERS: ReadonlyArray<(trait: Trait) => TraitMechanic | null> = [
  spellStoring,
  regeneration,
  undeadFortitude,
  turnEndAura,
  turnEndSaveAura,
  turnStartAura,
  grappleTurnStart,
  deathBurst,
  meleeHitDamage,
  berserk,
  illumination,
  lightSensitivity,
  alwaysInvisible,
  absorption,
  damageWeakens,
  blurredForm,
  engulfsEntrants
];

/** Every trait the engine can run, in the stat block's order; the rest stay prose. */
export function traitMechanicsOf(traits: readonly Trait[]): TraitMechanic[] {
  return traits.flatMap((trait) => {
    for (const read of READERS) {
      const mechanic = read(trait);
      if (mechanic) return [mechanic];
    }
    return [];
  });
}
