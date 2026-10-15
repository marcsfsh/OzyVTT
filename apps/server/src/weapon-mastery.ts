import type { AbilityId, ActionResolutionAttack } from "@vtt/domain";
import type { EffectSpec } from "./effects.js";

/** Weapon mastery dispatch: one registry keyed by SRD mastery slug, one hook per moment of a swing.
 *  No runtime imports, and keep it that way: `equipment-derivation.ts` imports this and is a leaf for
 *  the builder and resolver. Handlers return what should happen; the resolver (`resolution/`) applies it. */

/** One swing's mastery, with the ability modifier `weaponAction` chose (Graze and Topple use it). */
export type MasteryInForce = Readonly<{ id: string; abilityModifier: number }>;

/** What a handler sees of the swing; the target is read off `attack`, which has exactly one. */
export type MasterySwing = Readonly<{
  mastery: MasteryInForce;
  /** The resolved attack: the outcome and its single target. */
  attack: ActionResolutionAttack;
  attacker: Readonly<{ id: string; name: string }>;
  /** The action's first damage type: "the same type dealt by the weapon" for Graze. */
  damageType: string;
  /** The attacker's Proficiency Bonus, for Topple's DC (read once by the resolver). */
  proficiencyBonus: number;
  actionId: string;
  commandId: string;
  round: number;
}>;

/** A flat, labelled damage line (`ActionResolution.bonusDamage`), rendered on its own row. */
export type MasteryBonusDamage = Readonly<{ amount: number; type: string; source: string }>;

/** An effect for the caller to build (`makeEffect`) and add, with the target it belongs on. */
export type MasteryAppliedEffect = Readonly<{ targetId: string; targetName: string; effect: EffectSpec }>;

/** A saving throw for the caller to park (`createPendingSaves`), with the condition a failure imposes. */
export type MasteryPendingSave = Readonly<{
  targetId: string;
  targetName: string;
  ability: AbilityId;
  dc: number;
  conditionId: string | null;
  /** The tracker row name and the save's dedupe key; the mastery's name (see Topple). */
  actionName: string;
}>;

/** Forced movement the caller executes: push `targetId` straight away from `awayFromActorId`. */
export type MasteryPush = Readonly<{
  targetId: string;
  targetName: string;
  awayFromActorId: string;
  distanceFeet: number;
  /** The SRD size gate ("Large or smaller"), compared by the caller with `sizeAtMost`. */
  maxTargetSize: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
}>;

type MasteryHandler = Readonly<{
  /** The swing missed. Returns the bonus-damage lines this mastery adds. */
  onMiss?: (swing: MasterySwing) => readonly MasteryBonusDamage[];
  /** The swing landed. Returns the effects this mastery puts on the target. */
  onHit?: (swing: MasterySwing) => readonly MasteryAppliedEffect[];
  /** The swing landed. Returns the saving throws this mastery forces on the target. */
  onHitSave?: (swing: MasterySwing) => readonly MasteryPendingSave[];
  /** The swing landed. Returns the forced movement this mastery applies to the target. */
  onHitPush?: (swing: MasterySwing) => readonly MasteryPush[];
}>;

// Moment gates shared by every mastery: a fumble is a miss, a crit is a hit, and `unknown` (target has
// no AC) is neither, so no mastery fires on a swing the engine could not adjudicate.
const missed = (attack: ActionResolutionAttack): boolean => attack.outcome === "miss" || attack.outcome === "fumble";
const landed = (attack: ActionResolutionAttack): boolean => attack.outcome === "hit" || attack.outcome === "crit";

