import type { DefinitionAction } from "./context.js";

/**
 * The features and spells that ride a hit: chosen on the attack's preview, their dice join the hit's. Kept apart
 * from `hit-options.ts` so the economy can tell them without importing the resolver step.
 */

/** What makes a feature or spell ride a hit. */
export type HitRider = Readonly<{
  /** The hits it can ride: a Finesse or Ranged weapon (Sneak Attack), a Melee weapon or an Unarmed Strike (the
   *  smites), or any weapon (Divine Strike, Primal Strike). */
  rides: "finesse-or-ranged-weapon" | "melee-weapon-or-unarmed" | "weapon";
  /** Sneak Attack's test: Advantage on the roll, or an ally within 5 feet of the target who isn't Incapacitated
   *  and no Disadvantage. */
  sneakAttack?: true;
  /** "The extra damage's type is the same as the weapon's type." */
  weaponType?: true;
  /** The types to pick from when it is chosen. */
  damageTypes?: readonly string[];
  /** More dice against these creature types (Divine Smite: +1d8 against a Fiend or an Undead). */
  versus?: Readonly<{ creatureTypes: readonly string[]; formula: string }>;
  /** "Once on each of your turns", or a Bonus Action: never on someone else's turn. */
  ownTurn?: true;
  /** A lasting effect on the target (Shining Smite), held by the attacker's concentration: the light it sheds, and
   *  `outlined` when it can't benefit from the Invisible condition. */
  marks?: Readonly<{
    name: string;
    tag: string;
    rounds: number;
    light?: Readonly<{ brightFeet: number; dimFeet: number }>;
    outlined?: true;
  }>;
  /** A lasting effect on the target that deals the rider's dice again at the start of each of its turns and then
   *  asks for the spell's save, a success ending it (Searing Smite). */
  lingers?: Readonly<{ name: string; rounds: number }>;
  /** What the table finishes by hand. */
  reminder?: string;
}>;

/** Keyed by the feature action's id, and by the spell a spell action casts, so sheets built before this table
 *  still get them. */
const BY_ACTION_ID: Readonly<Record<string, HitRider>> = {
  "sneak-attack": { rides: "finesse-or-ranged-weapon", sneakAttack: true, weaponType: true },
  "divine-strike": { rides: "weapon", damageTypes: ["radiant", "necrotic"], ownTurn: true },
  "primal-strike": { rides: "weapon", damageTypes: ["lightning", "cold", "fire", "thunder"], ownTurn: true }
};
const BY_SPELL_ID: Readonly<Record<string, HitRider>> = {
  "divine-smite": {
    rides: "melee-weapon-or-unarmed",
    versus: { creatureTypes: ["fiend", "undead"], formula: "1d8" },
    ownTurn: true
  },
  "searing-smite": {
    rides: "melee-weapon-or-unarmed",
    ownTurn: true,
    lingers: { name: "Searing Smite", rounds: 10 }
  },
  "shining-smite": {
    rides: "melee-weapon-or-unarmed",
    ownTurn: true,
    // "Until the spell ends, the target sheds Bright Light in a 5-foot radius, attack rolls against it have Advantage,
    // and it can't benefit from the Invisible condition."
    marks: {
      name: "Shining Smite",
      tag: "shining-smite",
      rounds: 10,
      light: { brightFeet: 5, dimFeet: 0 },
      outlined: true
    }
  }
};

/** The hit rider an action is, if any. */
export function hitRiderOf(action: Pick<DefinitionAction, "id" | "spellId">): HitRider | undefined {
  return (action.spellId !== undefined ? BY_SPELL_ID[action.spellId] : undefined) ?? BY_ACTION_ID[action.id];
}
