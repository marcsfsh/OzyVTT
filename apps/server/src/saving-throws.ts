import type { AbilityId, Actor, DamageApplication, GameState, PendingSave, RollRecord } from "@vtt/domain";
import {
  abilityModifier as scoreModifier,
  aggregateRollMode,
  collectRiders,
  parseDiceFormula,
  rescaleDamageParts,
  resolveDice,
  sumRiders,
  type AggregatedRollMode,
  type RandomSource,
  type RollModeSource
} from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { recordRoll as recordRollInHistory } from "./roll-history.js";
import { applyDamageDetailed, adjustableActor, type ActorScope } from "./hit-points.js";
import { setCondition } from "./actor-conditions.js";
import { autoFailsPhysicalSaves, conditionLabel, exhaustionPenalty, isIncapacitated } from "./condition-rules.js";
import { addEffect, endEffectIfPresent, type EffectNarration } from "./effects.js";
import {
  deriveEquipment,
  EMPTY_DERIVATION,
  type EquipmentCatalog,
  type EquipmentDerivation
} from "./equipment-derivation.js";

export type SaveAnswerDependencies = Readonly<{
  random: RandomSource;
  newRollId: () => string;
  sessionId: string;
  role: "gm" | "player";
  now: () => string;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog, so an item's save bonus and save advantage reach the roll. */
  catalog?: EquipmentCatalog;
}>;
export type SaveOutcome = Readonly<{
  success: boolean;
  total: number;
  dc: number;
  appliedDamage: number;
  conditionApplied: boolean;
  committed: boolean;
  /** Typed breakdown of the damage this save applied, so the table sees why it changed; absent when none landed. */
  parts?: DamageApplication["parts"];
  flatReduction?: number;
  /** The condition that forced an automatic failure (Paralyzed etc. on a Str/Dex save); null when the die was rolled. */
  autoFailed?: string | null;
  /** Advantage/disadvantage sources that shaped the rolled save (Restrained, Dodge); absent for a plain d20. */
  rollMode?: AggregatedRollMode;
}>;

/** Advantage/disadvantage sources for a save (SRD: Restrained gives disadvantage on DEX saves; Dodge, item
 *  riders). Mirrors attackRollSources. */
export function saveRollSources(
  target: Actor,
  ability: AbilityId,
  derivation: EquipmentDerivation = EMPTY_DERIVATION
): { advantage: RollModeSource[]; disadvantage: RollModeSource[] } {
  const advantage: RollModeSource[] = [];
  const disadvantage: RollModeSource[] = [];
  if (ability === "dex" && target.conditions.some((condition) => condition.id === "restrained")) {
    disadvantage.push({ source: "target-restrained", label: "Restrained (Dex saves)" });
  }
  // Effect modifiers (Dodge's Dex-save advantage); voidWhileIncapacitated effects lapse per the SRD.
  const incapacitated = isIncapacitated(target);
  for (const effect of target.effects) {
    if (effect.voidWhileIncapacitated && incapacitated) continue;
    for (const modifier of effect.modifiers) {
      if (modifier.type === "save-advantage" && (modifier.ability === undefined || modifier.ability === ability))
        advantage.push({ source: effect.id, label: effect.name });
      if (modifier.type === "save-disadvantage" && (modifier.ability === undefined || modifier.ability === ability))
        disadvantage.push({ source: effect.id, label: effect.name });
    }
  }
  // Item riders: standing ones (no `when`) and `on-saving-throw` ones narrowed by `ability-is`; disjoint passes.
  for (const moment of [null, "on-saving-throw"] as const) {
    for (const rider of collectRiders(derivation.carriers, { ...derivation.context, ability, moment })) {
      if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "save") continue;
      (rider.modifier.mode === "advantage" ? advantage : disadvantage).push({
        source: `item:${rider.sourceItemId ?? rider.label}`,
        label: rider.label
      });
    }
  }
  return { advantage, disadvantage };
}

