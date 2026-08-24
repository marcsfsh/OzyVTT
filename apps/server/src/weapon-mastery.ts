import type { AbilityId, ActionResolutionAttack, EffectInstance } from "@vtt/domain";

/**
 * ============================================================================================
 * WEAPON MASTERY - THE DISPATCH SEAM
 * ============================================================================================
 *
 * The SRD defines exactly eight mastery properties and all 38 weapons name one. Each is a small rule
 * that fires at ONE moment of a swing, so every implementation used to be another branch in the same
 * ~20-line region of `action-resolution.ts`: four more of them is one hunk touched four times, and
 * the dangerous resolution of that merge drops a branch while leaving the slug in the implemented
 * set - a mastery that advertises itself and does nothing, which is the exact failure this area has
 * already shipped three times. This module is that region, moved: one registry keyed by slug, one
 * hook per moment, and the implemented set DERIVED from the registry's own HOOKS so registering a
 * behaviour IS joining the set and no unit edits a shared literal.
 *
 * THIS MODULE HAS NO RUNTIME IMPORTS, AND THAT IS LOAD-BEARING - not tidiness. `equipment-derivation.ts`
 * imports `IMPLEMENTED_MASTERIES` from here, and that module is the leaf `character-build.ts` and the
 * resolver both depend on (its own docblock says why), so anything reachable from HERE becomes
 * reachable from THERE. That is why a handler RETURNS what it wants done - bonus-damage lines, effects
 * to add, saves to park, tokens to shove - instead of calling `effects.ts`, `saving-throws.ts` or the
 * map itself: this module owns the rule, `action-resolution.ts` owns the application, and the import
 * graph stays one-directional. A mastery needing a new kind of consequence adds a new RETURN channel
 * here and applies it there; it does not add an import to this file. Four channels exist so far and
 * each is one exported hook - `masteryMissDamage`, `masteryHitEffects`, `masteryHitSaves`,
 * `masteryHitPushes` - because a shared moment gate is what stopped the second mastery drifting from
 * the first.
 */

/**
 * One weapon swing's mastery, as the resolver needs it. The ability modifier travels with the slug
 * because Graze deals "damage equal to the ability modifier you used to make the attack roll", and
 * that choice (finesse takes the better of Str/Dex, a ranged weapon takes Dex) is `weaponAction`'s
 * to make - recomputing it at the resolver would be a second copy of the rule, free to drift.
 */
export type MasteryInForce = Readonly<{ id: string; abilityModifier: number }>;

/**
 * Everything a mastery handler is allowed to see about the swing that just happened.
 *
 * The TARGET is read off `attack` rather than passed beside it, which makes "a mastery acts on the
 * attack's own single target" structurally true rather than checked: `resolveDefinitionAction`
 * rejects an attack with anything but exactly one target before this is ever built, and this shape
 * carries no way to name a second one.
 */
export type MasterySwing = Readonly<{
  mastery: MasteryInForce;
  /** The resolved attack - the outcome, and the one target it landed against. */
  attack: ActionResolutionAttack;
  attacker: Readonly<{ id: string; name: string }>;
  /** The action's own first damage type - what "the same type dealt by the weapon" means for Graze. */
  damageType: string;
  /**
   * The attacker's Proficiency Bonus, for Topple's "DC 8 plus the ability modifier used to make the
   * attack roll and your Proficiency Bonus". It travels with the swing for the same reason the
   * ability modifier does: the resolver already read it off the definition to build the attack, and a
   * second read here would be a second copy of "whose proficiency" free to drift.
   */
  proficiencyBonus: number;
  actionId: string;
  commandId: string;
  round: number;
}>;

/** A flat, labelled damage line: `ActionResolution.bonusDamage`, which the roll card renders on its own row. */
export type MasteryBonusDamage = Readonly<{ amount: number; type: string; source: string }>;

/** An effect for the caller to add, with the target it belongs on. Adding it is `action-resolution.ts`'s job. */
export type MasteryAppliedEffect = Readonly<{ targetId: string; targetName: string; effect: EffectInstance }>;

