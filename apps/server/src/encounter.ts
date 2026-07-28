import type { ActorDefinition, EncounterStartEntry, GameState, InitiativeEntry } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { aggregateRollMode, collectRiders, type RollModeSource } from "@vtt/rules-5e";
import { deriveEquipment } from "./equipment-derivation.js";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { expireEffectsAtTurnStart, type EffectNarration } from "./effects.js";
import { createEncounterTokens, type TokenMapGeometry } from "./token-placement.js";

type StartEncounterInput = Readonly<{
  mapAssetId: string;
  entries: readonly EncounterStartEntry[];
  rulesMode?: "strict" | "assisted" | "freeform";
  /** When true, each claimed player-character without an explicit score gets a provisional auto-roll AND is
   * parked in `pendingInitiative` for its owner to roll (combat.playerInitiativeMode picks immediate/wait). */
  playersRollInitiative?: boolean;
}>;

const EMPTY_TURN = { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 } as const;

/** A fresh fight refreshes per-encounter limited-use pools (Frenzy next fight) and recharge pools (a dragon opens with its breath ready); long-rest pools persist until a rest. */
function clearPerEncounterUses(state: GameState, combatantIds: ReadonlySet<string>, resolveDefinition: (definitionId: string) => ActorDefinition | undefined, catalog?: EquipmentCatalog) {
  for (const actor of state.actors) {
    if (!combatantIds.has(actor.id) || !actor.definitionId) continue;
    const definition = resolveDefinition(actor.definitionId);
    if (!definition) continue;
    for (const action of effectiveActions(definition, actor, catalog)) {
      if (action.uses?.per !== "encounter" && action.uses?.per !== "recharge") continue;
      const key = action.uses.pool ?? action.id;
      if (actor.actionUses[key] !== undefined) {
        const { [key]: _cleared, ...rest } = actor.actionUses;
        actor.actionUses = rest;
      }
    }
  }
}

const validScore = (value: number) => Number.isInteger(value) && value >= -1000 && value <= 1000;

/**
 * Criterion 5 - "advantage on Initiative while attuned". The initiative roll already supports
 * advantage/disadvantage (2024 Surprise rolls with disadvantage), so a `roll-mode {roll: "initiative"}`
 * rider only has to reach the same switch. 5e cancellation applies: any advantage plus any
 * disadvantage is a normal roll, which is what `aggregateRollMode` already encodes.
 */
export function initiativeRollMode(state: GameState, actorId: string, resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined, catalog: EquipmentCatalog | undefined): "advantage" | "disadvantage" | "normal" {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || !catalog) return "normal";
  const definition = actor.definitionId ? resolveDefinition?.(actor.definitionId) : undefined;
  const derivation = deriveEquipment(actor, definition, catalog);
  const advantage: RollModeSource[] = [];
  const disadvantage: RollModeSource[] = [];
  for (const rider of collectRiders(derivation.carriers, { ...derivation.context, moment: "on-initiative-roll" })) {
    if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "initiative") continue;
    (rider.modifier.mode === "advantage" ? advantage : disadvantage).push({ source: `item:${rider.sourceItemId ?? rider.label}`, label: rider.label });
  }
  // A rider with NO `when` is standing, and "advantage on Initiative" is the natural way to author it.
  for (const rider of collectRiders(derivation.carriers, { ...derivation.context, moment: null })) {
    if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "initiative") continue;
    (rider.modifier.mode === "advantage" ? advantage : disadvantage).push({ source: `item:${rider.sourceItemId ?? rider.label}`, label: rider.label });
  }
  return aggregateRollMode(advantage, disadvantage).mode;
}

/** Roll one initiative d20 under an aggregated roll mode. */
function rollUnderMode(rollD20: () => number, mode: "advantage" | "disadvantage" | "normal"): number {
  if (mode === "advantage") return Math.max(rollD20(), rollD20());
  if (mode === "disadvantage") return Math.min(rollD20(), rollD20());
  return rollD20();
}

function ordered(state: GameState, entries: readonly InitiativeEntry[]) {
  const names = new Map(state.actors.map((actor) => [actor.id, actor.name]));
  return [...entries].sort((left, right) => right.score - left.score
    || right.tieBreaker - left.tieBreaker
    || (names.get(left.actorId) ?? "").localeCompare(names.get(right.actorId) ?? "")
    || left.actorId.localeCompare(right.actorId));
}

