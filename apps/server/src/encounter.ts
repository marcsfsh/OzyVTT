import type {
  ActorDefinition,
  EncounterStartEntry,
  GameState,
  InitiativeEntry,
  RuleExceptions,
  RuleMode
} from "@vtt/domain";
import { assertNotArchived } from "./actor-roster.js";
import { CommandRejectedError } from "./game-store.js";
import { aggregateRollMode } from "@vtt/rules-5e";
import { deriveEquipment, rollModeClaims, type EquipmentCatalog } from "./equipment-derivation.js";
import { effectiveActions } from "./effective-actions.js";
import {
  endConcentrationSustainedBy,
  endEffect,
  endEffectsSustainedBy,
  expireEffectsAtTurnStart,
  type EffectNarration
} from "./effects.js";
import { releaseSwallowedBy } from "./swallow.js";
import { endOfTurn, startOfTurn } from "./turn-boundaries.js";
import { createEncounterTokens, type TokenMapGeometry } from "./token-placement.js";
import { conditionLabel, exhaustionPenalty, incapacitatingCondition } from "./condition-rules.js";

type StartEncounterInput = Readonly<{
  mapAssetId: string;
  entries: readonly EncounterStartEntry[];
  rulesMode?: RuleMode;
  /** Per-family exceptions for this fight; omitted keeps whatever the seeded/previous fight carried. */
  ruleExceptions?: RuleExceptions;
  /** When true, each claimed player-character without an explicit score gets a provisional auto-roll and is
   * parked in `pendingInitiative` for its owner to roll (combat.playerInitiativeMode picks immediate/wait). */
  playersRollInitiative?: boolean;
  /** SRD: one roll for each group of identical monsters (same stat block), so the group acts together. */
  groupMonsters?: boolean;
}>;

const EMPTY_TURN = {
  actionUsed: false,
  bonusActionUsed: false,
  actionInstance: null,
  bonusActionInstance: null,
  turnUses: {},
  movementUsedFeet: 0
} as const;

/** A fresh fight refreshes per-encounter pools (Frenzy), recharge pools (a dragon's breath starts ready) and uses that
 *  come back with the bearer's turn (Peerless Aim); long-rest pools persist. */
function clearPerEncounterUses(
  state: GameState,
  combatantIds: ReadonlySet<string>,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  catalog?: EquipmentCatalog
) {
  for (const actor of state.actors) {
    if (!combatantIds.has(actor.id) || !actor.definitionId) continue;
    const definition = resolveDefinition(actor.definitionId);
    if (!definition) continue;
    for (const action of effectiveActions(definition, actor, catalog)) {
      if (action.uses?.per !== "encounter" && action.uses?.per !== "recharge" && action.uses?.per !== "own-turn")
        continue;
      const key = action.uses.pool ?? action.id;
      if (actor.actionUses[key] !== undefined) {
        const { [key]: _cleared, ...rest } = actor.actionUses;
        actor.actionUses = rest;
      }
    }
  }
}

const validScore = (value: number) => Number.isInteger(value) && value >= -1000 && value <= 1000;

type RollMode = "advantage" | "disadvantage" | "normal";