/**
 * A saving throw for the caller to park (`createPendingSaves`), with the condition a failure imposes.
 * The DC is computed HERE because "DC 8 plus the ability modifier used to make the attack roll and
 * your Proficiency Bonus" is the mastery's rule, not the resolver's.
 */
export type MasteryPendingSave = Readonly<{
  targetId: string; targetName: string;
  ability: AbilityId; dc: number; conditionId: string | null;
  /** The name the tracker row and the save's own dedupe key read; see the Topple handler for why it is the MASTERY's. */
  actionName: string;
}>;

/**
 * FORCED MOVEMENT the caller executes: push `targetId` `distanceFeet` straight away from
 * `awayFromActorId`. There is no destination and no direction here on purpose - both are the
 * server's to derive from the two token positions, and a client has nothing to assert about either.
 */
export type MasteryPush = Readonly<{
  targetId: string; targetName: string; awayFromActorId: string; distanceFeet: number;
  /** The SRD's own size gate ("if it is Large or smaller"); the caller compares it with `sizeAtMost`, the same machinery a declared on-hit rider's `maxTargetSize` uses. */
  maxTargetSize: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
}>;

type MasteryHandler = Readonly<{
  /** The swing MISSED. Returns the bonus-damage lines this mastery adds. */
  onMiss?: (swing: MasterySwing) => readonly MasteryBonusDamage[];
  /** The swing LANDED. Returns the effects this mastery puts on the target. */
  onHit?: (swing: MasterySwing) => readonly MasteryAppliedEffect[];
  /** The swing LANDED. Returns the saving throws this mastery forces on the target. */
  onHitSave?: (swing: MasterySwing) => readonly MasteryPendingSave[];
  /** The swing LANDED. Returns the forced movement this mastery applies to the target. */
  onHitPush?: (swing: MasterySwing) => readonly MasteryPush[];
}>;

/**
 * The two moments, read the same way once. A FUMBLE is a miss and a CRIT is a hit; `unknown` (a
 * target with no AC on the sheet) is neither, so no mastery fires off a swing the engine could not
 * adjudicate. A second copy of these two lines is how the next mastery drifts from the first two.
 */
const missed = (attack: ActionResolutionAttack): boolean => attack.outcome === "miss" || attack.outcome === "fumble";
const landed = (attack: ActionResolutionAttack): boolean => attack.outcome === "hit" || attack.outcome === "crit";