export function startEncounter(state: GameState, input: StartEncounterInput, rollD20: () => number, tokenGeometry: TokenMapGeometry, resolveDefinition?: (definitionId: string) => ActorDefinition | undefined, now: number = Date.now(), catalog?: EquipmentCatalog) {
  if (state.combat.active) throw new CommandRejectedError("End the active encounter before starting another one.");
  if (input.entries.length === 0 || input.entries.length > 200) throw new CommandRejectedError("Choose 1 to 200 combatants before starting the encounter.");
  // When a prepared scene is live, the encounter must run on that scene's map so park/resume stays coherent.
  if (state.combat.activeSceneId !== null) {
    const activeScene = state.combat.scenes.find((scene) => scene.id === state.combat.activeSceneId);
    if (activeScene && activeScene.mapAssetId !== input.mapAssetId) throw new CommandRejectedError("This scene uses a different map. Start on the scene's map, or switch scenes first.");
  }
  // Preserve any positions already placed during scene prep (or a prior setup); new combatants start unplaced.
  const placedPositions = new Map(state.combat.tokens.map((token) => [token.actorId, token.position]));
  const actorIds = new Set<string>();
  // Claimed PCs whose owner will roll their own initiative (see input.playersRollInitiative): the
  // auto-roll below stands as a provisional score until the player rolls (immediate mode) or is the
  // fallback if the GM rolls the rest (wait mode).
  const pendingInitiative: string[] = [];
  const initiative = input.entries.map((entry) => {
    if (actorIds.has(entry.actorId)) throw new CommandRejectedError("Each actor can appear in Initiative only once.");
    actorIds.add(entry.actorId);
    const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (!actor) throw new CommandRejectedError("One of the selected combatants no longer exists.");
    actor.lastUsedAt = now; // recency for the scene-setup "Recent" list (GM-only)
    const tieBreaker = actor.initiative ?? 0;
    // 2024 Surprise: a surprised combatant rolls initiative with disadvantage (two d20s, keep lower).
    // An item's `roll-mode {roll: "initiative"}` rider joins the same aggregation, so a cloak of
    // advantage and Surprise cancel to a normal roll exactly as 5e says they should.
    const itemMode = initiativeRollMode(state, actor.id, resolveDefinition, catalog);
    const mode = entry.surprised === true
      ? aggregateRollMode(itemMode === "advantage" ? [{ source: "item", label: "Item" }] : [], [{ source: "surprised", label: "Surprised" }]).mode
      : itemMode;
    const rolled = entry.score === undefined ? rollUnderMode(rollD20, mode) + tieBreaker : entry.score;
    if (!validScore(rolled)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
    if (input.playersRollInitiative && entry.score === undefined && actor.kind === "player-character" && actor.ownerSessionId !== null) pendingInitiative.push(actor.id);
    return { actorId: actor.id, score: rolled, tieBreaker };
  });
  const sorted = ordered(state, initiative);
  // Spread, never a fresh literal: CombatState grows fields over time (pendingSaves today; scenes
  // next) and a wholesale replacement here would silently drop them. Fog deliberately rides the
  // spread untouched - it's scene dressing prepped before the fight and persisting after it.
  state.combat = {
    ...state.combat,
    active: true,
    round: 1,
    turnActorId: sorted[0].actorId,
    mapAssetId: input.mapAssetId,
    initiative: sorted,
    tokens: createEncounterTokens(sorted.map((entry) => { const source = state.actors.find((actor) => actor.id === entry.actorId); return { actorId: entry.actorId, sizeCells: source?.sizeCells ?? 1, size: source?.size }; }), tokenGeometry)
      .map((token) => ({ ...token, position: placedPositions.get(token.actorId) ?? token.position })),
    annotations: [],
    turn: { ...EMPTY_TURN },
    rulesMode: input.rulesMode ?? state.combat.rulesMode,
    underwater: false,
    reactionsUsed: [],
    legendaryUsed: {},
    pendingSaves: [],
    pendingReactions: [],
    pendingDamage: [],
    pendingInitiative,
    // A fresh fight starts live on the timeline; the handler wipes any prior fight's snapshots and
    // captures this start state as the baseline the GM can rewind all the way back to.
    historyCursor: null,
    historyDirty: false
  };
  if (resolveDefinition) clearPerEncounterUses(state, actorIds, resolveDefinition, catalog);
}

/** Drops a new combatant into a running encounter: rolls (or takes) its initiative, re-sorts, and places its token. GM-only at the command layer. */
export function addCombatant(state: GameState, actorId: string, score: number | undefined, rollD20: () => number, tokenGeometry: TokenMapGeometry, now: number = Date.now()) {
  if (!state.combat.active) throw new CommandRejectedError("Start the encounter before adding a combatant to it.");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("That combatant is already in the encounter.");
  if (state.combat.initiative.length >= 200) throw new CommandRejectedError("This encounter already has 200 combatants.");
  const tieBreaker = actor.initiative ?? 0;
  const rolled = score === undefined ? rollD20() + tieBreaker : score;
  if (!validScore(rolled)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
  actor.lastUsedAt = now; // recency for the scene-setup "Recent" list (GM-only)
  state.combat = {
    ...state.combat,
    initiative: ordered(state, [...state.combat.initiative, { actorId, score: rolled, tieBreaker }]),
    tokens: [...state.combat.tokens, ...createEncounterTokens([{ actorId, sizeCells: actor.sizeCells ?? 1, size: actor.size }], tokenGeometry)]
  };
}

export function endEncounter(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("There is no active encounter to end.");
  // Ending mid-review would strand the timeline pointing at a fight that no longer exists.
  if (state.combat.historyCursor !== null) throw new CommandRejectedError("Finish reviewing the combat history before ending the encounter.");
  // Fog persists through the spread below: what the party has revealed stays revealed after the fight.
  state.combat = { ...state.combat, active: false, turnActorId: null, turn: { ...EMPTY_TURN }, underwater: false, reactionsUsed: [], legendaryUsed: {}, pendingSaves: [], pendingReactions: [], pendingDamage: [], pendingInitiative: [], historyCursor: null, historyDirty: false };
}

export function setInitiativeScore(state: GameState, actorId: string, score: number) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before changing Initiative.");
  if (!validScore(score)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("That actor is not in this encounter.");
  // A GM-set score clears any pending player roll for that actor (the GM rolled/typed it instead), and in
  // wait mode may complete the gather so turns can begin.
  const stillPending = state.combat.pendingInitiative.filter((id) => id !== actorId);
  state.combat = {
    ...state.combat,
    initiative: ordered(state, state.combat.initiative.map((entry) => entry.actorId === actorId ? { ...entry, score } : entry)),
    pendingInitiative: stillPending
  };
  settleGatherIfComplete(state);
}

/**
 * A claimed player rolls their own initiative (the server rolls with its own RNG unless a manual `natural`
 * is supplied, honoring adv/disadv), setting their score and clearing their pending flag. In wait mode,
 * clearing the last pending entry begins turns on the now-final order. Returns the final score for the log.
 */
export function rollSelfInitiative(state: GameState, actorId: string, options: Readonly<{ natural?: number; rollMode?: "advantage" | "disadvantage" | "normal" }>, rollD20: () => number): number {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before rolling Initiative.");
  const entry = state.combat.initiative.find((candidate) => candidate.actorId === actorId);
  if (!entry) throw new CommandRejectedError("That actor is not in this encounter.");
  if (!state.combat.pendingInitiative.includes(actorId)) throw new CommandRejectedError("Your initiative is already set.");
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const tieBreaker = actor?.initiative ?? 0;
  const natural = options.natural !== undefined
    ? options.natural
    : options.rollMode === "advantage" ? Math.max(rollD20(), rollD20())
    : options.rollMode === "disadvantage" ? Math.min(rollD20(), rollD20())
    : rollD20();
  const score = natural + tieBreaker;
  if (!validScore(score)) throw new CommandRejectedError("Initiative scores must be whole numbers from -1000 to 1000.");
  state.combat = {
    ...state.combat,
    initiative: ordered(state, state.combat.initiative.map((candidate) => candidate.actorId === actorId ? { ...candidate, score } : candidate)),
    pendingInitiative: state.combat.pendingInitiative.filter((id) => id !== actorId)
  };
  settleGatherIfComplete(state);
  return score;
}

/** GM rolls initiative for every combatant still pending (starting the fight in wait mode), clearing the gather. */
export function rollRemainingInitiative(state: GameState, rollD20: () => number) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before rolling Initiative.");
  if (state.combat.pendingInitiative.length === 0) return;
  const pending = new Set(state.combat.pendingInitiative);
  const rolledEntries = state.combat.initiative.map((entry) => {
    if (!pending.has(entry.actorId)) return entry;
    const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
    return { ...entry, score: rollD20() + (actor?.initiative ?? 0) };
  });
  state.combat = { ...state.combat, initiative: ordered(state, rolledEntries), pendingInitiative: [] };
  settleGatherIfComplete(state);
}

/**
 * In wait mode, once every player has rolled (pendingInitiative empties) the fight actually begins: turns
 * start on the now-final order from the top of round 1. Immediate mode never gathers, so this is a no-op there.
 */
function settleGatherIfComplete(state: GameState) {
  if (state.combat.playerInitiativeMode !== "wait" || state.combat.pendingInitiative.length > 0 || state.combat.initiative.length === 0) return;
  const top = ordered(state, state.combat.initiative)[0].actorId;
  if (state.combat.turnActorId === top && state.combat.round === 1) return;
  state.combat = { ...state.combat, turnActorId: top, round: 1, turn: { ...EMPTY_TURN } };
}

/** Dependencies for start-of-turn recharge rolls; optional so scene bookkeeping paths can advance turns without them. */
export type TurnAdvanceDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog, so an item's recharge pool re-arms with the stat block's (see `effectiveActions`). */
  catalog?: EquipmentCatalog;
  rollDie: (sides: number) => number;
}>;