const MASTERY_HANDLERS: Readonly<Record<string, MasteryHandler | undefined>> = {
  /** Graze (SRD): on a miss (fumbles included), damage equal to the attack's ability modifier, of the
   *  weapon's type. A non-positive modifier deals nothing. */
  graze: {
    onMiss: (swing) =>
      swing.mastery.abilityModifier > 0
        ? [{ amount: swing.mastery.abilityModifier, type: swing.damageType, source: "Graze" }]
        : []
  },

  /** Push (SRD): on a hit, push the creature up to 10 feet straight away if it is Large or smaller. The
   *  caller derives direction and does the geometry. Limitation: always the full 10 feet, with no
   *  attacker choice of a shorter push. */
  push: {
    onHitPush: (swing) => [
      {
        targetId: swing.attack.targetId,
        targetName: swing.attack.targetName,
        awayFromActorId: swing.attacker.id,
        distanceFeet: 10,
        maxTargetSize: "large"
      }
    ]
  },

  /** Sap (SRD): on a hit, Disadvantage on the target's next attack roll before the start of your next
   *  turn. Approximation: effects don't expire on use, so every attack in that window has Disadvantage
   *  (same as Help). Persists if the attacker drops to 0 HP (they still have a next turn). */
  sap: {
    onHit: (swing) => [
      {
        targetId: swing.attack.targetId,
        targetName: swing.attack.targetName,
        effect: {
          id: `${swing.commandId}:mastery:sap:${swing.attack.targetId}`,
          name: `Sapped by ${swing.attacker.name}`,
          tags: ["sap"],
          sourceActorId: swing.attacker.id,
          sourceName: swing.attacker.name,
          sourceActionId: `${swing.actionId}:sap`,
          startedRound: swing.round,
          duration: { type: "until-source-next-turn" },
          stackKey: "mastery:sap",
          modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }]
        }
      }
    ]
  },

  /**
   * Slow (SRD): on a hit, the target's Speed drops by 10 feet until the start of your next turn, as a
   * `speed` effect (never by writing `actor.speedFeet`). SRD "Combining Game Effects": Slows don't stack,
   * so `stackKey` groups them and the most potent applies. A second hit from the same weapon refreshes
   * via `sourceActionId`. Persists if the attacker drops to 0 HP (they still have a next turn).
   */
  slow: {
    onHit: (swing) => [
      {
        targetId: swing.attack.targetId,
        targetName: swing.attack.targetName,
        effect: {
          id: `${swing.commandId}:mastery:slow:${swing.attack.targetId}`,
          name: `Slowed by ${swing.attacker.name}`,
          tags: ["slow"],
          sourceActorId: swing.attacker.id,
          sourceName: swing.attacker.name,
          sourceActionId: `${swing.actionId}:slow`,
          startedRound: swing.round,
          duration: { type: "until-source-next-turn" },
          // A penalty, so it must not lapse while the target is incapacitated (that only applies to benefits).
          voidWhileIncapacitated: false,
          // Names the game effect, so every Slow is one reduction (SRD "Combining Game Effects").
          stackKey: "mastery:slow",
          modifiers: [{ type: "speed", amount: -10 }]
        }
      }
    ]
  },

  /**
   * Topple (SRD): on a hit, CON save (DC 8 + the attack's ability modifier + your PB) or fall Prone,
   * parked as a real pending save. `actionName` "Topple" names the rule in the tracker and keeps its
   * dedupe key apart from the action's own save. No per-turn limit, so Extra Attack's two hits owe two
   * saves. Applied automatically; the GM dismisses the prompt if the attacker declines.
   */
  topple: {
    onHitSave: (swing) => [
      {
        targetId: swing.attack.targetId,
        targetName: swing.attack.targetName,
        ability: "con",
        // Clamped to `PendingSaveSchema`'s 1..40.
        dc: Math.max(1, Math.min(40, 8 + swing.mastery.abilityModifier + swing.proficiencyBonus)),
        conditionId: "prone",
        actionName: "Topple"
      }
    ]
  }
};

/** The implemented masteries, derived from the registry so a slug can't be advertised without behaviour.
 *  Not yet implemented: cleave (second attack roll in one resolution), nick (Light extra attack off the
 *  bonus action), vex (needs effects scoped to one target creature). */
export const IMPLEMENTED_MASTERIES: ReadonlySet<string> = new Set(
  Object.entries(MASTERY_HANDLERS)
    // A key alone is not a behaviour (`cleave: {}` typechecks), so a slug joins only if it has a hook.
    .filter(([, handler]) => Object.values(handler ?? {}).some((hook) => typeof hook === "function"))
    .map(([slug]) => slug)
);

/** On-miss hook: bonus-damage lines the swing's mastery adds when the attack missed. */
export function masteryMissDamage(swing: MasterySwing | null): readonly MasteryBonusDamage[] {
  if (swing === null || !missed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onMiss?.(swing) ?? [];
}

/** On-hit hook: effects the swing's mastery puts on the target; the caller adds them. */
export function masteryHitEffects(swing: MasterySwing | null): readonly MasteryAppliedEffect[] {
  if (swing === null || !landed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onHit?.(swing) ?? [];
}

/** On-hit save hook (Topple): saves the swing's mastery forces; the caller parks them. */
export function masteryHitSaves(swing: MasterySwing | null): readonly MasteryPendingSave[] {
  if (swing === null || !landed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onHitSave?.(swing) ?? [];
}

/** On-hit push hook (Push): forced movement the caller executes through the resolver's geometry callback. */
export function masteryHitPushes(swing: MasterySwing | null): readonly MasteryPush[] {
  if (swing === null || !landed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onHitPush?.(swing) ?? [];
}