const MASTERY_HANDLERS: Readonly<Record<string, MasteryHandler | undefined>> = {
  /**
   * GRAZE. "If your attack roll with this weapon misses a creature, you can deal damage to that
   * creature equal to the ability modifier you used to make the attack roll. This damage is the same
   * type dealt by the weapon."
   *
   * The one mastery that fires on a MISS, which is why it is an `onMiss` handler and why its call
   * site sits OUTSIDE the damage block in `action-resolution.ts` - that block is gated on
   * hit/crit/unknown by design, and Graze is the exception the SRD writes.
   *
   * A FUMBLE is still a miss and still grazes: the SRD gives no carve-out for a natural 1, and the
   * feature is a floor on the swing rather than a reward for rolling well.
   *
   * `bonusDamage` is the right channel and not a compromise - it is flat integers with a source
   * label, which is exactly what "damage equal to your ability modifier" is, and the roll card
   * already renders it as its own explainable line. A non-positive modifier deals nothing rather than
   * healing the target.
   */
  graze: {
    onMiss: (swing) => swing.mastery.abilityModifier > 0
      ? [{ amount: swing.mastery.abilityModifier, type: swing.damageType, source: "Graze" }]
      : []
  },

  /**
   * PUSH. "If you hit a creature with this weapon, you can push the creature up to 10 feet straight
   * away from yourself if it is Large or smaller."
   *
   * The whole rule is in the returned record and NONE of it comes from a client: the direction is
   * "straight away from yourself", which the server derives from the two token positions, and the
   * distance is the SRD's 10 feet. A client has nothing to assert about either - not a destination,
   * not a heading, not a number of squares - so the wire carries no push input at all and there is
   * no forged value to validate. `forced-movement.ts` does the geometry and `action-resolution.ts`
   * calls it; this file still imports nothing (see the header).
   *
   * THE SIZE GATE IS THE SRD'S, so its value lives here with the rule - but the COMPARISON is the
   * caller's `sizeAtMost`, the same ladder a declared on-hit rider's `maxTargetSize` runs through.
   * Copying a size order into this module to answer "is Huge bigger than Large" would be a second
   * table free to drift from the first. A too-large target is narrated rather than silently skipped,
   * so the GM learns why the ogre stayed put - every sentence a push produces is a GM rules note
   * today, the shared feed included, which is its own open question and not this handler's to answer.
   *
   * NAMED ABSENCE - THE ATTACKER'S CHOICE. The SRD prints "you CAN push the creature UP TO 10 feet";
   * the engine takes the full distance on every hit, the same reading Graze's "you can deal damage"
   * already gets here. That divergence is not free, and it is not the same trade the other two make.
   * Graze only PROPOSES a number (applying damage is its own confirm step) and Topple's prompt is
   * dismissible with its own ✕, but a push is an immediate state write - and the one write the player
   * who caused it cannot reverse, because a player may move only their own claimed token
   * (`game-operations.ts`, `tokenMove`). All three melee weapons that carry Push reach 5 or 10 feet,
   * so taking the full shove can put the target outside the attacker's OWN reach before the second
   * swing of one Attack action, which is precisely why the SRD made it optional.
   *
   * WHAT IT WOULD TAKE: one optional boolean the attacker declares on the resolve payload
   * (`ResolveInput`), plus the control on the action runner that offers it - the server still deriving
   * direction and distance, since declining can only make the effect smaller and there is still
   * nothing about geometry for a client to assert. The two halves have to land together: a wire field
   * with no control is the "built but unwired" state this module exists to end, and a control that
   * asked on every hit without one would nag. Until then the rider is automatic and this paragraph is
   * the record of what that costs.
   */
  push: {
    onHitPush: (swing) => [{
      targetId: swing.attack.targetId,
      targetName: swing.attack.targetName,
      awayFromActorId: swing.attacker.id,
      distanceFeet: 10,
      maxTargetSize: "large"
    }]
  },

  /**
   * SAP. "If you hit a creature with this weapon, that creature has Disadvantage on its next attack
   * roll before the start of your next turn."
   *
   * A real effect on the TARGET, carrying `attack-disadvantage` - the variant whose own comment reads
   * "the bearer's own attack rolls have disadvantage" - and ending at the start of the attacker's next
   * turn, which is what `until-source-next-turn` already means for Reckless Attack and Dodge.
   *
   * KNOWN APPROXIMATION, stated rather than hidden: the SRD ends Sap on the target's NEXT attack roll
   * or the attacker's next turn, whichever comes first, and nothing in the effect vocabulary expires
   * on use. So a target that attacks twice in that window rolls both at Disadvantage instead of one.
   * This is the same shape the shipped Help builtin already has (`attack-advantage`, same duration,
   * also "the next attack roll" in the SRD), so it follows the engine's existing convention rather
   * than inventing a second one. A one-shot duration is the fix, and it fixes both together.
   *
   * `endsWhenSourceDefeated` IS FALSE, and Slow's docblock below carries the argument for both: the
   * printed duration is "before the start of your next turn", and dropping to 0 HP does not delete a
   * turn the dying creature still owns. The two masteries answer this the same way on purpose.
   *
   * `stackKey` COSTS NOTHING HERE AND IS SET ANYWAY - the claim, and then the proof. Nothing sums
   * `attack-disadvantage`: `aggregateRollMode` reads it as a presence, so two Sapped effects and one
   * produce the identical 2d20-keep-the-lower. The key therefore moves no number this mastery can
   * print; it is here so "a mastery's effect names the game effect it is" is a convention rather than
   * a thing Slow does alone, and so a future reader that groups something else finds the identity
   * already stated instead of inferring one from a tag.
   *
   * NO condition is linked: Sap is not a named condition, and putting one on the row would make the
   * token render a status it does not have.
   */
  sap: {
    onHit: (swing) => [{
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
        endsWhenSourceDefeated: false,
        voidWhileIncapacitated: false,
        concentration: false,
        stackKey: "mastery:sap",
        modifiers: [{ type: "attack-disadvantage" }],
        linkedConditionIds: [],
        escapeDc: null,
        onEnd: [],
        endsWithTag: null
      }
    }]
  },

  /**
   * SLOW. "If you hit a creature with this weapon, the target's Speed is reduced by 10 feet until the
   * start of your next turn."
   *
   * A real effect on the TARGET carrying the RUNTIME `speed` modifier at −10, which `currentSpeedFeet`
   * (`condition-rules.ts`) sums on every read - so the foe's own movement budget is 10 ft smaller on
   * its own turn (`movement-rules.ts`) and standing up out of Prone costs half of the reduced number.
   * The duration is Sap's: `until-source-next-turn` is what "until the start of your next turn" means
   * for Reckless Attack, Dodge and Sap, and `expireEffectsAtTurnStart` gives the feet back there.
   *
   * IT MUST NOT WRITE `actor.speedFeet`, and that is the whole reason U18 exists. That field is the
   * SHEET's Speed; an effect that ends has to give the feet back, and a mastery that decremented the
   * base would leave a creature permanently slower every time an expiry was missed - the kind of wrong
   * number a table only notices three fights later.
   *
   * NO condition is linked, for Sap's reason: `slow` is not a named SRD condition, and putting one on
   * the row would make the token render a status the creature does not have.
   *
   * SLOW DOES NOT STACK WITH SLOW, FROM ANY ATTACKER OR ANY WEAPON - SRD 5.2.1 rules glossary,
   * "Combining Game Effects": *"The effects of the same name don't combine... the most potent effect
   * applies."* Two applications of the Slow mastery property ARE the same game effect, so `stackKey`
   * names it (`mastery:slow`) and `currentSpeedFeet` takes the single most potent −10 across the
   * group instead of adding them up. Two crocodiles biting the same creature take 10 feet off it, and
   * so does one attacker who throws a javelin and then swings a club in the same turn. A DIFFERENT
   * effect still sums normally: a Slow plus a homebrew curse, or a Slow plus Longstrider's +10, is the
   * arithmetic it always was.
   *
   * THIS RESOLVES THE APPROXIMATION THIS DOCBLOCK USED TO NAME. It said a javelin and then a club cost
   * 20 feet while two javelins cost 10, called the inconsistency the SRD's problem, and asked for a key
   * that meant "one per source creature". The key that was actually needed says "one per game EFFECT",
   * which is stronger: it settles the two-attacker case the old text also got wrong, and it is the
   * glossary's own rule rather than a cap invented here.
   *
   * EACH INSTANCE KEEPS ITS OWN DURATION, and that is why these are still separate rows. The reduction
   * is live while ANY instance is: the first crocodile's turn begins, its own row expires, and the
   * creature is still slowed by the second one's - the read simply stops having two contributions to
   * choose between. Only the last expiry hands the feet back.
   *
   * THREE MECHANISMS KEEP THE ROWS STRAIGHT, and they answer three different questions. The `id`
   * carries the `commandId`, so a RETRIED command re-adds nothing (`addEffect` is idempotent by id).
   * The `sourceActionId` carries the attacker and the weapon action, so a SECOND hit from that same
   * weapon REFRESHES the first in place - the duration renewal a re-declared Rage gets, and the reason
   * Extra Attack's two javelin hits are one row. And `stackKey` decides how the rows that DO exist are
   * READ, which is not the same question as which rows exist; it is generic vocabulary in
   * `@vtt/schemas`, and `condition-rules.ts` groups by it knowing nothing about masteries at all.
   *
   * `endsWhenSourceDefeated` IS FALSE, and the printed duration is why. Slow lasts "until the start of
   * your next turn"; an attacker who drops to 0 HP still HAS a next turn - `nextInitiativeTurn` skips
   * nobody, so `expireEffectsAtTurnStart` still fires there and still hands the feet back. A true flag
   * lifted the penalty the instant the attacker fell, which is a shorter duration than the SRD prints
   * and a wrong number at the table. Nothing strands the effect either: a combatant cannot be removed
   * from a live fight (`actor-roster.ts` refuses it), and ending the encounter ends every effect on
   * every combatant in it (`endEncounterEffects`). Sap answers this the same way for the same reason.
   */
  slow: {
    onHit: (swing) => [{
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
        endsWhenSourceDefeated: false,
        // FALSE, and the opposite of Dodge's reading: this is a PENALTY the target carries, so voiding
        // it while the target is incapacitated would hand the feet back to a creature that just fell
        // unconscious. `voidWhileIncapacitated` lapses benefits, never debts.
        voidWhileIncapacitated: false,
        concentration: false,
        // The name of the GAME EFFECT, not of the weapon or the attacker: every Slow shares it, which
        // is what makes two of them one reduction rather than two (SRD "Combining Game Effects").
        stackKey: "mastery:slow",
        modifiers: [{ type: "speed", amount: -10 }],
        linkedConditionIds: [],
        escapeDc: null,
        onEnd: [],
        endsWithTag: null
      }
    }]
  },

  /**
   * TOPPLE. "If you hit a creature with this weapon, you can force the creature to make a
   * Constitution saving throw (DC 8 plus the ability modifier used to make the attack roll and your
   * Proficiency Bonus). On a failed save, the creature has the Prone condition."
   *
   * The DC is the builtin Shove's formula with two substitutions, and both matter. The ability is
   * "the one used to make the attack roll" rather than Strength, so a thrown trident sets its DC off
   * whatever `weaponAction` chose - which is why `MasteryInForce` carries the modifier instead of the
   * resolver recomputing it. The Proficiency Bonus is unconditional in the printed sentence: it is
   * YOURS, not "if you are proficient with this weapon".
   *
   * The prompt is a REAL pending save on the target, not a warning: `createPendingSaves` +
   * `conditionId: "prone"` is the same path the Shove takes, so answering it below the DC applies
   * Prone through `setCondition` (immunities and all) with no second implementation of "or falls
   * Prone". No damage rides it, and a success does nothing - `proposedDamage: 0` with
   * `halfOnSuccess: false` says exactly that.
   *
   * `actionName` is "Topple", NOT the weapon's name, and that is load-bearing twice. The tracker row
   * reads "DC 13 CON vs Topple (Borin)", which names the rule the creature is resisting rather than
   * the object that caused it; and the prompt's dedupe key is (target, actionName, source), so a
   * mastery save can never displace - or be displaced by - a save the ACTION itself declares.
   * It does not displace ITSELF either: Topple fires on every hit and the SRD sets no per-turn limit
   * (contrast Nick's explicit "only once per turn"), so Extra Attack's two hits owe two saves and the
   * caller parks this one with `replaceExisting: false`. The replace-by-key convention stays for the
   * saves an ACTION declares, where a re-cast is a second spend the player chose.
   *
   * "You can force" is applied automatically, exactly as Graze's "you can deal damage" is. An
   * engine-side prompt for every optional rider would out-nag the table; the GM dismisses the save
   * with the prompt's own ✕ when the attacker declines.
   */
  topple: {
    onHitSave: (swing) => [{
      targetId: swing.attack.targetId,
      targetName: swing.attack.targetName,
      ability: "con",
      // Clamped to the wire's own 1..40 (`PendingSaveSchema`), so an absurd sheet cannot make a save
      // that fails schema validation on its way to the tracker.
      dc: Math.max(1, Math.min(40, 8 + swing.mastery.abilityModifier + swing.proficiencyBonus)),
      conditionId: "prone",
      actionName: "Topple"
    }]
  }
};

