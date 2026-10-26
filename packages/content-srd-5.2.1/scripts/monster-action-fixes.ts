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
  /** What a hit leaves, in place of the reader's. */
  onHit?: OnHitRider[];
  /** The GM's reminder in place of the reader's; null drops it. */
  reminder?: string | null;
  /** The area the action leaves, which the server runs (a djinni's whirlwind). */
  zone?: ActorAction["zone"];
}>;

export const MONSTER_ACTION_FIXES: Readonly<Record<string, MonsterActionFix>> = {
  "gelatinous-cube/engulf": {
    why: "the escape and the pull from outside are printed in the action and the Ooze Cube trait",
    save: {
      // "An engulfed target can try to escape by taking an action to make a DC 12 Strength (Athletics) check."
      escapeDc: 12,
      escapeAthletics: true,
      // "Can't cast spells with a Verbal component", and "is suffocating": it holds its breath while engulfed. Inside
      // the cube it moves with it and has Total Cover from outside (Ooze Cube), as a swallowed creature does.
      failureEffect: { name: "Engulfed", tags: ["cant-speak", "smothering", "swallowed"], modifiers: [] },
      endsWhenSourceDies: true,
      // "As an action, a creature within 5 feet of the cube can pull a creature ... out of the cube by succeeding on a
      // DC 12 Strength (Athletics) check, and the puller takes 10 (3d6) Acid damage."
      endedBy: {
        name: "Pull free",
        by: "others",
        near: "source",
        check: { ability: "str", skill: "athletics", dc: 12 },
        takerDamage: [{ formula: "3d6", type: "acid" }]
      },
      // "Success: Half damage, and the target moves to an unoccupied space within 5 feet of the cube. If there is no
      // unoccupied space, the target fails the save instead."
      successMovesOut: { withinFeet: 5 }
    },
    // A creature walking into the cube makes the save with Disadvantage (space-entry.ts).
    reminder: "A creature that escapes or is pulled free enters the nearest unoccupied space: move its token there."
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
        // rolls. Its Speed becomes 0 ... and it moves with the target. ... On its turn, the darkmantle can detach itself
        // by using 5 feet of movement."
        tags: ["attached", "source-attacks-only-bearer", "carries-source", "detaches-itself"],
        // "If the target is a Medium or smaller creature and the darkmantle had Advantage on the attack roll, it covers
        // the target, which has the Blinded condition and is suffocating while the darkmantle is attached in this way."
        advantageAdds: { conditions: ["blinded"], tags: ["smothering"], maxTargetSize: "medium" },
        endsWhenSourceDies: true,
        // "A creature can take an action to try to detach the darkmantle from itself, doing so with a successful DC 13
        // Strength (Athletics) check."
        endedBy: { name: "Detach the darkmantle", by: "bearer", check: { ability: "str", skill: "athletics", dc: 13 } }
      }
    ],
    reminder: null
  },
  "stirge/proboscis": {
    why: "while attached the stirge can't use its Proboscis again, which the hit's text prints",
    onHit: [
      {
        conditions: [],
        name: "Attached",
        // "While attached, the stirge can't make Proboscis attacks. ... The stirge can detach itself by spending 5 feet
        // of its movement."
        tags: ["attached", "source-no-repeat", "detaches-itself"],
        ongoingDamage: { damage: [{ formula: "2d4", type: "necrotic" }], at: "source-turn-start" },
        // "The target or a creature within 5 feet of it can detach the stirge as an action."
        endedBy: { name: "Detach", by: "either" }
      }
    ],
    reminder: null
  },
  "cloaker/attach": {
    why: "while attached the cloaker can Attach only to its target, and it is pulled off with an action and a check",
    onHit: [
      {
        conditions: [{ id: "blinded" }],
        name: "Attached",
        maxTargetSize: "large",
        // "The cloaker can't make Attach attacks against other targets. ... While the cloaker is attached, it halves the
        // damage it takes (round down), and the target takes the same amount. The cloaker can detach itself by spending
        // 5 feet of movement."
        tags: ["attached", "source-target-only", "shares-source-damage", "detaches-itself"],
        endsWhenSourceDies: true,
        // "The target or a creature within 5 feet of it can take an action to try to detach the cloaker, doing so by
        // succeeding on a DC 14 Strength (Athletics) check."
        endedBy: { name: "Detach the cloaker", by: "either", check: { ability: "str", skill: "athletics", dc: 14 } }
      }
    ],
    reminder: null
  },
  "animated-rug-of-smothering/smother": {
    why: "the smothering, one creature at a time, and the shared damage follow the hit's grapple",
    onHit: [
      {
        conditions: [{ id: "grappled" }, { id: "blinded" }, { id: "restrained" }],
        name: "Smothered",
        escapeDc: 13,
        maxTargetSize: "medium",
        ongoingDamage: { damage: [{ formula: "2d6 + 3", type: "bludgeoning" }], at: "bearer-turn-start" },
        insteadOfDamage: true,
        // "Is suffocating ... The rug can smother only one creature at a time. While grappling the target, the rug can't
        // take this action, the rug halves the damage it takes (round down), and the target takes the same amount."
        tags: ["smothering", "source-no-repeat", "shares-source-damage"]
      }
    ],
    reminder: null
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
    why: "the thunder on each of the Restrained target's turns is printed after the failure's own sentence, and the whirlwind stays on the map",
    // "At the start of each of its turns, the Restrained target takes 21 (6d6) Thunder damage."
    save: { ongoingDamage: { damage: [{ formula: "6d6", type: "thunder" }], at: "bearer-turn-start" } },
    // "The whirlwind lasts until the djinni's Concentration on it ends", and "Whenever the whirlwind enters a creature's
    // space or a creature enters the whirlwind", the save, "only once per turn, and the djinni is unaffected".
    zone: { on: ["enter"], oncePerTurn: true, atCast: true, concentration: true, carriesHeld: true, sparesUser: true },
    reminder:
      "The djinni can move the whirlwind up to 20 feet at the start of each of its turns: drag its area, and the Restrained creatures move with it."
  },
  "shambling-mound/engulf": {
    why: "the mound carries what it engulfs at no cost, which the save's text prints",
    // "When the shambling mound moves, the Grappled target moves with it, costing it no extra movement."
    // "The target is pulled into the shambling mound's space."
    save: {
      failureEffect: { name: "Engulfed", tags: ["carried-free"], modifiers: [] },
      failurePush: { feet: 5, intoSpace: true }
    },
    reminder: null
  },
  "erinyes/entangling-rope": {
    why: "the rope it throws is the erinyes's magic rope, which turns to dust when the erinyes dies",
    // "While bearing it, the erinyes can use the Entangling Rope action ... The rope turns to dust ... if the erinyes
    // dies."
    save: { endsWhenSourceDies: true }
  },
  "chain-devil/conjure-infernal-chain": {
    why: "the failure's pull toward the devil is printed after its conditions",
    // "If the target is Large or smaller, the devil moves the target up to 30 feet straight toward itself."
    save: { failurePush: { feet: 30, upTo: true, maxTargetSize: "large", toward: true } },
    reminder: null
  },
  "bulette/deadly-leap": {
    why: "the success's push is printed beside its half damage",
    // "Success: Half damage, and the target is pushed 5 feet straight away from the bulette."
    save: { successPush: { feet: 5 } }
  },
  "chain-devil/unnerving-gaze": {
    why: "the reaction prints its failure and success in italic labels the save reader doesn't take apart",
    // "Failure: The target has the Frightened condition until the end of its turn. Success: The target is immune to
    // this devil's Unnerving Gaze for 24 hours."
    save: {
      failureConditions: ["frightened"],
      failureDuration: { type: "until-bearer-turn-end" },
      immuneOnSuccess: true
    }
  }
};

/** The fields a fix sets on its action. */
export function fixedFields(fix: MonsterActionFix | undefined): Partial<ActorAction> {
  if (!fix) return {};
  return {
    ...(fix.damage ? { damage: fix.damage.map((part) => ({ ...part })) } : {}),
    ...(fix.onHit ? { onHit: structuredClone(fix.onHit) } : {}),
    ...(typeof fix.reminder === "string" ? { reminder: fix.reminder } : {}),
    ...(fix.zone ? { zone: structuredClone(fix.zone) } : {})
  };
}