/** What an initiative roll looks up about its roller; optional so scene bookkeeping can roll without content. */
export type InitiativeRollDeps = Readonly<{
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/**
 * The roll mode and penalty of one combatant's initiative (a Dexterity check, so a D20 Test). Advantage comes
 * from `roll-mode {roll: "initiative"}` riders (Feral Instinct, items) and Invisible; Disadvantage from riders,
 * Surprise and any Incapacitated condition. 2024 cancellation applies via `aggregateRollMode`: any Advantage
 * plus any Disadvantage is a normal roll. Exhaustion takes 2 per level off the total.
 */
export function initiativeRollFor(
  state: GameState,
  actorId: string,
  surprised: boolean,
  deps: InitiativeRollDeps = {}
): { mode: RollMode; penalty: number; reasons: string[] } {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return { mode: "normal", penalty: 0, reasons: [] };
  const definition = actor.definitionId ? deps.resolveDefinition?.(actor.definitionId) : undefined;
  const claims = rollModeClaims(deriveEquipment(actor, definition, deps.catalog), ["initiative"], "on-initiative-roll");
  if (actor.conditions.some((condition) => condition.id === "invisible"))
    claims.advantage.push({ source: "invisible", label: "Invisible" });
  if (surprised) claims.disadvantage.push({ source: "surprised", label: "Surprised" });
  const incapacitated = incapacitatingCondition(actor);
  if (incapacitated) claims.disadvantage.push({ source: "incapacitated", label: conditionLabel(incapacitated) });
  const penalty = exhaustionPenalty(actor);
  const reasons = [...claims.advantage, ...claims.disadvantage].map((claim) => claim.label);
  if (penalty !== 0) reasons.push(`Exhaustion ${penalty}`);
  return { mode: aggregateRollMode(claims.advantage, claims.disadvantage).mode, penalty, reasons };
}

/** The roll mode alone, from riders and conditions, for a combatant who isn't surprised. */
export function initiativeRollMode(
  state: GameState,
  actorId: string,
  resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined,
  catalog: EquipmentCatalog | undefined
): RollMode {
  return initiativeRollFor(state, actorId, false, { resolveDefinition, catalog }).mode;
}

/** Told about every initiative die the server rolls, so the caller can put it in the table feed.
 *  Carries no session knowledge: the command layer decides attribution. */
export type InitiativeRollSink = (
  roll: Readonly<{
    actorId: string;
    natural: number;
    modifier: number;
    total: number;
    mode: "advantage" | "disadvantage" | "normal";
  }>
) => void;

/** Roll one initiative d20 under an aggregated roll mode. */
function rollUnderMode(rollD20: () => number, mode: RollMode): number {
  if (mode === "advantage") return Math.max(rollD20(), rollD20());
  if (mode === "disadvantage") return Math.min(rollD20(), rollD20());
  return rollD20();
}

/** One combatant's initiative: the d20 (rolled, or a hand-typed `natural`) plus its modifier and the
 *  Exhaustion penalty. Every path that rolls initiative goes through here, so they all follow the same rules. */
function rollInitiative(
  state: GameState,
  actorId: string,
  surprised: boolean,
  rollD20: () => number,
  deps: InitiativeRollDeps,
  natural?: number
): { natural: number; modifier: number; total: number; mode: RollMode } {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const { mode, penalty } = initiativeRollFor(state, actorId, surprised, deps);
  const die = natural ?? rollUnderMode(rollD20, mode);
  const modifier = (actor?.initiative ?? 0) + penalty;
  const total = die + modifier;
  if (!validScore(total)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
  return { natural: die, modifier, total, mode };
}

function ordered(state: GameState, entries: readonly InitiativeEntry[]) {
  const names = new Map(state.actors.map((actor) => [actor.id, actor.name]));
  return [...entries].sort(
    (left, right) =>
      right.score - left.score ||
      right.tieBreaker - left.tieBreaker ||
      (names.get(left.actorId) ?? "").localeCompare(names.get(right.actorId) ?? "") ||
      left.actorId.localeCompare(right.actorId)
  );
}

/**
 * The order after a score changes mid-round. Re-sorting outright could move a combatant across the current
 * turn, so one who already acted would act again or one who hadn't would be skipped. Those who have acted stay
 * ahead of the current turn and the rest stay behind it, each part in score order; the next round sorts fully.
 */
function reorderMidRound(state: GameState, entries: readonly InitiativeEntry[]) {
  const { active, turnActorId, initiative, playerInitiativeMode, pendingInitiative } = state.combat;
  const gathering = playerInitiativeMode === "wait" && pendingInitiative.length > 0;
  const current = initiative.findIndex((entry) => entry.actorId === turnActorId);
  if (!active || gathering || current < 0) return ordered(state, entries);
  const acted = new Set(initiative.slice(0, current).map((entry) => entry.actorId));
  return [
    ...ordered(
      state,
      entries.filter((entry) => acted.has(entry.actorId))
    ),
    ...entries.filter((entry) => entry.actorId === turnActorId),
    ...ordered(
      state,
      entries.filter((entry) => !acted.has(entry.actorId) && entry.actorId !== turnActorId)
    )
  ];
}

export function startEncounter(
  state: GameState,
  input: StartEncounterInput,
  rollD20: () => number,
  tokenGeometry: TokenMapGeometry,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined,
  now: number = Date.now(),
  catalog?: EquipmentCatalog,
  onRoll?: InitiativeRollSink
) {
  if (state.combat.active) throw new CommandRejectedError("End the active encounter before starting another one.");
  if (input.entries.length === 0 || input.entries.length > 200)
    throw new CommandRejectedError("Choose 1 to 200 combatants before starting the encounter.");
  // When a prepared scene is live, the encounter must run on that scene's map so park/resume stays coherent.
  if (state.combat.activeSceneId !== null) {
    const activeScene = state.combat.scenes.find((scene) => scene.id === state.combat.activeSceneId);
    if (activeScene && activeScene.mapAssetId !== input.mapAssetId)
      throw new CommandRejectedError(
        "This scene uses a different map. Start on the scene's map, or switch scenes first."
      );
  }
  // Preserve any positions already placed during scene prep (or a prior setup); new combatants start unplaced.
  const placedPositions = new Map(state.combat.tokens.map((token) => [token.actorId, token.position]));
  const actorIds = new Set<string>();
  // Claimed PCs whose owner will roll their own initiative: the auto-roll below is provisional until the
  // player rolls (immediate mode), or the fallback if the GM rolls the rest (wait mode).
  const pendingInitiative: string[] = [];
  // Identical monsters share one die when the GM rolls by group; keyed by stat block and Surprise.
  const groupDice = new Map<string, number>();
  const initiative = input.entries.map((entry) => {
    if (actorIds.has(entry.actorId)) throw new CommandRejectedError("Each actor can appear in Initiative only once.");
    actorIds.add(entry.actorId);
    const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!actor) throw new CommandRejectedError("One of the selected combatants no longer exists.");
    // An archived character is out of play; enforced here, not just by the picker.
    assertNotArchived(state, entry.actorId);
    actor.lastUsedAt = now; // recency for the scene-setup "Recent" list (GM-only)
    const tieBreaker = actor.initiative ?? 0;
    const surprised = entry.surprised === true;
    const flags = surprised ? { surprised } : {};
    if (entry.score !== undefined) {
      if (!validScore(entry.score))
        throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
      return { actorId: actor.id, score: entry.score, tieBreaker, ...flags };
    }
    const groupKey =
      input.groupMonsters && actor.kind === "monster" && actor.definitionId
        ? `${actor.definitionId}|${surprised}`
        : null;
    const shared = groupKey === null ? undefined : groupDice.get(groupKey);
    const roll = rollInitiative(state, actor.id, surprised, rollD20, { resolveDefinition, catalog }, shared);
    // A group's die reaches the feed once, on its first member.
    if (shared === undefined) onRoll?.({ actorId: actor.id, ...roll });
    if (groupKey !== null && shared === undefined) groupDice.set(groupKey, roll.natural);
    if (input.playersRollInitiative && actor.kind === "player-character" && actor.ownerSessionId !== null)
      pendingInitiative.push(actor.id);
    return { actorId: actor.id, score: roll.total, tieBreaker, ...flags };
  });
  const sorted = ordered(state, initiative);
  // Spread, never a fresh literal, so fields added to CombatState are not dropped. Fog rides the spread:
  // it is prepped before the fight and persists after it.
  state.combat = {
    ...state.combat,
    active: true,
    round: 1,
    turnActorId: sorted[0].actorId,
    mapAssetId: input.mapAssetId,
    initiative: sorted,
    tokens: createEncounterTokens(
      sorted.map((entry) => {
        const source = state.actors.find((actor) => actor.id === entry.actorId);
        return { actorId: entry.actorId, sizeCells: source?.sizeCells ?? 1, size: source?.size };
      }),
      tokenGeometry
    ).map((token) => ({ ...token, position: placedPositions.get(token.actorId) ?? token.position })),
    annotations: [],
    turn: { ...EMPTY_TURN },
    rulesMode: input.rulesMode ?? state.combat.rulesMode,
    ruleExceptions: input.ruleExceptions ?? state.combat.ruleExceptions,
    underwater: false,
    reactionsUsed: [],
    legendaryUsed: {},
    pendingSaves: [],
    pendingReactions: [],
    pendingDamage: [],
    // Asks parked in the last fight concern a situation that no longer exists.
    pendingRuleAsks: [],
    pendingInitiative,
    // A fresh fight starts live; the handler captures this start state as the rewind baseline.
    historyCursor: null,
    historyDirty: false
  };
  if (resolveDefinition) clearPerEncounterUses(state, actorIds, resolveDefinition, catalog);
}

/**
 * The GM takes a combatant out of a running fight (it fled, was dismissed, or lies dead and is in the way): its
 * initiative entry, token and prompts go, and what it sustains ends - its grapples and Concentration, what lasts only
 * until its next turn, and a creature it swallowed climbs out. The caller advances the turn first when it is this
 * combatant's (so the history records the boundary).
 */
export function removeCombatant(
  state: GameState,
  actorId: string,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): EffectNarration[] {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before taking a combatant out of it.");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || !state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("That combatant is not in this encounter.");
  if (state.combat.initiative.length === 1)
    throw new CommandRejectedError("It is the last combatant - end the encounter instead.");
  if (state.combat.turnActorId === actorId)
    throw new CommandRejectedError("Advance past its turn before taking it out of the fight.");
  const events: EffectNarration[] = [
    ...releaseSwallowedBy(state, actorId, actor.definitionId ? resolveDefinition(actor.definitionId) : undefined),
    ...endEffectsSustainedBy(state, actorId),
    ...endConcentrationSustainedBy(state, actorId)
  ];
  // Its turns won't come again, so what lasts until one of them (a Help, Vex, a "until the end of its next turn")
  // ends now.
  for (const bearer of state.actors)
    for (const effect of [...bearer.effects])
      if (
        effect.sourceActorId === actorId &&
        bearer.id !== actorId &&
        (effect.duration.type === "until-source-next-turn" || effect.duration.type === "until-source-turn-end") &&
        bearer.effects.some((candidate) => candidate.id === effect.id)
      )
        events.push(...endEffect(state, bearer.id, effect.id));
  const others = (id: string | null | undefined) => id !== actorId;
  state.combat = {
    ...state.combat,
    initiative: state.combat.initiative.filter((entry) => others(entry.actorId)),
    tokens: state.combat.tokens.filter((token) => others(token.actorId)),
    pendingInitiative: state.combat.pendingInitiative.filter(others),
    reactionsUsed: state.combat.reactionsUsed.filter(others),
    legendaryUsed: legendaryRefilled(state.combat.legendaryUsed, actorId),
    // Its own reactions go, and so do opportunity attacks against it; damage it dealt stays owed.
    pendingReactions: state.combat.pendingReactions.filter(
      (prompt) => others(prompt.actorId) && !(prompt.kind === "leaves-reach" && prompt.targetActorId === actorId)
    ),
    pendingSaves: state.combat.pendingSaves.filter((save) => others(save.targetActorId))
  };
  return events;
}

/** Drops a new combatant into a running encounter: rolls (or takes) its initiative, re-sorts, and places its
 *  token. It joins fresh, like everyone at the start: per-encounter and recharge pools are ready. GM-only at the
 *  command layer. */
export function addCombatant(
  state: GameState,
  actorId: string,
  score: number | undefined,
  rollD20: () => number,
  tokenGeometry: TokenMapGeometry,
  now: number = Date.now(),
  onRoll?: InitiativeRollSink,
  deps: InitiativeRollDeps = {}
) {
  if (!state.combat.active) throw new CommandRejectedError("Start the encounter before adding a combatant to it.");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  assertNotArchived(state, actorId);
  if (state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("That combatant is already in the encounter.");
  if (state.combat.initiative.length >= 200)
    throw new CommandRejectedError("This encounter already has 200 combatants.");
  const tieBreaker = actor.initiative ?? 0;
  let rolled: number;
  if (score === undefined) {
    const roll = rollInitiative(state, actorId, false, rollD20, deps);
    onRoll?.({ actorId, ...roll });
    rolled = roll.total;
  } else {
    if (!validScore(score))
      throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
    rolled = score;
  }
  actor.lastUsedAt = now; // recency for the scene-setup "Recent" list (GM-only)
  // A joiner takes its place by count: one whose count has passed this round waits for the next.
  state.combat = {
    ...state.combat,
    initiative: ordered(state, [...state.combat.initiative, { actorId, score: rolled, tieBreaker }]),
    tokens: [
      ...state.combat.tokens,
      ...createEncounterTokens([{ actorId, sizeCells: actor.sizeCells ?? 1, size: actor.size }], tokenGeometry)
    ]
  };
  if (deps.resolveDefinition) clearPerEncounterUses(state, new Set([actorId]), deps.resolveDefinition, deps.catalog);
}

export function endEncounter(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter to end.");
  // Ending mid-review would strand the timeline pointing at a fight that no longer exists.
  if (state.combat.historyCursor !== null)
    throw new CommandRejectedError(
      "Finish reviewing the combat history before ending the encounter.",
      "history_review"
    );
  // Fog persists: what the party revealed stays revealed after the fight.
  state.combat = {
    ...state.combat,
    active: false,
    turnActorId: null,
    turn: { ...EMPTY_TURN },
    underwater: false,
    reactionsUsed: [],
    legendaryUsed: {},
    pendingSaves: [],
    pendingReactions: [],
    pendingDamage: [],
    pendingRuleAsks: [],
    pendingInitiative: [],
    historyCursor: null,
    historyDirty: false
  };
}

export function setInitiativeScore(state: GameState, actorId: string, score: number, tieBreaker?: number) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before changing Initiative.");
  if (!validScore(score)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("That actor is not in this encounter.");
  // A GM-set score clears that actor's pending roll, and in wait mode may complete the gather.
  const initiative = reorderMidRound(
    state,
    state.combat.initiative.map((entry) =>
      entry.actorId === actorId ? { ...entry, score, ...(tieBreaker === undefined ? {} : { tieBreaker }) } : entry
    )
  );
  state.combat = {
    ...state.combat,
    initiative,
    pendingInitiative: state.combat.pendingInitiative.filter((id) => id !== actorId)
  };
  settleGatherIfComplete(state);
}

/** SRD Alert, Initiative Swap: right after initiative is rolled, two combatants trade scores. Not while either
 *  is Incapacitated, and only before the first of them has taken a turn in this fight. */
export function swapInitiative(state: GameState, actorId: string, withActorId: string) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before swapping Initiative.");
  if (actorId === withActorId) throw new CommandRejectedError("Pick another combatant to swap with.");
  const entries = [actorId, withActorId].map((id) => state.combat.initiative.find((entry) => entry.actorId === id));
  if (entries.some((entry) => entry === undefined))
    throw new CommandRejectedError("Both combatants must be in this encounter.");
  for (const id of [actorId, withActorId]) {
    const actor = state.actors.find((candidate) => candidate.id === id);
    const condition = actor ? incapacitatingCondition(actor) : null;
    if (actor && condition)
      throw new CommandRejectedError(`${actor.name} can't swap Initiative while ${conditionLabel(condition)}.`);
  }
  const current = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  const actedAlready = (id: string) => {
    const index = state.combat.initiative.findIndex((entry) => entry.actorId === id);
    return state.combat.round > 1 || index < current;
  };
  if (actedAlready(actorId) || actedAlready(withActorId))
    throw new CommandRejectedError(
      "Initiative Swap happens right after initiative is rolled, before either has acted."
    );
  const [first, second] = entries as InitiativeEntry[];
  const swapped = state.combat.initiative.map((entry) =>
    entry.actorId === actorId
      ? { ...entry, score: second.score, tieBreaker: second.tieBreaker }
      : entry.actorId === withActorId
        ? { ...entry, score: first.score, tieBreaker: first.tieBreaker }
        : entry
  );
  state.combat = { ...state.combat, initiative: reorderMidRound(state, swapped) };
}

/** A claimed player rolls their own initiative (or supplies `natural`, a physical die) and clears their
 *  pending flag; in wait mode the last roll begins turns. The rules decide the roll mode: a player can't pick
 *  Advantage. `rollMode` is a GM-grade override. Returns the final score. */
export function rollSelfInitiative(
  state: GameState,
  actorId: string,
  options: Readonly<{ natural?: number; rollMode?: RollMode }>,
  rollD20: () => number,
  onRoll?: InitiativeRollSink,
  deps: InitiativeRollDeps = {}
): number {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before rolling Initiative.");
  const entry = state.combat.initiative.find((candidate) => candidate.actorId === actorId);
  if (!entry) throw new CommandRejectedError("That actor is not in this encounter.");
  if (!state.combat.pendingInitiative.includes(actorId))
    throw new CommandRejectedError("Your initiative is already set.");
  const override = options.rollMode;
  const natural = options.natural ?? (override ? rollUnderMode(rollD20, override) : undefined);
  const roll = rollInitiative(state, actorId, entry.surprised === true, rollD20, deps, natural);
  // A hand-typed `natural` is a die the server never threw, so only server rolls reach the feed.
  if (options.natural === undefined) onRoll?.({ actorId, ...roll, mode: override ?? roll.mode });
  const initiative = reorderMidRound(
    state,
    state.combat.initiative.map((candidate) =>
      candidate.actorId === actorId ? { ...candidate, score: roll.total } : candidate
    )
  );
  state.combat = {
    ...state.combat,
    initiative,
    pendingInitiative: state.combat.pendingInitiative.filter((id) => id !== actorId)
  };
  settleGatherIfComplete(state);
  return roll.total;
}

/** The GM settles every pending player roll, beginning a wait-mode fight. The provisional rolls made at the
 *  start already followed the rules and are in the feed, so they stand rather than being rolled again. */
export function rollRemainingInitiative(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before rolling Initiative.");
  if (state.combat.pendingInitiative.length === 0) return;
  state.combat = { ...state.combat, pendingInitiative: [] };
  settleGatherIfComplete(state);
}

/** In wait mode, once every player has rolled (pendingInitiative empties) the fight actually begins: turns
 *  start on the now-final order from the top of round 1. Immediate mode never gathers, so this is a no-op there. */
function settleGatherIfComplete(state: GameState) {
  if (
    state.combat.playerInitiativeMode !== "wait" ||
    state.combat.pendingInitiative.length > 0 ||
    state.combat.initiative.length === 0
  )
    return;
  const top = ordered(state, state.combat.initiative)[0].actorId;
  if (state.combat.turnActorId === top && state.combat.round === 1) return;
  state.combat = { ...state.combat, turnActorId: top, round: 1, turn: { ...EMPTY_TURN } };
}

/** Dependencies for start-of-turn recharge rolls and ongoing damage and end-of-turn repeat saves; optional so scene
 *  bookkeeping can advance turns without them. */
export type TurnAdvanceDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog, so an item's recharge pool re-arms like a stat block's. */
  catalog?: EquipmentCatalog;
  rollDie: (sides: number) => number;
  /** Mint the repeat saves the ending turn opens; absent, effects still expire but no save is opened. */
  newId?: () => string;
  now?: () => string;
}>;

