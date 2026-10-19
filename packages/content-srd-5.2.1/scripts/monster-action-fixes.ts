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
      // "If the target is a Large or smaller creature, it has the Grappled condition."
      failureMaxSize: "large",
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
    },
    // The Restrained and the held breath it restated are run.
    reminder: null
  },
  "darkmantle/crush": {
    why: "the attachment, and detaching it with an action and an Athletics check, are printed in the hit's text",
    onHit: [
      {
        conditions: [],
        name: "Attached",
        // "While attached to a target, the darkmantle can attack only the target but has Advantage on its attack
        // rolls."
        tags: ["attached", "source-attacks-only-bearer"],
        endsWhenSourceDies: true,
        // "A creature can take an action to try to detach the darkmantle from itself, doing so with a successful DC 13
        // Strength (Athletics) check."
        endedBy: { name: "Detach the darkmantle", by: "bearer", check: { ability: "str", skill: "athletics", dc: 13 } }
      }
    ],
    reminder:
      "If the target is Medium or smaller and the darkmantle had Advantage on the attack roll, it covers the target, which is Blinded and suffocating (hold its breath) while the darkmantle is attached. While attached, the darkmantle's Speed is 0 and it moves with the target, and it detaches itself with 5 feet of its movement."
  },
  "stirge/proboscis": {
    why: "while attached the stirge can't use its Proboscis again, which the hit's text prints",
    onHit: [
      {
        conditions: [],
        name: "Attached",
        // "While attached, the stirge can't make Proboscis attacks."
        tags: ["attached", "source-no-repeat"],
        ongoingDamage: { damage: [{ formula: "2d4", type: "necrotic" }], at: "source-turn-start" },
        // "The target or a creature within 5 feet of it can detach the stirge as an action."
        endedBy: { name: "Detach", by: "either" }
      }
    ],
    reminder: "The stirge detaches itself by spending 5 feet of its movement."
  },
  "cloaker/attach": {
    why: "while attached the cloaker can Attach only to its target, and it is pulled off with an action and a check",
    onHit: [
      {
        conditions: [{ id: "blinded" }],
        name: "Attached",
        maxTargetSize: "large",
        // "The cloaker can't make Attach attacks against other targets."
        tags: ["attached", "source-target-only"],
        endsWhenSourceDies: true,
        // "The target or a creature within 5 feet of it can take an action to try to detach the cloaker, doing so by
        // succeeding on a DC 14 Strength (Athletics) check."
        endedBy: { name: "Detach the cloaker", by: "either", check: { ability: "str", skill: "athletics", dc: 14 } }
      }
    ],
    reminder:
      "While attached, the cloaker halves the damage it takes (round down), and the target takes the same amount; the cloaker detaches itself by spending 5 feet of movement."
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
  "invisible-stalker/vortex": {
    why: "the grapple also keeps the target from casting spells with a Verbal component",
    // "Until the grapple ends, the target can't cast spells with a Verbal component."
    save: { failureEffect: { name: "Vortex", tags: ["cant-speak"], modifiers: [] } },
    reminder: null
  },
  "incubus/nightmare-recharge-6": {
    why: "the failure acts by the target's Hit Points, which the reader leaves to the GM",
    // "If the target has 20 Hit Points or fewer, it has the Unconscious condition for 1 hour, until it takes damage, or
    // until a creature within 5 feet of it takes an action to wake it. Otherwise, the target takes 18 (4d8) Psychic
    // damage."
    damage: [{ formula: "4d8", type: "psychic" }],
    save: {
      failureByHitPoints: [
        {
          atOrBelow: 20,
          conditions: ["unconscious"],
          duration: { type: "minutes", minutes: 60 },
          endsOnDamage: true,
          endedBy: { name: "Wake", by: "others" }
        }
      ]
    },
    reminder: null
  },
  "djinni/create-whirlwind": {
    why: "the thunder on each of the Restrained target's turns is printed after the failure's own sentence",
    // "At the start of each of its turns, the Restrained target takes 21 (6d6) Thunder damage."
    save: { ongoingDamage: { damage: [{ formula: "6d6", type: "thunder" }], at: "bearer-turn-start" } },
    reminder:
      "The whirlwind lasts while the djinni concentrates on it. The djinni can move it up to 20 feet at the start of each of its turns, and the Restrained creatures move with it; a creature it enters, or that enters it, makes the save once a turn."
  },
  "shambling-mound/engulf": {
    why: "the mound carries what it engulfs at no cost, which the save's text prints",
    // "When the shambling mound moves, the Grappled target moves with it, costing it no extra movement."
    save: { failureEffect: { name: "Engulfed", tags: ["carried-free"], modifiers: [] } },
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
