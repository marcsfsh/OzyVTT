import type { AbilityId, GameState, PendingSave, RollRecord } from "@vtt/domain";
import { parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { applyDamageDetailed, adjustableActor, type ActorScope } from "./hit-points.js";
import { setCondition } from "./actor-conditions.js";

export type SaveAnswerDependencies = Readonly<{
  random: RandomSource;
  newRollId: () => string;
  sessionId: string;
  role: "gm" | "player";
  now: () => string;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
}>;
export type SaveOutcome = Readonly<{ success: boolean; total: number; dc: number; appliedDamage: number; conditionApplied: boolean; committed: boolean }>;

const ABILITIES: readonly AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];

/** SRD 2024 stat blocks phrase the success line as "Success: Half damage." — absence of an explicit "no damage/effect" success keeps the safer half-damage default. */
export function halfOnSuccessFrom(description: string): boolean {
  return !/success:?\s*(the target )?(takes? )?no\b/i.test(description);
}

const CONDITION_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bprone\b/i, "prone"], [/\bpoisoned\b/i, "poisoned"], [/\bparalyzed\b/i, "paralyzed"], [/\bstunned\b/i, "stunned"],
  [/\brestrained\b/i, "restrained"], [/\bgrappled\b/i, "grappled"], [/\bfrightened\b/i, "frightened"], [/\bblinded\b/i, "blinded"],
  [/\bcharmed\b/i, "charmed"], [/\bdeafened\b/i, "deafened"], [/\bincapacitated\b/i, "incapacitated"], [/\bpetrified\b/i, "petrified"],
  [/\bunconscious\b/i, "unconscious"]
];
/**
 * Best-guess condition a failed save imposes, read from the action's prose (SRD save actions name it
 * plainly: "…or be Poisoned"). The answerer sees "+ condition" and confirms before it applies, so a
 * false positive is visible and reversible. Null when none is clearly named. Validate the id before use.
 */
export function conditionFrom(description: string): string | null {
  for (const [pattern, id] of CONDITION_WORDS) if (pattern.test(description)) return id;
  return null;
}

/**
 * Best-known save modifier for a target. Monsters carry final per-ability save bonuses in the
 * (untyped) open5e extension; anything else falls back to the ability modifier from the definition's
 * scores. Imported PCs don't encode save proficiencies (not in ActorDefinitionSchema), so a proficient
 * PC save is the manual-total path's job — documented limitation, not a bug.
 */
export function saveModifierFor(definition: ActorDefinition | undefined, ability: AbilityId): number {
  if (!definition) return 0;
  const extension = definition.extensions["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const fromExtension = (extension as { savingThrows?: Record<string, unknown> }).savingThrows?.[ability];
    if (typeof fromExtension === "number" && Number.isInteger(fromExtension) && fromExtension >= -20 && fromExtension <= 30) return fromExtension;
  }
  const score = definition.abilityScores[ability];
  return Math.floor((score - 10) / 2);
}

/** Create one pending save per target when a save action resolves. Called inside the action:resolve mutation. */
export function createPendingSaves(state: GameState, input: Readonly<{
  sourceActorId: string; sourceName: string; actionName: string; ability: AbilityId; dc: number;
  targetIds: readonly string[]; proposedDamage: number; proposedDamageParts?: ReadonlyArray<{ amount: number; type: string }>; halfOnSuccess: boolean; conditionId: string | null;
  newSaveId: () => string; createdAt: number;
}>) {
  const additions: PendingSave[] = input.targetIds.map((targetActorId) => ({
    id: input.newSaveId(),
    targetActorId,
    ability: input.ability,
    dc: input.dc,
    sourceActorId: input.sourceActorId,
    sourceName: input.sourceName,
    actionName: input.actionName,
    proposedDamage: input.proposedDamage,
    ...(input.proposedDamageParts && input.proposedDamageParts.length > 0 ? { proposedDamageParts: [...input.proposedDamageParts] } : {}),
    halfOnSuccess: input.halfOnSuccess,
    conditionId: input.conditionId,
    createdAt: input.createdAt
  }));
  // A re-cast against the same target replaces its older prompt (one owed save per target per source action keeps the tracker readable).
  const remaining = state.combat.pendingSaves.filter((entry) => !additions.some((added) => added.targetActorId === entry.targetActorId && added.actionName === entry.actionName && added.sourceActorId === entry.sourceActorId));
  const pendingSaves = [...remaining, ...additions];
  if (pendingSaves.length > 100) throw new CommandRejectedError("Too many unanswered saving throws. Resolve or dismiss some first.");
  state.combat = { ...state.combat, pendingSaves };
}