/** SRD Recharge X-Y: at the start of the owner's turn, a d6 at or above the threshold re-arms the spent
 *  pool. Rolled automatically (the SRD makes it automatic) and narrated with the die. One roll per pool. */
function rollRecharges(state: GameState, actorId: string, deps: TurnAdvanceDeps, events?: EffectNarration[]) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor?.definitionId) return;
  const definition = deps.resolveDefinition(actor.definitionId);
  if (!definition) return;
  const rolledPools = new Set<string>();
  for (const action of effectiveActions(definition, actor, deps.catalog)) {
    if (action.uses?.per !== "recharge" || action.uses.recharge === undefined) continue;
    const key = action.uses.pool ?? action.id;
    if (rolledPools.has(key) || (actor.actionUses[key] ?? 0) === 0) continue;
    rolledPools.add(key);
    const die = deps.rollDie(6);
    // Whether a monster's breath is back is the GM's to know; the table sees it when it is used.
    const audience = actor.kind === "player-character" ? {} : { gmOnly: true as const };
    if (die >= action.uses.recharge) {
      const { [key]: _spent, ...rest } = actor.actionUses;
      actor.actionUses = rest;
      events?.push({
        kind: "effect",
        text: `${actor.name}'s ${action.name} recharges (rolled ${die}).`,
        actorId: actor.id,
        ...audience
      });
    } else {
      events?.push({
        kind: "effect",
        text: `${actor.name}'s ${action.name} stays spent (rolled ${die}, needs ${action.uses.recharge}+).`,
        actorId: actor.id,
        ...audience
      });
    }
  }
}

