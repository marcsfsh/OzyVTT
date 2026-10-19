import type { AbilityId, GameState, PendingSave } from "@vtt/domain";
import type { DamageDrain, ForcedPush } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

/** Create one pending save per target when a save action resolves. Called inside the action:resolve mutation. */
export function createPendingSaves(
  state: GameState,
  input: Readonly<{
    sourceActorId: string | null;
    sourceName: string;
    actionName: string;
    ability: AbilityId;
    dc: number;
    targetIds: readonly string[];
    proposedDamage: number;
    proposedDamageParts?: ReadonlyArray<{ amount: number; type: string }>;
    halfOnSuccess: boolean;
    conditionIds: readonly string[];
    saveBonus?: number;
    onFailEffect?: Omit<NonNullable<PendingSave["onFailEffect"]>, "modifiers"> &
      Partial<Pick<NonNullable<PendingSave["onFailEffect"]>, "modifiers">>;
    /** A save repeated at the end of the bearer's turn: a success ends this effect. */
    repeatOf?: PendingSave["repeatOf"];
    /** Replace an older prompt with the same (target, actionName, source) key. Default true; per-hit riders
     *  pass false since Extra Attack can owe two saves. */
    replaceExisting?: boolean;
    /** The GM's call for a roll these saves answer. */
    callId?: string;
    /** What else each save carries: what a success leaves, a line for a failure, the spell area that raised it. */
    extra?: Pick<
      PendingSave,
      | "onSuccessEffect"
      | "failureNote"
      | "breaksConcentration"
      | "zoneId"
      | "touchedZone"
      | "gmApplies"
      | "failureByHitPoints"
      | "failureByMargin"
      | "objectPenalty"
      | "failureBanishes"
      | "endsForm"
      | "regurgitates"
    >;
    /** Against a spell or a magic item, which Magic Resistance meets with Advantage. */
    magical?: boolean;
    /** A success makes the target immune to this trait of its source for the fight (a ghast's Stench). */
    immuneOnSuccess?: boolean;
    /** What the save's damage drains as it lands (Harm's lower Hit Point maximum). */
    drain?: DamageDrain;
    /** Where a failure pushes the creature (Thunderwave). */
    failurePush?: ForcedPush;
    /** A creature this size or larger has Advantage on the save (Ensnaring Strike). */
    advantageAtSize?: PendingSave["advantageAtSize"];
    /** The spell the save is against, for what answers a save against a spell. */
    spell?: PendingSave["spell"];
    /** What gives the save Advantage beyond the target's riders (the damage that opened it). */
    advantageFrom?: string;
    /** A failure kills the target outright (Consume Life). */
    failureKills?: PendingSave["failureKills"];
    /** Why the target succeeds without rolling (a Construct against Flesh to Stone). */
    autoSucceeds?: string;
    /** One target's save, and the saves it repeats against the effect, have Disadvantage from this (Heightened
     *  Spell). */
    disadvantage?: Readonly<{ targetId: string; from: string }>;
    newSaveId: () => string;
    createdAt: number;
  }>
) {
  const disadvantaged = (targetActorId: string) => input.disadvantage?.targetId === targetActorId;
  const onFailFor = (targetActorId: string) => {
    const onFail = input.onFailEffect;
    if (!onFail) return {};
    const repeat =
      onFail.repeatSave && disadvantaged(targetActorId) ? { disadvantageFrom: input.disadvantage!.from } : {};
    return {
      onFailEffect: {
        ...onFail,
        modifiers: [...(onFail.modifiers ?? [])],
        ...(onFail.repeatSave ? { repeatSave: { ...onFail.repeatSave, ...repeat } } : {})
      }
    };
  };
  const additions: PendingSave[] = input.targetIds.map((targetActorId) => ({
    id: input.newSaveId(),
    targetActorId,
    ability: input.ability,
    dc: input.dc,
    sourceActorId: input.sourceActorId,
    sourceName: input.sourceName,
    actionName: input.actionName,
    proposedDamage: input.proposedDamage,
    ...(input.proposedDamageParts && input.proposedDamageParts.length > 0
      ? { proposedDamageParts: [...input.proposedDamageParts] }
      : {}),
    halfOnSuccess: input.halfOnSuccess,
    conditionIds: [...input.conditionIds],
    saveBonus: input.saveBonus ?? 0,
    ...onFailFor(targetActorId),
    ...(disadvantaged(targetActorId) ? { disadvantageFrom: input.disadvantage!.from } : {}),
    ...(input.repeatOf ? { repeatOf: input.repeatOf } : {}),
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    ...(input.extra?.onSuccessEffect ? { onSuccessEffect: structuredClone(input.extra.onSuccessEffect) } : {}),
    ...(input.extra?.failureNote ? { failureNote: input.extra.failureNote } : {}),
    ...(input.extra?.breaksConcentration ? { breaksConcentration: true as const } : {}),
    ...(input.extra?.zoneId !== undefined ? { zoneId: input.extra.zoneId } : {}),
    ...(input.extra?.touchedZone ? { touchedZone: { ...input.extra.touchedZone } } : {}),
    ...(input.extra?.gmApplies ? { gmApplies: true as const } : {}),
    ...(input.extra?.endsForm ? { endsForm: true as const } : {}),
    ...(input.extra?.failureByHitPoints ? { failureByHitPoints: structuredClone(input.extra.failureByHitPoints) } : {}),
    ...(input.extra?.failureBanishes ? { failureBanishes: [...input.extra.failureBanishes] } : {}),
    ...(input.extra?.failureByMargin ? { failureByMargin: structuredClone(input.extra.failureByMargin) } : {}),
    ...(input.extra?.objectPenalty ? { objectPenalty: { ...input.extra.objectPenalty } } : {}),
    ...(input.extra?.regurgitates ? { regurgitates: { ...input.extra.regurgitates } } : {}),
    ...(input.magical ? { magical: true as const } : {}),
    ...(input.immuneOnSuccess ? { immuneOnSuccess: true as const } : {}),
    ...(input.drain ? { drain: { ...input.drain } } : {}),
    ...(input.failurePush ? { failurePush: { ...input.failurePush } } : {}),
    ...(input.advantageAtSize ? { advantageAtSize: input.advantageAtSize } : {}),
    ...(input.spell ? { spell: { ...input.spell } } : {}),
    ...(input.advantageFrom ? { advantageFrom: input.advantageFrom.slice(0, 120) } : {}),
    ...(input.failureKills ? { failureKills: { ...input.failureKills } } : {}),
    ...(input.autoSucceeds ? { autoSucceeds: input.autoSucceeds.slice(0, 120) } : {}),
    createdAt: input.createdAt
  }));
  // A re-cast against the same target replaces its older prompt.
  const remaining =
    input.replaceExisting === false
      ? state.combat.pendingSaves
      : state.combat.pendingSaves.filter(
          (entry) =>
            !additions.some(
              (added) =>
                added.targetActorId === entry.targetActorId &&
                added.actionName === entry.actionName &&
                added.sourceActorId === entry.sourceActorId
            )
        );
  const pendingSaves = [...remaining, ...additions];
  if (pendingSaves.length > 100)
    throw new CommandRejectedError("Too many unanswered saving throws. Resolve or dismiss some first.");
  state.combat = { ...state.combat, pendingSaves };
}