function recordSaveRoll(state: GameState, resolution: ReturnType<typeof resolveDice>, base: Readonly<{ id: string; commandId: string; sessionId: string; role: "gm" | "player"; label: string; actorId: string; visibility: "public" | "gm-only"; createdAt: string }>) {
  let group = 0;
  const record: RollRecord = {
    id: base.id,
    commandId: base.commandId,
    initiatorSessionId: base.sessionId,
    initiatorRole: base.role,
    initiatorLabel: base.label,
    actorId: base.actorId,
    purpose: "save",
    visibility: base.visibility,
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    dice: resolution.terms.flatMap((term) => {
      if (term.kind !== "dice") return [];
      const currentGroup = group++;
      return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign }));
    }),
    modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
    total: resolution.total,
    createdAt: base.createdAt
  };
  state.rolls.push(record);
  if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
}

/**
 * Answer a pending save: roll d20 + best-known modifier (or take a typed total), then AUTO-APPLY the
 * outcome — fail: full proposed damage + condition; success: half damage if the action says so, no
 * condition. The owner-approved exception to the propose→apply ladder for structured saves
 * (ADR-0008's structured attack/save/damage carve-out). GM answers any save; a player only their own
 * claimed character's.
 */
export function answerSave(state: GameState, commandId: string, saveId: string, method: "roll" | "manual", manualTotal: number | undefined, commit: boolean, scope: ActorScope, deps: SaveAnswerDependencies): SaveOutcome {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter.");
  const pending = state.combat.pendingSaves.find((entry) => entry.id === saveId);
  if (!pending) throw new CommandRejectedError("That saving throw was already answered or dismissed.");
  const target = adjustableActor(state, pending.targetActorId, scope);
  if (!ABILITIES.includes(pending.ability)) throw new CommandRejectedError("That saving throw has an unknown ability.");

  let total: number;
  if (method === "manual") {
    if (manualTotal === undefined || !Number.isInteger(manualTotal) || manualTotal < -20 || manualTotal > 60) throw new CommandRejectedError("Enter the rolled save total (a whole number from -20 to 60).");
    total = manualTotal;
  } else {
    const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
    const modifier = saveModifierFor(definition, pending.ability);
    const resolution = resolveDice(parseDiceFormula(`1d20 ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`), deps.random);
    // The save roll lands in the shared history attributed to the target; hidden targets stay GM-only.
    recordSaveRoll(state, resolution, {
      id: deps.newRollId(), commandId, sessionId: deps.sessionId, role: deps.role, label: target.name, actorId: target.id,
      visibility: target.visibility === "gm-only" ? "gm-only" : "public", createdAt: deps.now()
    });
    total = resolution.total;
  }

  const success = total >= pending.dc;
  // Typed parts (ADR-0020) halve per part on success and run the defense pipeline on application;
  // saves persisted before the field fall back to the untyped total.
  const parts = pending.proposedDamageParts;
  const outcomeParts = parts && parts.length > 0
    ? (!success ? parts : pending.halfOnSuccess ? parts.map((part) => ({ ...part, amount: Math.floor(part.amount / 2) })) : [])
    : null;
  const outcomeDamage = outcomeParts !== null
    ? outcomeParts.reduce((sum, part) => sum + part.amount, 0)
    : (!success ? pending.proposedDamage : (pending.halfOnSuccess ? Math.floor(pending.proposedDamage / 2) : 0));
  const outcomeCondition = !success && pending.conditionId !== null;

  // Preview (commit=false): the die roll is still recorded for the table so everyone sees it, but the
  // outcome is NOT applied and the save stays open until the answerer confirms. This makes "Roll" a
  // reveal, not an auto-resolve — the answerer then commits (manual with the rolled total).
  if (!commit) return { success, total, dc: pending.dc, appliedDamage: outcomeDamage, conditionApplied: outcomeCondition, committed: false };

  let appliedDamage = 0;
  let conditionApplied = false;
  if (outcomeDamage > 0) {
    const outcome = applyDamageDetailed(state, target.id, outcomeParts !== null ? { amount: outcomeDamage, parts: outcomeParts } : { amount: outcomeDamage }, { role: "gm" }, { resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId) });
    appliedDamage = outcome.application.totalApplied;
  }
  if (outcomeCondition && pending.conditionId) { setCondition(state, target.id, pending.conditionId, true, undefined, { role: "gm" }); conditionApplied = true; }
  state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.filter((entry) => entry.id !== saveId) };
  return { success, total, dc: pending.dc, appliedDamage, conditionApplied, committed: true };
}

/** Drop a pending save without resolving it (GM housekeeping — e.g. the effect ended). */
export function dismissSave(state: GameState, saveId: string, scope: ActorScope) {
  if (scope.role !== "gm") throw new CommandRejectedError("Only the GM can dismiss a saving throw.");
  if (!state.combat.pendingSaves.some((entry) => entry.id === saveId)) throw new CommandRejectedError("That saving throw was already answered or dismissed.");
  state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.filter((entry) => entry.id !== saveId) };
}