/**
 * WHICH OF THE EIGHT MASTERIES THE ENGINE ACTUALLY IMPLEMENTS - and it is DERIVED, so it cannot lie.
 * A slug is in this set because a handler above answers to it; there is no literal to forget to edit
 * and no way to advertise a mastery with no behaviour behind it.
 *
 * That honesty is the whole point. A slug on 38 records that no engine path reads is the "built but
 * unwired" failure this repo has already shipped three times, and it looks identical to a feature
 * that works - so the derivation refuses to advertise a mastery it cannot honour, and this set is
 * the gate it consults (through `masteryReaches` in `equipment-derivation.ts`, still the single
 * public door).
 *
 * NOT implemented, and therefore deliberately inert rather than half-wired. Each needs engine surface
 * that does not exist yet, sized in the Stage 5 report:
 *   cleave - a second attack roll against a different creature inside one resolution.
 *   nick   - moves the Light property's extra attack out of the bonus action; a turn-economy change.
 *   vex    - Advantage on the attacker's next attack AGAINST THAT CREATURE; effects have no target
 *            scoping, so there is nowhere to hang "against this one foe" today.
 */
export const IMPLEMENTED_MASTERIES: ReadonlySet<string> = new Set(
  Object.entries(MASTERY_HANDLERS)
    // A KEY IS NOT A BEHAVIOUR, and the sentence above is only true because of this line. Every hook
    // on `MasteryHandler` is optional and this registry's value type admits `undefined`, so `cleave: {}`
    // typechecks - and a slug that joined the set by being written down would advertise a mastery that
    // does nothing, which is the one thing this set exists to prevent. Joining takes a hook. The test
    // is over the VALUES rather than a list of the four channel names, so a fifth channel needs no
    // second edit here and an unrecognised shape fails toward absence rather than toward a lie.
    .filter(([, handler]) => Object.values(handler ?? {}).some((hook) => typeof hook === "function"))
    .map(([slug]) => slug)
);