/** The flat item bonus to one saving throw: standing plus momentary. */
export function saveRiderBonus(derivation: EquipmentDerivation, ability: AbilityId): number {
  const momentary = collectRiders(derivation.carriers, { ...derivation.context, ability, moment: "on-saving-throw" });
  // `derivation.saveBonus` is the summed standing half; only momentary riders are added here.
  return derivation.saveBonus + sumRiders(momentary, "save-bonus");
}

const ABILITIES: readonly AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];

/** SRD 2024 stat blocks print "Success: Half damage."; without an explicit "no damage" success line, default to half. */
export function halfOnSuccessFrom(description: string): boolean {
  return !/success:?\s*(the target )?(takes? )?no\b/i.test(description);
}

const CONDITION_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bprone\b/i, "prone"],
  [/\bpoisoned\b/i, "poisoned"],
  [/\bparalyzed\b/i, "paralyzed"],
  [/\bstunned\b/i, "stunned"],
  [/\brestrained\b/i, "restrained"],
  [/\bgrappled\b/i, "grappled"],
  [/\bfrightened\b/i, "frightened"],
  [/\bblinded\b/i, "blinded"],
  [/\bcharmed\b/i, "charmed"],
  [/\bdeafened\b/i, "deafened"],
  [/\bincapacitated\b/i, "incapacitated"],
  [/\bpetrified\b/i, "petrified"],
  [/\bunconscious\b/i, "unconscious"]
];
/** Best-guess condition a failed save imposes, from the prose ("...or be Poisoned"); the answerer confirms it. */
export function conditionFrom(description: string): string | null {
  for (const [pattern, id] of CONDITION_WORDS) if (pattern.test(description)) return id;
  return null;
}

/** Save modifier without situational terms. Precedence: GM-typed `saveOverrides`, the sheet's
 *  `proficiencies.saves`, the open5e extension's monster totals, then the bare ability modifier. */
export function saveModifierFor(definition: ActorDefinition | undefined, ability: AbilityId): number {
  if (!definition) return 0;
  const proficiencies = definition.proficiencies;
  const override = proficiencies?.saveOverrides?.[ability];
  if (typeof override === "number") return override;
  // A sheet that records proficiencies is authoritative: an ability absent from `saves` is not proficient.
  if (proficiencies) {
    return (
      scoreModifier(definition.abilityScores[ability]) +
      (proficiencies.saves.includes(ability) ? definition.proficiencyBonus : 0)
    );
  }
  const extension = definition.extensions["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const fromExtension = (extension as { savingThrows?: Record<string, unknown> }).savingThrows?.[ability];
    if (
      typeof fromExtension === "number" &&
      Number.isInteger(fromExtension) &&
      fromExtension >= -20 &&
      fromExtension <= 30
    )
      return fromExtension;
  }
  return scoreModifier(definition.abilityScores[ability]);
}

/** Proficiency bonus when an item grants this save's proficiency and the sheet lacks it. */
export function saveProficiencyFromItems(
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  ability: AbilityId
): number {
  if (!definition) return 0;
  if (!derivation.saves.some((entry) => entry.id === ability)) return 0;
  if (definition.proficiencies?.saves.includes(ability)) return 0;
  return definition.proficiencyBonus;
}

/** The save total shared by the sheet's chip and `answerSave`. Cover is per-save, so not included. */
export function saveTotalFor(
  definition: ActorDefinition | undefined,
  actor: Actor | undefined,
  ability: AbilityId,
  derivation: EquipmentDerivation
): number {
  return (
    saveModifierFor(definition, ability) +
    saveProficiencyFromItems(definition, derivation, ability) +
    (actor ? exhaustionPenalty(actor) : 0) +
    saveRiderBonus(derivation, ability)
  );
}

