import type { HitRider as HitRiderData } from "@vtt/schemas";
import type { DefinitionAction } from "./context.js";

/**
 * The features and spells that ride a hit: chosen on the attack's preview, their dice join the hit's. An action says
 * so itself (`ridesHit`); the tables below cover the spells, whose cast actions are minted from the spell, and sheets
 * built before their feature carried it. Kept apart from `hit-options.ts` so the economy can tell them without
 * importing the resolver step.
 */

/** What makes a feature or spell ride a hit: the action's own data, and what a smite spell does beyond it. */
export type HitRider = HitRiderData &
  Readonly<{
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
  }>;

/** Keyed by the feature action's id, for sheets built before the feature carried its rider. */
const BY_ACTION_ID: Readonly<Record<string, HitRider>> = {
  "sneak-attack": { rides: "finesse-or-ranged-weapon", sneakAttack: true, weaponType: true },
  "divine-strike": { rides: "weapon", damageTypes: ["radiant", "necrotic"], ownTurn: true },
  "primal-strike": { rides: "weapon", damageTypes: ["lightning", "cold", "fire", "thunder"], ownTurn: true },
  "stunning-strike": { rides: "monk-weapon-or-unarmed", oncePerTurn: true },
  "hurl-through-hell": { rides: "attack-roll", oncePerTurn: true, sparesCreatureTypes: ["fiend"] },
  "fires-burn": { rides: "attack-roll", dealsDamage: true },
  "frosts-chill": {
    rides: "attack-roll",
    dealsDamage: true,
    applies: {
      name: "Frost's Chill",
      tags: [],
      modifiers: [{ type: "speed", amount: -10 }],
      duration: { type: "until-source-next-turn" }
    }
  },
  "hills-tumble": {
    rides: "attack-roll",
    dealsDamage: true,
    maxTargetSize: "large",
    applies: { name: "Hill's Tumble", conditions: ["prone"], tags: [], modifiers: [] }
  }
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

/** The hit rider an action is, if any: its own `ridesHit`, else the spell it casts, else its id. */
export function hitRiderOf(action: Pick<DefinitionAction, "id" | "spellId" | "ridesHit">): HitRider | undefined {
  if (action.ridesHit) return action.ridesHit;
  return (action.spellId !== undefined ? BY_SPELL_ID[action.spellId] : undefined) ?? BY_ACTION_ID[action.id];
}

/** A rider tapped before the roll (Brutal Strike) is taken alone and stays on the turn list; its hit is offered once
 *  that roll forgoes its Advantage. */
export const declaredBeforeRoll = (action: Pick<DefinitionAction, "id" | "spellId" | "ridesHit">): boolean =>
  hitRiderOf(action)?.declaredBeforeRoll === true;