/** "You can't use it again until the start of your next turn" (Peerless Aim): such a use comes back as the bearer's
 *  turn starts. */
function refreshOwnTurnUses(state: GameState, actorId: string, deps: TurnAdvanceDeps) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor?.definitionId) return;
  const definition = deps.resolveDefinition(actor.definitionId);
  if (!definition) return;
  for (const action of effectiveActions(definition, actor, deps.catalog)) {
    if (action.uses?.per !== "own-turn") continue;
    const key = action.uses.pool ?? action.id;
    if (actor.actionUses[key] === undefined) continue;
    const { [key]: _spent, ...rest } = actor.actionUses;
    actor.actionUses = rest;
  }
}

/** A creature's legendary pool refills at the start of its turn, and so do the actions it couldn't take again until
 *  then (marked `<actorId>:<actionId>`). */
function legendaryRefilled(used: GameState["combat"]["legendaryUsed"], actorId: string) {
  return Object.fromEntries(Object.entries(used).filter(([key]) => key !== actorId && !key.startsWith(`${actorId}:`)));
}

export function nextInitiativeTurn(state: GameState, events?: EffectNarration[], deps?: TurnAdvanceDeps) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0)
    throw new CommandRejectedError("Start an encounter before advancing Initiative.");
  // Wait mode holds turns until every player has rolled their initiative (or the GM rolls the rest).
  if (state.combat.playerInitiativeMode === "wait" && state.combat.pendingInitiative.length > 0)
    throw new CommandRejectedError("Players are still rolling initiative - roll for the rest to begin.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === state.combat.initiative.length - 1;
  // The outgoing turn ends first: its "until the end of the turn" effects lapse and repeated saves open.
  const ending: EffectNarration[] = [];
  endOfTurn(
    state,
    state.combat.turnActorId,
    ending,
    deps?.newId ? { newId: deps.newId, now: deps.now ?? (() => new Date().toISOString()) } : undefined
  );
  events?.push(...ending);
  // A new round sorts the whole order again, settling any mid-round score change.
  const order = wraps ? ordered(state, state.combat.initiative) : state.combat.initiative;
  const nextActorId = order[wraps ? 0 : currentIndex + 1].actorId;
  state.combat = {
    ...state.combat,
    initiative: order,
    round: wraps ? state.combat.round + 1 : state.combat.round,
    turnActorId: nextActorId,
    // A new turn: fresh action/bonus/reaction for the incoming actor, and its legendary pool refills (SRD).
    turn: { ...EMPTY_TURN },
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => actorId !== nextActorId),
    legendaryUsed: legendaryRefilled(state.combat.legendaryUsed, nextActorId)
  };
  // The incoming actor's durations tick: Reckless ends, Rage counts down (ADR-0020).
  const expiry = expireEffectsAtTurnStart(state, nextActorId);
  events?.push(...expiry);
  if (!deps) return;
  // Then what lands at the start of its turn: a swallow's acid, Searing Smite's fire.
  const starting: EffectNarration[] = [];
  startOfTurn(state, nextActorId, starting, deps);
  events?.push(...starting);
  rollRecharges(state, nextActorId, deps, events);
  refreshOwnTurnUses(state, nextActorId, deps);
}

export function previousInitiativeTurn(state: GameState) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0)
    throw new CommandRejectedError("Start an encounter before moving Initiative backward.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === 0;
  const previousActorId =
    state.combat.initiative[wraps ? state.combat.initiative.length - 1 : currentIndex - 1].actorId;
  state.combat = {
    ...state.combat,
    round: wraps && state.combat.round > 1 ? state.combat.round - 1 : state.combat.round,
    turnActorId: previousActorId,
    // Backing up is a GM correction, so the strip starts clean. Effect durations do not rewind here; the
    // timeline restore is the real undo.
    turn: { ...EMPTY_TURN },
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => actorId !== previousActorId),
    legendaryUsed: legendaryRefilled(state.combat.legendaryUsed, previousActorId)
  };
}
