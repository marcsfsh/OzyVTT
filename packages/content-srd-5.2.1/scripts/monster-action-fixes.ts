/**
 * Reviewed stat-block actions the readers can't finish from the text, keyed `<creature>/<action>`; each says why. What
 * a fix names replaces what was read, so the engine runs it and the GM's reminder says only what is left.
 */
import type { ActorAction, OnHitRider } from "@vtt/schemas";

export type MonsterActionFix = Readonly<{
  why: string;
  /** Save fields merged over the reader's. */
  save?: Partial<NonNullable<ActorAction["save"]>>;
  /** The damage in place of the reader's. */
  damage?: ActorAction["damage"];
  /** The damage types a use picks from (Chromatic Orb's shape). */
  damageTypes?: ActorAction["damageTypes"];
  /** What a hit leaves, in place of the reader's. */
  onHit?: OnHitRider[];
  /** The GM's reminder in place of the reader's; null drops it. */
  reminder?: string | null;
}>;

export const MONSTER_ACTION_FIXES: Readonly<Record<string, MonsterActionFix>> = {
  "half-dragon/dragon-s-breath": {
    why: "the damage is of the type chosen for the Draconic Origin trait, which each use picks",
    damage: [{ formula: "8d6", type: "fire" }],
    damageTypes: ["acid", "cold", "fire", "lightning", "poison"]
  },
  "gelatinous-cube/engulf": {
    why: "the escape and the pull from outside are printed in the action and the Ooze Cube trait",
    save: {
      // "An engulfed target can try to escape by taking an action to make a DC 12 Strength (Athletics) check."
      escapeDc: 12,
      escapeAthletics: true,
      // "Can't cast spells with a Verbal component", and "is suffocating": it holds its breath while engulfed.
      failureEffect: { name: "Engulfed", tags: ["cant-speak", "smothering"], modifiers: [] },
      // "As an action, a creature within 5 feet of the cube can pull a creature ... out of the cube by succeeding on a
      // DC 12 Strength (Athletics) check, and the puller takes 10 (3d6) Acid damage."
      endedBy: {
        name: "Pull free",
        by: "others",
        near: "source",
        check: { ability: "str", skill: "athletics", dc: 12 },
        takerDamage: [{ formula: "3d6", type: "acid" }]
      }
    },
    reminder:
      "The cube moves up to its Speed first; an engulfed creature moves with it and has Total Cover from attacks outside the cube."
  },
  "water-elemental/whelm": {
    why: "a creature outside can pull the whelmed one free, and the whelmed one holds its breath, which the save's text prints",
    save: {
      // "Is suffocating unless it can breathe water" while the grapple lasts.
      failureEffect: { name: "Whelmed", tags: ["smothering"], modifiers: [] },
      // "As an action, a creature within 5 feet of the elemental can pull a creature out of it by succeeding on a DC 14
      // Strength (Athletics) check."
      endedBy: {
        name: "Pull free",
        by: "others",
        near: "source",
        check: { ability: "str", skill: "athletics", dc: 14 }
      }
    }
  },
  "darkmantle/crush": {
    why: "the attachment, and detaching it with an action and an Athletics check, are printed in the hit's text",
    onHit: [
      {
        conditions: [],
        name: "Attached",
        tags: ["attached"],
        endsWhenSourceDies: true,
        // "A creature can take an action to try to detach the darkmantle from itself, doing so with a successful DC 13
        // Strength (Athletics) check."
        endedBy: { name: "Detach the darkmantle", by: "bearer", check: { ability: "str", skill: "athletics", dc: 13 } }
      }
    ],
    reminder:
      "If the target is Medium or smaller and the darkmantle had Advantage on the attack roll, it covers the target, which is Blinded and suffocating (hold its breath) while the darkmantle is attached."
  },
  "otyugh/bite": {
    why: "the save comes after each Long Rest, and its failure lowers the Hit Point maximum until the poison ends",
    onHit: [
      {
        conditions: [{ id: "poisoned" }],
        name: "Poisoned",
        atRest: { at: "long-rest", save: { ability: "con", dc: 15 }, maximumLoss: "1d10" }
      }
    ],
    reminder: null
  },
  "death-dog/bite": {
    why: "the save repeats every 24 hours, and later failures lower the Hit Point maximum, which a Long Rest leaves low",
    save: { atRest: { at: "day", save: { ability: "con", dc: 12 }, maximumLoss: "1d10", holdsMaximum: true } },
    reminder: null
  },
  "mummy/rotting-fist": {
    why: "the curse lowers the Hit Point maximum every 24 hours, which a Long Rest leaves low",
    onHit: [
      {
        conditions: [],
        name: "Cursed",
        tags: ["no-healing", "curse"],
        atRest: { at: "day", maximumLoss: "3d6", holdsMaximum: true }
      }
    ]
  },
  "mummy-lord/rotting-fist": {
    why: "the curse lowers the Hit Point maximum every 24 hours, and the creature gains no benefit from a Long Rest",
    onHit: [
      {
        conditions: [],
        name: "Cursed",
        tags: ["no-healing", "curse"],
        atRest: { at: "day", maximumLoss: "3d6", noBenefit: "long" }
      }
    ]
  },
  "rakshasa/cursed-touch": {
    why: "the curse takes the benefit of every rest, which the reader has no phrase for",
    onHit: [{ conditions: [], name: "Cursed", tags: ["curse"], atRest: { noBenefit: "both" } }]
  },
  "incubus/restless-touch": {
    why: "the curse takes the Short Rest's benefit for 24 hours or until the incubus dies",
    onHit: [
      {
        conditions: [],
        name: "Cursed",
        tags: ["curse"],
        duration: { type: "minutes", minutes: 1440 },
        endsWhenSourceDies: true,
        atRest: { noBenefit: "short" }
      }
    ],
    reminder: null
  },
  "rust-monster/antennae": {
    why: "the penalty is on one carried armor or weapon, which items don't track",
    reminder:
      "On a failure, the armor or weapon the rust monster targeted takes a cumulative -1 penalty: to the AC it offers, or to its attack rolls. Change the item by hand. Armor whose AC falls to 10, or a weapon at -5, is destroyed, and Mending removes the penalty."
  }
};

/** The fields a fix sets on its action. */
export function fixedFields(fix: MonsterActionFix | undefined): Partial<ActorAction> {
  if (!fix) return {};
  return {
    ...(fix.damage ? { damage: fix.damage.map((part) => ({ ...part })) } : {}),
    ...(fix.damageTypes ? { damageTypes: [...fix.damageTypes] } : {}),
    ...(fix.onHit ? { onHit: structuredClone(fix.onHit) } : {}),
    ...(typeof fix.reminder === "string" ? { reminder: fix.reminder } : {})
  };
}