/**
 * THE ON-MISS HOOK. The bonus-damage lines this swing's mastery adds when the attack missed.
 *
 * Null in (no mastery in force, or no attack roll at all) and empty out; the moment gate lives here
 * rather than in the handler so "on miss" means the same thing for every mastery that ever registers.
 */
export function masteryMissDamage(swing: MasterySwing | null): readonly MasteryBonusDamage[] {
  if (swing === null || !missed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onMiss?.(swing) ?? [];
}

/**
 * THE ON-HIT HOOK. The effects this swing's mastery puts on the target when the attack landed - built
 * here, ADDED by the caller, so this module keeps its zero runtime imports (see the header).
 */
export function masteryHitEffects(swing: MasterySwing | null): readonly MasteryAppliedEffect[] {
  if (swing === null || !landed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onHit?.(swing) ?? [];
}

/**
 * THE ON-HIT SAVE HOOK (Topple today). The saving throws this swing's mastery forces on the target -
 * described here, PARKED by the caller through `createPendingSaves`, for the same reason the effects
 * are added there: this module reaches `equipment-derivation.ts` and must not drag `saving-throws.ts`
 * along with it.
 */
export function masteryHitSaves(swing: MasterySwing | null): readonly MasteryPendingSave[] {
  if (swing === null || !landed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onHitSave?.(swing) ?? [];
}

/**
 * THE ON-HIT PUSH HOOK (Push today). The forced movement this swing's mastery applies - DESCRIBED
 * here as an actor pair and a distance, EXECUTED by the caller through the resolver's optional
 * geometry callback. Geometry is exactly the kind of dependency this module cannot hold: reaching
 * `token-placement.ts` from here would put the whole map subsystem behind `equipment-derivation.ts`.
 */
export function masteryHitPushes(swing: MasterySwing | null): readonly MasteryPush[] {
  if (swing === null || !landed(swing.attack)) return [];
  return MASTERY_HANDLERS[swing.mastery.id]?.onHitPush?.(swing) ?? [];
}