/** Create one pending save per target when a save action resolves. Called inside the action:resolve mutation. */
export function createPendingSaves(
  state: GameState,
  input: Readonly<{
    sourceActorId: string;
    sourceName: string;
    actionName: string;
    ability: AbilityId;
    dc: number;
    targetIds: readonly string[];
    proposedDamage: number;
    proposedDamageParts?: ReadonlyArray<{ amount: number; type: string }>;
    halfOnSuccess: boolean;
    conditionId: string | null;
    saveBonus?: number;
    onFailEffect?: PendingSave["onFailEffect"];
    /** Replace an older prompt with the same (target, actionName, source) key. Default true; per-hit riders
     *  pass false since Extra Attack can owe two saves. */
    replaceExisting?: boolean;
    newSaveId: () => string;
    createdAt: number;
  }>
) {
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
    conditionId: input.conditionId,
    saveBonus: input.saveBonus ?? 0,
    ...(input.onFailEffect ? { onFailEffect: input.onFailEffect } : {}),
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

function recordSaveRoll(
  state: GameState,
  resolution: ReturnType<typeof resolveDice>,
  base: Readonly<{
    id: string;
    commandId: string;
    sessionId: string;
    role: "gm" | "player";
    label: string;
    saveLabel: string;
    actorId: string;
    visibility: "public" | "gm-only";
    createdAt: string;
  }>
) {
  let group = 0;
  const record: RollRecord = {
    id: base.id,
    commandId: base.commandId,
    initiatorSessionId: base.sessionId,
    initiatorRole: base.role,
    initiatorLabel: base.label,
    label: base.saveLabel,
    actorId: base.actorId,
    purpose: "save",
    visibility: base.visibility,
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    dice: resolution.terms.flatMap((term) => {
      if (term.kind !== "dice") return [];
      const currentGroup = group++;
      return term.dice.map((die) => ({
        group: currentGroup,
        sides: term.sides,
        face: die.face,
        kept: die.kept,
        sign: term.sign
      }));
    }),
    modifiers: resolution.terms
      .filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier")
      .map((term) => ({ value: term.value, sign: term.sign })),
    total: resolution.total,
    createdAt: base.createdAt
  };
  recordRollInHistory(state, record);
}

/** Answers a pending save (roll or typed total) and auto-applies it: fail takes full damage and the
 *  condition; success takes half if the action says so. The structured-save exception to
 *  propose-then-apply (ADR-0008). GM any save; a player only their own character's. */
export function answerSave(
  state: GameState,
  commandId: string,
  saveId: string,
  method: "roll" | "manual",
  manualTotal: number | undefined,
  commit: boolean,
  scope: ActorScope,
  deps: SaveAnswerDependencies,
  legendaryResistance = false,
  explicitRollMode?: "advantage" | "disadvantage" | "normal",
  damageOverride?: number
): { outcome: SaveOutcome; events: EffectNarration[] } {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter.");
  const pending = state.combat.pendingSaves.find((entry) => entry.id === saveId);
  if (!pending) throw new CommandRejectedError("That saving throw was already answered or dismissed.");
  const target = adjustableActor(state, pending.targetActorId, scope);
  if (!ABILITIES.includes(pending.ability)) throw new CommandRejectedError("That saving throw has an unknown ability.");

  let total: number;
  let autoFailed: string | null = null;
  let rollMode: AggregatedRollMode | undefined;
  if (method === "manual") {
    // The manual total is the GM escape hatch and bypasses auto-fail (a table may rule an exception).
    if (manualTotal === undefined || !Number.isInteger(manualTotal) || manualTotal < -20 || manualTotal > 60)
      throw new CommandRejectedError("Enter the rolled save total (a whole number from -20 to 60).");
    total = manualTotal;
  } else if ((pending.ability === "str" || pending.ability === "dex") && autoFailsPhysicalSaves(target) !== null) {
    // SRD: Paralyzed/Petrified/Stunned/Unconscious auto-fail Str/Dex saves; no die is rolled.
    autoFailed = autoFailsPhysicalSaves(target);
    total = 0;
  } else {
    const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
    const derivation = deriveEquipment(target, definition, deps.catalog);
    // Exhaustion (-2 x level, SRD 5.2.1) and item save bonuses come through `saveTotalFor`, shared with
    // the sheet's chip; cover's per-save bonus is added on top.
    const modifier = saveTotalFor(definition, target, pending.ability, derivation) + pending.saveBonus;
    const sources = saveRollSources(target, pending.ability, derivation);
    const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
    // An explicit choice (the answerer's button, or a forced "normal") wins over detected sources.
    const mode = explicitRollMode ?? aggregated.mode;
    const die = mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
    const resolution = resolveDice(
      parseDiceFormula(`${die} ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`),
      deps.random
    );
    if (mode !== "normal")
      rollMode = {
        mode,
        advantage: mode === "advantage" ? (aggregated.advantage.length > 0 ? aggregated.advantage : ["Chosen"]) : [],
        disadvantage:
          mode === "disadvantage" ? (aggregated.disadvantage.length > 0 ? aggregated.disadvantage : ["Chosen"]) : []
      };
    // The save roll lands in the shared history attributed to the target; hidden targets stay GM-only.
    recordSaveRoll(state, resolution, {
      id: deps.newRollId(),
      commandId,
      sessionId: deps.sessionId,
      role: deps.role,
      label: target.name,
      saveLabel: `${pending.ability.toUpperCase()} save`,
      actorId: target.id,
      visibility: target.visibility === "gm-only" ? "gm-only" : "public",
      createdAt: deps.now()
    });
    total = resolution.total;
  }

  let success = autoFailed === null && total >= pending.dc;
  // SRD Legendary Resistance: on a failed save the creature can choose to succeed. The GM commits with
  // the flag; the pool rides actionUses["legendary-resistance"] and a long rest re-arms it.
  let legendaryNote: string | null = null;
  if (legendaryResistance) {
    if (!commit) throw new CommandRejectedError("Commit the save to spend Legendary Resistance.");
    if (scope.role !== "gm") throw new CommandRejectedError("Only the GM can spend Legendary Resistance.");
    const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
    const perDay = definition?.legendary?.resistancesPerDay ?? 0;
    if (perDay === 0) throw new CommandRejectedError(`${target.name} has no Legendary Resistance.`);
    const spentSoFar = target.actionUses["legendary-resistance"] ?? 0;
    if (spentSoFar >= perDay)
      throw new CommandRejectedError(`${target.name} has no Legendary Resistance left (0 of ${perDay} remaining).`);
    // A natural success spends nothing.
    if (!success) {
      target.actionUses = { ...target.actionUses, "legendary-resistance": spentSoFar + 1 };
      success = true;
      autoFailed = null;
      legendaryNote = `${target.name} uses Legendary Resistance to succeed (${perDay - spentSoFar - 1} of ${perDay} remaining).`;
    }
  }
  // A hand-entered damage amendment, applied before the success halving. The proposal's damage types
  // are kept (`rescaleDamageParts`) so resistances still apply. Range is bounded by `SaveAnswerSchema`
  // and ownership by `adjustableActor` above.
  const proposedTotal = damageOverride ?? pending.proposedDamage;
  // Typed parts (ADR-0020) halve per part on success and run the defense pipeline; older saves fall
  // back to the untyped total.
  const proposed = pending.proposedDamageParts;
  const parts =
    proposed && proposed.length > 0 && damageOverride !== undefined
      ? rescaleDamageParts(proposed, damageOverride)
      : proposed;
  const outcomeParts =
    parts && parts.length > 0
      ? !success
        ? parts
        : pending.halfOnSuccess
          ? parts.map((part) => ({ ...part, amount: Math.floor(part.amount / 2) }))
          : []
      : null;
  const outcomeDamage =
    outcomeParts !== null
      ? outcomeParts.reduce((sum, part) => sum + part.amount, 0)
      : !success
        ? proposedTotal
        : pending.halfOnSuccess
          ? Math.floor(proposedTotal / 2)
          : 0;
  const outcomeCondition = !success && pending.conditionId !== null;

  // Preview (commit=false): the roll is recorded so everyone sees it, but nothing is applied and the
  // save stays open until the answerer confirms.
  if (!commit)
    return {
      outcome: {
        success,
        total,
        dc: pending.dc,
        appliedDamage: outcomeDamage,
        conditionApplied: outcomeCondition,
        committed: false,
        autoFailed,
        ...(rollMode ? { rollMode } : {})
      },
      events: []
    };

  const events: EffectNarration[] = [];
  if (legendaryNote !== null) events.push({ kind: "effect", text: legendaryNote, actorId: target.id });
  if (autoFailed !== null)
    events.push({
      kind: "condition",
      text: `${target.name} automatically fails the ${pending.ability.toUpperCase()} save (${conditionLabel(autoFailed)}).`,
      actorId: target.id
    });
  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  let conditionApplied = false;
  if (outcomeDamage > 0) {
    const outcome = applyDamageDetailed(
      state,
      target.id,
      outcomeParts !== null ? { amount: outcomeDamage, parts: outcomeParts } : { amount: outcomeDamage },
      { role: "gm" },
      {
        resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId),
        newId: deps.newRollId,
        now: deps.now,
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      }
    );
    appliedDamage = outcome.application.totalApplied;
    // Keep the whole application, not just its total.
    application = outcome.application;
    events.push(...outcome.events);
  }
  if (outcomeCondition && pending.conditionId) {
    // setCondition narrates immunity skips; whether the condition landed is read back.
    events.push(
      ...setCondition(
        state,
        target.id,
        pending.conditionId,
        true,
        undefined,
        { role: "gm" },
        {
          resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId),
          ...(deps.catalog ? { catalog: deps.catalog } : {})
        }
      )
    );
    conditionApplied = target.conditions.some((condition) => condition.id === pending.conditionId);
  }
  // A committed failed concentration check ends the sustained effects (SRD Concentration); tolerant of
  // effects already gone.
  if (!success && pending.endsEffects) {
    for (const reference of pending.endsEffects)
      events.push(...endEffectIfPresent(state, reference.actorId, reference.effectId));
  }
  // A committed failure applies the declared source-linked effect (Unarmed Strike Grapple, ADR-0020).
  if (!success && pending.onFailEffect) {
    const applied = addEffect(state, target.id, {
      id: `${commandId}:${saveId}:fail`,
      name: pending.onFailEffect.name,
      tags: [...pending.onFailEffect.tags],
      sourceActorId: pending.onFailEffect.sourceActorId,
      sourceName: pending.onFailEffect.sourceName,
      sourceActionId: null,
      startedRound: state.combat.round,
      duration: { type: "manual" },
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: false,
      concentration: false,
      modifiers: [],
      linkedConditionIds: [...pending.onFailEffect.linkedConditionIds],
      escapeDc: pending.onFailEffect.escapeDc,
      onEnd: [],
      endsWithTag: null
    });
    events.push({ kind: "effect", text: `${target.name} is ${applied.name}.`, actorId: target.id });
  }
  state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.filter((entry) => entry.id !== saveId) };
  return {
    outcome: {
      success,
      total,
      dc: pending.dc,
      appliedDamage,
      conditionApplied,
      committed: true,
      autoFailed,
      ...(rollMode ? { rollMode } : {}),
      ...(application
        ? {
            parts: application.parts,
            ...(application.flatReduction ? { flatReduction: application.flatReduction } : {})
          }
        : {})
    },
    events
  };
}

/** Drop a pending save without resolving it (GM housekeeping - e.g. the effect ended). */
export function dismissSave(state: GameState, saveId: string, scope: ActorScope) {
  if (scope.role !== "gm") throw new CommandRejectedError("Only the GM can dismiss a saving throw.");
  if (!state.combat.pendingSaves.some((entry) => entry.id === saveId))
    throw new CommandRejectedError("That saving throw was already answered or dismissed.");
  state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.filter((entry) => entry.id !== saveId) };
}