/**
 * SRD Recharge X-Y: at the start of the owner's turn, a d6 at or above the threshold re-arms the
 * spent pool. Rolled here (not offered as a prompt) because the SRD makes it automatic; the
 * narration shows the die so the table sees why the breath is back. One roll per shared pool.
 */
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
    if (die >= action.uses.recharge) {
      const { [key]: _spent, ...rest } = actor.actionUses;
      actor.actionUses = rest;
      events?.push({ kind: "effect", text: `${actor.name}'s ${action.name} recharges (rolled ${die}).`, actorId: actor.id });
    } else {
      events?.push({ kind: "effect", text: `${actor.name}'s ${action.name} stays spent (rolled ${die}, needs ${action.uses.recharge}+).`, actorId: actor.id });
    }
  }
}

export function nextInitiativeTurn(state: GameState, events?: EffectNarration[], deps?: TurnAdvanceDeps) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0) throw new CommandRejectedError("Start an encounter before advancing Initiative.");
  // Wait mode holds turns until every player has rolled their initiative (or the GM rolls the rest).
  if (state.combat.playerInitiativeMode === "wait" && state.combat.pendingInitiative.length > 0) throw new CommandRejectedError("Players are still rolling initiative - roll for the rest to begin.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === state.combat.initiative.length - 1;
  const nextActorId = state.combat.initiative[wraps ? 0 : currentIndex + 1].actorId;
  state.combat = {
    ...state.combat,
    round: wraps ? state.combat.round + 1 : state.combat.round,
    turnActorId: nextActorId,
    // A new turn starts: fresh action/bonus for the incoming actor, whose reaction also refreshes -
    // as does its legendary-action pool (SRD: uses regained at the start of the creature's turn).
    turn: { ...EMPTY_TURN },
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => actorId !== nextActorId),
    legendaryUsed: Object.fromEntries(Object.entries(state.combat.legendaryUsed).filter(([actorId]) => actorId !== nextActorId))
  };
  // The incoming actor's sustained durations tick: Reckless ends, Rage counts down (ADR-0020).
  const expiry = expireEffectsAtTurnStart(state, nextActorId);
  events?.push(...expiry);
  if (deps) rollRecharges(state, nextActorId, deps, events);
}

export function previousInitiativeTurn(state: GameState) {
  if (!state.combat.active || !state.combat.turnActorId || state.combat.initiative.length === 0) throw new CommandRejectedError("Start an encounter before moving Initiative backward.");
  const currentIndex = state.combat.initiative.findIndex((entry) => entry.actorId === state.combat.turnActorId);
  if (currentIndex < 0) throw new CommandRejectedError("The current turn is not in Initiative.");
  const wraps = currentIndex === 0;
  const previousActorId = state.combat.initiative[wraps ? state.combat.initiative.length - 1 : currentIndex - 1].actorId;
  state.combat = {
    ...state.combat,
    round: wraps && state.combat.round > 1 ? state.combat.round - 1 : state.combat.round,
    turnActorId: previousActorId,
    // Backing up is a GM correction; treat it like any turn change so the strip starts clean.
    // Effect durations deliberately do NOT rewind here - the Time Machine restore is the real undo.
    turn: { ...EMPTY_TURN },
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => actorId !== previousActorId),
    legendaryUsed: Object.fromEntries(Object.entries(state.combat.legendaryUsed).filter(([actorId]) => actorId !== previousActorId))
  };
}
