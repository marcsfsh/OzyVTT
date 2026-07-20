import { z } from "zod";
import type { CombatLogEntry, GameState, GmView, PlayerView, RollRecord, TableEvent } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { IntegrationScope } from "@vtt/api-contract";
import { addAnnotation, addPing, clearAnnotations, moveAnnotation, removeAnnotation, setAnnotationColor, setAnnotationMovable, setAnnotationVisibility, shapeGeometry, type AnnotationActor } from "./annotations.js";
import { setCondition } from "./actor-conditions.js";
import { actionAvailability, resolveDefinitionAction } from "./action-resolution.js";
import { builtinAction, BUILTIN_ACTIONS, BUILTIN_TARGETING } from "./builtin-actions.js";
import { parseAreaProse, tokensInTemplate } from "./area-targeting.js";
import { addActorFromDefinition, importActorDefinition, removeActor, storedDefinition } from "./actor-roster.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "./character-claims.js";
import type { CombatLogStore } from "./combat-log.js";
import { actionSummaryOf, type ContentLibrary } from "./content-library.js";
import { addCombatant, endEncounter, nextInitiativeTurn, setInitiativeScore, startEncounter } from "./encounter.js";
import { addEffect, endEffect, endEncounterEffects, removeConditionDirect, type EffectNarration } from "./effects.js";
import { resolveDeathSave } from "@vtt/rules-5e";
import { creatureDistance, mapDistance, tokenCreatureDistance } from "./movement-narration.js";
import { activateScene, createScene, removeScene, renameScene, setSceneCombatants } from "./scenes.js";
import { buildEncounterArchive } from "./encounter-archive.js";
import { planNextTurn, planPreviousTurn, turnLabel, type TimelineOutcome } from "./combat-history.js";
import { CommandRejectedError, type GameStore, type JournalEntry } from "./game-store.js";
import { applyMovementRules } from "./movement-rules.js";
import { applyRest, spendHitDice } from "./rests.js";
import { paintFog, resetFog, setFogEnabled } from "./fog.js";
import { applyDamage, applyDamageDetailed, healActor, setCurrentHp, setTemporaryHp, type ActorScope } from "./hit-points.js";
import { narrateTokenMove, type MovementNarration } from "./movement-narration.js";
import { moveEncounterToken, moveSceneToken, setActorSize, setActorVisibility, type TokenMapGeometry } from "./token-placement.js";
import { answerSave, dismissSave } from "./saving-throws.js";
import { answerReaction, dismissReaction } from "./reactions.js";
import { endTurn, setLegendaryUsed, setReactionUsed, setTurnSlot } from "./turn-economy.js";
import {
  ActionResolveSchema, ActorAddFromDefinitionSchema, ActorAvailableActionsSchema, ActorImportDefinitionSchema, ActorRemoveSchema, ActorRestSchema, ActorSetSpeedSchema, ActorSpendHitDiceSchema, AddCombatantSchema,
  AnnotationAddSchema, AnnotationClearSchema, AnnotationColorSetSchema, AnnotationMovableSetSchema, AnnotationMoveSchema,
  AnnotationPingSchema, AnnotationRemoveSchema, AnnotationVisibilitySetSchema, ApplyDamageSchema, CommandIdentitySchema, ContentActionsSchema,
  DeathSaveRollSchema, DiceRollSchema, EffectAddSchema, EffectEndSchema, EncounterStartSchema, GAME_COMMAND_SCOPES, HpAmountSchema, InitiativeNextSchema, InitiativePreviousSchema,
  InitiativeScoreSchema, ReactionAnswerSchema, ReactionDismissSchema, SaveAnswerSchema, SaveDismissSchema, SceneCreateSchema, SceneIdSchema, SceneRenameSchema,
  FogPaintSchema, FogResetSchema, FogSetEnabledSchema,
  SceneSetCombatantsSchema, SetActorSizeSchema, SetActorVisibilitySchema, SetConditionSchema, SetEnvironmentSchema, SetHpSchema, SetRulesModeSchema, SetTokenImageSchema, TempHpSchema,
  TokenMoveSchema, TurnLegendarySchema, TurnReactionSchema, TurnUseSchema, type GameCommandType
} from "./game-commands.js";

/**
 * Transport-agnostic game capabilities. Both adapters - the Socket.IO handlers in `server.ts` and
 * the public HTTP API in `game-http.ts` - validate, authorize, execute, and narrate through these
 * exact functions, so the two surfaces can never fork on behavior (CLAUDE.md rule 2 / ADR-0016).
 *
 * Every operation takes the RAW wire payload and parses it itself with the shared command schemas,
 * performs the same role checks the socket handlers historically performed (same message text),
 * dispatches through the store's serialized command queue, and runs the same side effects
 * (projection publish, combat-log lines, table toasts) on acceptance.
 */

/** A request that failed schema validation. Adapters map it to the transport's "malformed" shape. */
export class GameInputError extends Error {
  constructor(message: string, public readonly issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>) { super(message); }
}
/** The principal's role may not perform this operation (message text matches the historical socket denials). */
export class GameAccessDeniedError extends Error {}

/**
 * Who is acting. GM sessions and GM-minted integration credentials both act with GM authority -
 * an integration is the GM's own trusted automation (ADR-0016); player sessions keep exactly the
 * player limits the socket enforces. The public table viewer never reaches these operations at all.
 */
export type GamePrincipal =
  | Readonly<{ kind: "gm"; sessionId: string }>
  | Readonly<{ kind: "player"; sessionId: string }>
  | Readonly<{ kind: "integration"; credentialId: string; name: string }>;

export function isGmGrade(principal: GamePrincipal): principal is Exclude<GamePrincipal, Readonly<{ kind: "player"; sessionId: string }>> { return principal.kind !== "player"; }
function actorScopeOf(principal: GamePrincipal): ActorScope {
  return principal.kind === "player" ? { role: "player", sessionId: principal.sessionId } : { role: "gm" };
}
/** A stable UUID identity for ownership fields (annotation owners, roll initiators). Credential ids are UUIDs too. */
function sessionIdOf(principal: GamePrincipal): string { return principal.kind === "integration" ? principal.credentialId : principal.sessionId; }
function annotationActorOf(principal: GamePrincipal): AnnotationActor { return { sessionId: sessionIdOf(principal), role: isGmGrade(principal) ? "gm" : "player" }; }
/** Journal attribution tag (Time Machine v2). */
function principalTag(principal: GamePrincipal): string {
  switch (principal.kind) {
    case "gm": return `gm:${principal.sessionId}`;
    case "player": return `player:${principal.sessionId}`;
    case "integration": return `integration:${principal.credentialId}`;
  }
}
/** "Who rolled this" label: the GM, the integration's credential name, or the player's claimed character (resolved later). */
function gmGradeLabelOf(principal: GamePrincipal): string { return principal.kind === "integration" ? principal.name : "GM"; }

function requireGmGrade(principal: GamePrincipal, message: string) {
  if (!isGmGrade(principal)) throw new GameAccessDeniedError(message);
}

function parse<Schema extends z.ZodTypeAny>(schema: Schema, raw: unknown, malformedMessage: string, preferIssueMessage = false): z.output<Schema> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  // action:resolve and save:answer historically surfaced the first zod issue (their refinements carry
  // the actually-helpful text); everything else kept a stable per-command "malformed" line.
  const message = preferIssueMessage ? (issues[0]?.message ?? malformedMessage) : malformedMessage;
  throw new GameInputError(message, issues);
}

export type GameOperationsContext = Readonly<{
  store: GameStore;
  combatLog: CombatLogStore;
  contentLibrary: ContentLibrary;
  mapCatalog: Readonly<{ get: (assetId: string) => { kind: string } | undefined | null }>;
  tokenCatalog: Readonly<{ get: (assetId: string) => unknown; touchLastUsed: (assetId: string) => void; rememberForDefinition: (definitionId: string, assetId: string) => void }>;
  tokenGeometryFor: (mapAssetId: string) => Promise<TokenMapGeometry>;
  publishGameState: (state: GameState) => Promise<void>;
  broadcastTableEvent: (event: Readonly<{ kind: TableEvent["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean }>) => void;
  appendLog: (entry: Readonly<{ kind: CombatLogEntry["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean }>) => void;
  logTurnBegin: (state: GameState) => void;
  logTimelineOutcome: (outcome: TimelineOutcome, state: GameState) => void;
  scheduleAnnotationExpiry: () => void;
  gmView: (state: GameState) => GmView;
  playerView: (state: GameState, playerSessionId: string | undefined) => PlayerView;
  /** Uniform die: an integer in [1, sides]. */
  random: (sides: number) => number;
  newId: () => string;
}>;

/** Every mutation resolves to at least the accepted revision + idempotent-duplicate flag; commands add their own extras. */
export type GameMutationResult = { revision: number; duplicate: boolean } & Record<string, unknown>;

export type GameOperations = ReturnType<typeof createGameOperations>;

export function createGameOperations(context: GameOperationsContext) {
  const { store, contentLibrary } = context;
  const actorName = (actorId: string) => store.snapshot.actors.find((actor) => actor.id === actorId)?.name ?? "A combatant";
  const actorHidden = (actorId: string) => store.snapshot.actors.find((actor) => actor.id === actorId)?.visibility === "gm-only";
  // Imported stat blocks take precedence over the bundle so sheets/actions resolve for both.
  const resolveDefinition = (definitionId: string) => storedDefinition(store.snapshot, definitionId) ?? contentLibrary.monster(definitionId);

  /** Shared narration fan-out for engine transitions (effect ends, dying, consciousness). */
  const publishNarrations = (events: readonly EffectNarration[]) => {
    for (const event of events) {
      const gmOnly = actorHidden(event.actorId);
      context.appendLog({ kind: event.kind, text: event.text, actorIds: [event.actorId], gmOnly });
      context.broadcastTableEvent({ kind: event.kind, text: event.text, actorIds: [event.actorId], gmOnly });
    }
  };

  return {
    // ---------- Reads ----------

    /** The projection for this principal. GM-grade principals get the full GM view unless they explicitly ask for the player-safe one; players only ever get theirs. */
    view(principal: GamePrincipal, requested?: "gm" | "player"): { view: "gm" | "player"; game: GmView | PlayerView } {
      const state = store.snapshot;
      if (!isGmGrade(principal) || requested === "player") {
        return { view: "player", game: context.playerView(state, principal.kind === "player" ? principal.sessionId : undefined) };
      }
      return { view: "gm", game: context.gmView(state) };
    },

    logEntries(principal: GamePrincipal, limit?: number): readonly CombatLogEntry[] {
      return context.combatLog.list(isGmGrade(principal), limit);
    },

    contentMonsters(principal: GamePrincipal) {
      requireGmGrade(principal, "Only the GM can browse bundled content.");
      return { monsters: contentLibrary.monsterSummaries(), attribution: contentLibrary.attribution };
    },

    contentConditions(_principal: GamePrincipal) {
      // Reference text is public information: any joined session (GM or player) may read it.
      return { conditions: contentLibrary.conditionSummaries() };
    },

    contentSpells(_principal: GamePrincipal) {
      // Spell rules are public reference text (the CC-BY SRD), like conditions - any joined session may read them.
      return { spells: contentLibrary.spellSummaries() };
    },

    contentMonsterActions(principal: GamePrincipal, raw: unknown) {
      requireGmGrade(principal, "Only the GM can browse stat blocks.");
      const request = parse(ContentActionsSchema, raw, "The action lookup is malformed.");
      const imported = storedDefinition(store.snapshot, request.definitionId);
      const definition = imported ?? contentLibrary.monster(request.definitionId);
      const actions = imported
        ? imported.actions.map(actionSummaryOf)
        : contentLibrary.monsterActionSummaries(request.definitionId);
      if (!actions) throw new CommandRejectedError("That stat block is not in the bundled content.");
      // The SRD generic actions (Dodge, Dash, Help, Unarmed Strike, ...) every combatant can take
      // ride along after the stat block's own; a declared id shadows its builtin.
      const builtins = BUILTIN_ACTIONS
        .filter((candidate) => !definition?.actions.some((declared) => declared.id === candidate.id))
        .map((candidate) => ({ ...actionSummaryOf(candidate), builtin: true, targeting: BUILTIN_TARGETING[candidate.id] ?? "none" as const }));
      return { actions: [...actions, ...builtins], ...(definition?.legendary ? { legendary: definition.legendary } : {}) };
    },

    contentMonsterSheet(principal: GamePrincipal, raw: unknown) {
      requireGmGrade(principal, "Only the GM can read stat blocks.");
      const request = parse(ContentActionsSchema, raw, "The stat-block lookup is malformed.");
      const definition = resolveDefinition(request.definitionId);
      if (!definition) throw new CommandRejectedError("That stat block is not in the bundled content.");
      return { definition };
    },

    // ---------- Encounter lifecycle ----------

    async encounterStart(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can start an encounter.");
      const request = parse(EncounterStartSchema, raw, "The encounter setup is malformed.");
      const encounterMap = context.mapCatalog.get(request.mapAssetId);
      if (!encounterMap || encounterMap.kind !== "battlemap") throw new CommandRejectedError("Select an uploaded battlemap before starting the encounter.");
      const { commandId, mapAssetId, entries, rulesMode, expectedRevision } = request;
      const tokenGeometry = await context.tokenGeometryFor(mapAssetId);
      const result = await store.executeTimeline({ id: commandId, type: "encounter.start", expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        startEncounter(state, { mapAssetId, entries, rulesMode }, () => context.random(20), tokenGeometry, (definitionId) => storedDefinition(state, definitionId) ?? contentLibrary.monster(definitionId));
        // Fresh fight: clear any prior encounter's snapshots and record this start as the baseline
        // the GM can always rewind back to (a distinct label so it reads apart from turn boundaries).
        timeline.truncateAll();
        // The previous fight's journal goes with it; this very command stays as the new fight's first entry.
        timeline.clearJournal(commandId);
        timeline.capture("turn", `Combat begins - ${turnLabel(state)}`, state);
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: "The encounter began.", gmOnly: false });
        for (const entry of entries) {
          if (entry.surprised === true) context.appendLog({ kind: "encounter", text: `${actorName(entry.actorId)} is surprised - initiative rolled at disadvantage.`, actorIds: [entry.actorId], gmOnly: actorHidden(entry.actorId) });
        }
        context.logTurnBegin(result.state);
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async encounterEnd(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can end an encounter.");
      const request = parse(CommandIdentitySchema, raw, "The encounter command is malformed.");
      const { commandId, expectedRevision } = request;
      const tag = principalTag(principal);
      let effectEvents: EffectNarration[] = [];
      const result = await store.executeTimeline({ id: commandId, type: "encounter.end", expectedRevision, payload: request, principal: tag }, (state, timeline) => {
        // The last live picture of the fight, captured before endEncounter clears the combat.
        const finalState = structuredClone(state);
        // The fight's effects end with it (onEnd fires - Frenzy's Exhaustion lands now); scoped to
        // this fight's combatants so a parked scene's effects survive untouched (ADR-0020).
        effectEvents = endEncounterEffects(state, state.combat.initiative.map((entry) => entry.actorId));
        endEncounter(state); // rejects while rewound
        // Auto-archive the whole fight permanently BEFORE wiping the live buffers - same transaction,
        // so an ended encounter's record can never be lost. Skip a fight that captured no boundaries.
        const entries = timeline.entries();
        if (entries.length > 0) {
          const endedAt = new Date().toISOString();
          const journal = timeline.journalEntries();
          // This end command's own journal row is written after the plan's clear wipes the table, so
          // append it to the document explicitly - the archive then covers the fight end-to-end.
          const endEntry: JournalEntry = { seq: (journal[journal.length - 1]?.seq ?? 0) + 1, commandId, type: "encounter.end", actorId: null, principal: tag, payload: request, revision: state.revision + 1, at: endedAt };
          const document = buildEncounterArchive({
            entries,
            readState: timeline.read,
            // The combat log persists independently; the fight's slice starts at its first boundary's revision.
            log: context.combatLog.exportSince(entries[0].revision),
            journal: [...journal, endEntry],
            finalState,
            // The state AFTER the end command's own work (effect sweeps, their on-end grants -
            // Frenzy's Exhaustion) - the fight's true aftermath, which finalState predates.
            postEncounterState: structuredClone(state),
            endedAt,
            resolveBundledDefinition: (definitionId) => contentLibrary.monster(definitionId),
            attribution: contentLibrary.attribution
          });
          timeline.archive({ commandId, startedAt: document.startedAt, endedAt: document.endedAt, turnCount: document.turnCount, documentJson: JSON.stringify(document) });
        }
        timeline.truncateAll(); // the fight is over - its live turn snapshots go with it
        timeline.clearJournal();
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: "The encounter ended.", gmOnly: false });
        publishNarrations(effectEvents);
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async encounterAddCombatant(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can add a combatant.");
      const request = parse(AddCombatantSchema, raw, "The add-combatant command is malformed.");
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) throw new CommandRejectedError("Start an encounter before adding a combatant.");
      const { commandId, actorId, score, expectedRevision } = request;
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const result = await store.execute({ id: commandId, type: "encounter.add-combatant", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => addCombatant(state, actorId, score, () => context.random(20), geometry));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Initiative & turns ----------

    async initiativeSet(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change Initiative.");
      const request = parse(InitiativeScoreSchema, raw, "The Initiative update is malformed.");
      const { commandId, actorId, score, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "initiative.set", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setInitiativeScore(state, actorId, score));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async initiativeNext(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can advance Initiative.");
      const request = parse(InitiativeNextSchema, raw, "The Initiative command is malformed.");
      // Live: record the boundary and advance. Rewound and unchanged: step forward through history
      // (reaching the return-point resumes live). Rewound and changed: rewrite history - but only
      // once the GM confirms, which the plan demands by throwing TimelineConfirmationRequired.
      let outcome: TimelineOutcome | undefined;
      const effectEvents: EffectNarration[] = [];
      const result = await store.executeTimeline({ id: request.commandId, type: "initiative.next", expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        outcome = planNextTurn(state, timeline, request.confirmRewrite === true, (advancing) => nextInitiativeTurn(advancing, effectEvents, {
          resolveDefinition: (definitionId) => storedDefinition(advancing, definitionId) ?? contentLibrary.monster(definitionId),
          rollDie: (sides) => context.random(sides)
        }));
      });
      if (!result.duplicate) { await context.publishGameState(result.state); if (outcome) context.logTimelineOutcome(outcome, result.state); publishNarrations(effectEvents); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async initiativePrevious(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can move Initiative backward.");
      const request = parse(InitiativePreviousSchema, raw, "The Initiative command is malformed.");
      // From live, park a return-point and restore the last boundary; while rewound, step further
      // back - unless the GM changed things here, where confirming discards those changes in place.
      let outcome: TimelineOutcome | undefined;
      const result = await store.executeTimeline({ id: request.commandId, type: "initiative.previous", expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        outcome = planPreviousTurn(state, timeline, request.confirmDiscard === true);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); if (outcome) context.logTimelineOutcome(outcome, result.state); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async turnEnd(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CommandIdentitySchema, raw, "The end-turn command is malformed.");
      const scope = actorScopeOf(principal);
      // End Turn is a live forward step (same as the GM's Next): record the boundary, then advance.
      // While the GM has the table rewound, players can't quietly push initiative past the review.
      const effectEvents: EffectNarration[] = [];
      const result = await store.executeTimeline({ id: request.commandId, type: "turn.end", expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        if (state.combat.historyCursor !== null) throw new CommandRejectedError("The GM is reviewing an earlier turn. Try again once play resumes.");
        planNextTurn(state, timeline, false, (advancing) => endTurn(advancing, scope, effectEvents, {
          resolveDefinition: (definitionId) => storedDefinition(advancing, definitionId) ?? contentLibrary.monster(definitionId),
          rollDie: (sides) => context.random(sides)
        }));
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.logTurnBegin(result.state); publishNarrations(effectEvents); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async turnUse(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(TurnUseSchema, raw, "The turn command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, slot, used, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "turn.use", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setTurnSlot(state, slot, used, scope));
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        // Marking a slot spent narrates like reactions do - bonus actions were previously invisible
        // to the rest of the table. Un-marking (a correction) stays silent.
        const turnActorId = result.state.combat.turnActorId;
        if (used && turnActorId) context.broadcastTableEvent({ kind: "action", text: `${actorName(turnActorId)} used ${slot === "bonus-action" ? "a bonus action" : "an action"}.`, actorIds: [turnActorId], gmOnly: actorHidden(turnActorId) });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async turnUseReaction(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(TurnReactionSchema, raw, "The reaction command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, used, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "turn.use-reaction", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setReactionUsed(state, actorId, used, scope));
      if (!result.duplicate) { await context.publishGameState(result.state); if (used) context.broadcastTableEvent({ kind: "reaction", text: `${actorName(actorId)} used its reaction.`, actorIds: [actorId], gmOnly: actorHidden(actorId) }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async turnUseLegendary(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(TurnLegendarySchema, raw, "The legendary-action command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, spent, expectedRevision } = request;
      // Silent GM bookkeeping - the pool is GM knowledge; structured legendary resolves narrate the action itself.
      const result = await store.execute({ id: commandId, type: "turn.use-legendary", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setLegendaryUsed(state, actorId, spent, scope));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Tokens ----------

    async tokenMove(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(TokenMoveSchema, raw, "The token move is malformed.");
      const { commandId, actorId, position, sceneId, expectedRevision } = request;
      if (sceneId !== undefined) {
        // GM staging a prepared (off-table) scene privately. Geometry comes from that scene's own map.
        requireGmGrade(principal, "Only the GM can stage a prepared scene.");
        const scene = store.snapshot.combat.scenes.find((candidate) => candidate.id === sceneId);
        if (!scene) throw new CommandRejectedError("That scene no longer exists.");
        const sceneGeometry = await context.tokenGeometryFor(scene.mapAssetId);
        const result = await store.execute({ id: commandId, type: "token.move-scene", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => moveSceneToken(state, sceneId, actorId, position, sceneGeometry));
        if (!result.duplicate) await context.publishGameState(result.state);
        return { revision: result.state.revision, duplicate: result.duplicate };
      }
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) throw new CommandRejectedError("Start an encounter before moving tokens.");
      if (request.override && !isGmGrade(principal)) throw new GameAccessDeniedError("Only the GM can override movement rules.");
      const geometry = await context.tokenGeometryFor(mapAssetId);
      let movement: MovementNarration | null | undefined;
      let movementWarning: string | null = null;
      let movementOverridden: string | null = null;
      const opportunityPrompts: Array<{ actorId: string; name: string }> = [];
      const result = await store.execute({ id: commandId, type: "token.move", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try moving the token again.");
        if (!isGmGrade(principal)) {
          const actor = state.actors.find((candidate) => candidate.id === actorId);
          if (!actor || actor.ownerSessionId !== principal.sessionId) throw new CommandRejectedError("You may only move your claimed character token.");
        }
        const from = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
        moveEncounterToken(state, actorId, position, geometry);
        // Time Machine: narrate the move (distance + old → new range to every placed combatant)
        // from the post-mutation state so the logged numbers are the snapped, authoritative ones.
        movement = narrateTokenMove({ state, actorId, from, geometry });
        // Movement budget + opportunity attacks (SRD) - see movement-rules.ts; runs after the snap
        // so measured distances are authoritative, and a strict rejection discards the draft.
        const moverToken = state.combat.tokens.find((token) => token.actorId === actorId);
        const outcome = applyMovementRules(state, {
          actorId,
          from,
          to: moverToken?.position ?? null,
          distance: (a, b) => mapDistance(geometry, a, b)?.value ?? null,
          creatureDistance: (enemy, moverPoint) => {
            const enemyToken = state.combat.tokens.find((token) => token.actorId === enemy.actorId);
            if (!enemyToken || !moverToken) return null;
            return creatureDistance(geometry,
              { position: enemy.position, sizeCells: enemyToken.sizeCells ?? 1, sizePx: enemyToken.sizePx },
              { position: moverPoint, sizeCells: moverToken.sizeCells ?? 1, sizePx: moverToken.sizePx })?.value ?? null;
          },
          override: request.override ?? null,
          resolveDefinition: (definitionId) => storedDefinition(state, definitionId) ?? contentLibrary.monster(definitionId),
          newPromptId: context.newId,
          now: Date.now,
          commandId
        });
        movementWarning = outcome.warning;
        movementOverridden = outcome.overridden;
        opportunityPrompts.push(...outcome.prompts);
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        if (movement?.publicText) context.appendLog({ kind: "movement", text: movement.publicText, actorIds: [actorId] });
        if (movement?.gmText) context.appendLog({ kind: "movement", text: movement.gmText, gmOnly: true });
        if (movementWarning) context.appendLog({ kind: "movement", text: `Rules note: ${movementWarning}`, actorIds: [actorId], gmOnly: true });
        if (movementOverridden) context.appendLog({ kind: "override", text: `OVERRIDE (movement.exceeds-speed): ${actorName(actorId)} moved beyond its speed - ${movementOverridden}`, actorIds: [actorId] });
        for (const prompt of opportunityPrompts) {
          const promptHidden = actorHidden(prompt.actorId);
          context.appendLog({ kind: "reaction", text: `${prompt.name} may make an opportunity attack against ${actorName(actorId)}.`, actorIds: [prompt.actorId], gmOnly: promptHidden });
          context.broadcastTableEvent({ kind: "reaction", text: `${prompt.name} may make an opportunity attack against ${actorName(actorId)}.`, actorIds: [prompt.actorId], gmOnly: promptHidden });
        }
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Actors: roster, hit points, conditions ----------

    async actorAddFromDefinition(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can add combatants.");
      const request = parse(ActorAddFromDefinitionSchema, raw, "The add-combatant command is malformed.");
      const definition = contentLibrary.monster(request.definitionId);
      if (!definition) throw new CommandRejectedError("That monster is not in the bundled content.");
      // Like annotation:add, the commandId doubles as the new entity id so a duplicate
      // delivery acks the same actorId instead of minting a fresh unused one.
      const actorId = request.commandId;
      const result = await store.execute({ id: request.commandId, type: "actor.add-from-definition", actorId, expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state) => addActorFromDefinition(state, definition, actorId, request.visibility));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate, actorId };
    },

    async actorImportDefinition(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can import sheets.");
      const envelope = parse(ActorImportDefinitionSchema, raw, "The import command is malformed.");
      if (JSON.stringify(envelope.definition ?? null).length > 262_144) throw new GameInputError("That sheet is too large to import.");
      const parsed = ActorDefinitionSchema.safeParse(envelope.definition);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new GameInputError(`That file is not a valid actor definition (${issue.path.join(".") || "root"}: ${issue.message}).`);
      }
      const actorId = envelope.commandId;
      const result = await store.execute({ id: envelope.commandId, type: "actor.import-definition", actorId, expectedRevision: envelope.expectedRevision, payload: envelope, principal: principalTag(principal) }, (state) => importActorDefinition(state, parsed.data, actorId, envelope.visibility));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate, actorId };
    },

    async actorRemove(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can remove combatants.");
      const request = parse(ActorRemoveSchema, raw, "The remove-combatant command is malformed.");
      const { commandId, actorId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.remove", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => removeActor(state, actorId));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorApplyDamage(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ApplyDamageSchema, raw, "The damage command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, amount, parts, sourceName, critical, nonlethal, expectedRevision } = request;
      let outcome: ReturnType<typeof applyDamageDetailed> | undefined;
      const result = await store.execute({ id: commandId, type: "actor.apply-damage", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        outcome = applyDamageDetailed(state, actorId, { amount, parts, critical, sourceName: sourceName ?? null, nonlethal }, scope, { resolveDefinition, newId: context.newId, now: () => new Date().toISOString() });
      });
      if (!result.duplicate && outcome) {
        await context.publishGameState(result.state);
        // Typed damage narrates its adjustments ("17 bludgeoning → 8, resistance: Rage") so the
        // table sees WHY the applied number differs - never a silent reduction (ADR-0020).
        const adjustments = outcome.application.parts.filter((part) => part.adjustment !== null);
        const detail = adjustments.length > 0
          ? ` (${adjustments.map((part) => `${part.amount} ${part.type} → ${part.adjusted}, ${part.adjustment}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""}`).join("; ")})`
          : "";
        const attribution = sourceName ? `${sourceName} hit ${actorName(actorId)} for` : `${actorName(actorId)} took`;
        context.broadcastTableEvent({ kind: "damage", text: `${attribution} ${outcome.application.totalApplied} damage${detail}.`, actorIds: [actorId] });
        if (detail.length > 0 || sourceName) context.appendLog({ kind: "damage", text: `${attribution} ${outcome.application.totalApplied} damage${detail}.`, actorIds: [actorId] });
        publishNarrations(outcome.events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(outcome && !result.duplicate ? { applied: outcome.application } : {}) };
    },

    async actorHeal(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(HpAmountSchema, raw, "The healing command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, amount, expectedRevision } = request;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "actor.heal", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        events = healActor(state, actorId, amount, scope);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.broadcastTableEvent({ kind: "heal", text: `${actorName(actorId)} healed ${amount}.`, actorIds: [actorId] }); publishNarrations(events); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetTempHp(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(TempHpSchema, raw, "The temporary hit point command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, amount, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.set-temp-hp", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setTemporaryHp(state, actorId, amount, scope));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetHp(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can set hit points directly.");
      const request = parse(SetHpSchema, raw, "The hit point command is malformed.");
      const { commandId, actorId, current, expectedRevision } = request;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "actor.set-hp", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        events = setCurrentHp(state, actorId, current, { role: "gm" });
      });
      if (!result.duplicate) { await context.publishGameState(result.state); publishNarrations(events); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetCondition(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SetConditionSchema, raw, "The condition command is malformed.");
      if (!contentLibrary.hasCondition(request.conditionId)) throw new CommandRejectedError("That condition is not in the bundled rules.");
      if (request.override && !isGmGrade(principal)) throw new GameAccessDeniedError("Only the GM can override movement rules.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, conditionId, active, level, expectedRevision } = request;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "actor.set-condition", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        events = setCondition(state, actorId, conditionId, active, level, scope, { override: request.override ?? null });
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        const conditionName = contentLibrary.conditionSummaries().find((entry) => entry.id === conditionId)?.name ?? conditionId;
        // Immunity skips narrate through the events instead of the generic applied line.
        const immune = events.some((event) => event.text.includes("is immune to"));
        if (!immune) context.broadcastTableEvent({ kind: "condition", text: active ? `${actorName(actorId)} is ${conditionName}${conditionId === "exhaustion" && level ? ` ${level}` : ""}.` : `${actorName(actorId)} is no longer ${conditionName}.`, actorIds: [actorId] });
        publishNarrations(events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Dice ----------

    async diceRoll(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(DiceRollSchema, raw, "The roll request is malformed.");
      const { commandId, formula, purpose, visibility, actorId, expectedRevision } = request;
      const gmGrade = isGmGrade(principal);
      if (!gmGrade && visibility === "gm-only") throw new GameAccessDeniedError("Only the GM can make a GM-only roll.");
      const initiatorSessionId = sessionIdOf(principal);
      const initiatorRole = gmGrade ? ("gm" as const) : ("player" as const);
      let resolution: ReturnType<typeof rollDice>;
      try { resolution = rollDice(formula, (sides) => context.random(sides)); }
      catch (error) { throw new CommandRejectedError(error instanceof Error ? error.message : "The roll failed."); }
      const rollId = context.newId();
      const result = await store.execute({ id: commandId, type: "dice.roll", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        if (actorId && principal.kind === "player") {
          const actor = state.actors.find((candidate) => candidate.id === actorId);
          if (!actor || actor.ownerSessionId !== principal.sessionId) throw new CommandRejectedError("You may only roll for your claimed character.");
        }
        let group = 0;
        const dice = resolution.terms.flatMap((term) => {
          if (term.kind !== "dice") return [];
          const currentGroup = group++;
          return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign }));
        });
        const initiatorLabel = initiatorRole === "gm" ? gmGradeLabelOf(principal) : state.actors.find((candidate) => candidate.ownerSessionId === initiatorSessionId)?.name ?? "A player";
        const record: RollRecord = {
          id: rollId, commandId, initiatorSessionId, initiatorRole, initiatorLabel, actorId: actorId ?? null, purpose, visibility, formula,
          normalizedFormula: resolution.expression.normalized,
          dice,
          modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
          total: resolution.total, createdAt: new Date().toISOString()
        };
        state.rolls.push(record);
        if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
      });
      const accepted = result.state.rolls.find((roll) => roll.commandId === commandId);
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate, rollId: accepted?.id, hiddenFromRoller: visibility === "blind" && !gmGrade };
    },

    // ---------- Stat-block actions & saving throws ----------

    async actionResolve(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can resolve stat-block actions.");
      const request = parse(ActionResolveSchema, raw, "The action command is malformed.", true);
      const { commandId, actorId, actionId, targetIds, template, conditionId, rollMode, override, expectedRevision } = request;
      if (conditionId !== undefined && !contentLibrary.hasCondition(conditionId)) throw new CommandRejectedError("That condition is not in the bundled reference.");
      // The map grid is fetched up front (async) so template containment AND token-distance rules
      // (prone within 5 ft, unconscious auto-crit) can run inside the synchronous mutation.
      const mapAssetId = store.snapshot.combat.mapAssetId;
      const geometry = mapAssetId ? await context.tokenGeometryFor(mapAssetId) : null;
      if (template && !geometry?.calibration) throw new CommandRejectedError("Calibrate this map before placing an area template.");
      const gmSessionId = sessionIdOf(principal);
      let resolution: ReturnType<typeof resolveDefinitionAction> | undefined;
      const result = await store.execute({ id: commandId, type: "action.resolve", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const attacker = state.actors.find((item) => item.id === actorId);
        if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
        const definition = attacker.definitionId ? storedDefinition(state, attacker.definitionId) ?? contentLibrary.monster(attacker.definitionId) : undefined;
        // The stat block wins on id collision; the builtin catalog (Dodge, Dash, Unarmed Strike, ...)
        // covers every combatant - including one without a definition.
        const statBlockAction = definition?.actions.find((candidate) => candidate.id === actionId);
        const action = statBlockAction ?? builtinAction(actionId);
        if (!action) throw new CommandRejectedError("That action is not on the stat block.");
        const isBuiltin = statBlockAction === undefined;
        let resolvedTargetIds: readonly string[];
        if (template) {
          if (action.attack) throw new CommandRejectedError("Attacks target a single token - pick it directly instead of placing a template.");
          if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try again.");
          const calibration = geometry!.calibration!;
          // Snap the template the same way the drawn annotation will, then find who is under it.
          const snapped = shapeGeometry(calibration, template.shape, template.origin, template.target);
          resolvedTargetIds = tokensInTemplate(state, calibration, snapped, template.shape, parseAreaProse(action.description)?.widthFeet ?? null)
            .filter((id) => id !== actorId && state.combat.initiative.some((entry) => entry.actorId === id));
          if (resolvedTargetIds.length === 0) throw new CommandRejectedError("No combatants are inside that area.");
        } else {
          resolvedTargetIds = targetIds ?? [];
        }
        // Footprint-aware (SRD Creature Size): a Medium attacker adjacent to a Large creature is
        // 5 ft away - center-to-center would read 10 and wrongly block the melee swing.
        const distanceFeet = (actorIdA: string, actorIdB: string): number | null => {
          if (!geometry) return null;
          return tokenCreatureDistance(state, geometry, actorIdA, actorIdB)?.value ?? null;
        };
        resolution = resolveDefinitionAction(state, action, { actorId, targetIds: resolvedTargetIds, commandId, conditionId: conditionId ?? null, rollMode: rollMode ?? null, override: override ?? null, builtin: isBuiltin, note: request.note ?? null, effectId: request.effectId ?? null, cover: request.cover ?? null }, { random: (sides) => context.random(sides), newRollId: context.newId, gmSessionId, now: () => new Date().toISOString(), hasCondition: (id) => contentLibrary.hasCondition(id), definition, distanceFeet, resolveDefinition: (definitionId) => storedDefinition(state, definitionId) ?? contentLibrary.monster(definitionId) });
        // Record the blast as a public shape so the whole table (and viewer) sees it; id=commandId keeps re-delivery idempotent.
        if (template) addAnnotation(state, { id: commandId, kind: "shape", shape: template.shape, origin: template.origin, target: template.target, visibility: "public", actor: { sessionId: gmSessionId, role: "gm" }, now: Date.now() }, geometry!);
      });
      if (!result.duplicate && resolution) {
        await context.publishGameState(result.state);
        const hidden = actorHidden(actorId);
        context.broadcastTableEvent({ kind: "action", text: `${actorName(actorId)} used ${resolution.actionName}.`, actorIds: [actorId], gmOnly: hidden });
        // Rules-engine narration (ADR-0020): overrides are loudly audited, warnings reach the GM,
        // applied rider effects and granted self effects reach the whole table.
        if (resolution.overridden) context.appendLog({ kind: "override", text: `OVERRIDE (${resolution.overridden.rule}): ${actorName(actorId)} used ${resolution.actionName} - ${resolution.overridden.reason}`, actorIds: [actorId] });
        for (const warning of resolution.warnings ?? []) context.appendLog({ kind: "action", text: `Rules note: ${warning}`, actorIds: [actorId], gmOnly: true });
        for (const applied of resolution.effectsApplied ?? []) {
          context.appendLog({ kind: "effect", text: `${applied.targetName} is ${applied.name}.`, actorIds: [applied.targetId], gmOnly: hidden });
          context.broadcastTableEvent({ kind: "effect", text: `${applied.targetName} is ${applied.name}.`, actorIds: [applied.targetId], gmOnly: hidden });
        }
        if (resolution.effectGranted) {
          context.appendLog({ kind: "effect", text: `${actorName(actorId)} gains ${resolution.effectGranted.name}.`, actorIds: [actorId], gmOnly: hidden });
          context.broadcastTableEvent({ kind: "effect", text: `${actorName(actorId)} gains ${resolution.effectGranted.name}.`, actorIds: [actorId], gmOnly: hidden });
        }
        // A reaction window opened: the rolled damage waits on the answer, so the whole table hears why nothing landed yet.
        for (const prompt of resolution.reactionPrompts ?? []) {
          const promptHidden = hidden || actorHidden(prompt.actorId);
          context.appendLog({ kind: "reaction", text: `${prompt.actorName} may use ${prompt.actionName} - the damage waits on their answer.`, actorIds: [prompt.actorId], gmOnly: promptHidden });
          context.broadcastTableEvent({ kind: "reaction", text: `${prompt.actorName} may use ${prompt.actionName}.`, actorIds: [prompt.actorId], gmOnly: promptHidden });
        }
        // Builtin check rolls (Hide, Influence, Search, Study, Escape) and rule-consequence endings
        // (attacking revealed Hiding; an off-turn action released a Ready) narrate to the table.
        if (resolution.check) {
          const verdict = resolution.check.success === null ? "" : resolution.check.success ? " - success" : " - failure";
          context.appendLog({ kind: "action", text: `${actorName(actorId)} rolled ${resolution.check.total} on ${resolution.check.skill}${resolution.check.dc !== null ? ` vs DC ${resolution.check.dc}` : ""}${verdict}.`, actorIds: [actorId], gmOnly: hidden });
        }
        for (const ended of resolution.effectsEnded ?? []) {
          context.appendLog({ kind: "effect", text: `${ended.name} ended on ${ended.actorName}.`, actorIds: [ended.actorId], gmOnly: hidden || actorHidden(ended.actorId) });
          context.broadcastTableEvent({ kind: "effect", text: `${ended.name} ended on ${ended.actorName}.`, actorIds: [ended.actorId], gmOnly: hidden || actorHidden(ended.actorId) });
        }
      }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(resolution && !result.duplicate ? { resolution } : {}) };
    },

    async saveAnswer(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SaveAnswerSchema, raw, "The saving-throw answer is malformed.", true);
      const scope = actorScopeOf(principal);
      const sessionId = sessionIdOf(principal);
      const { commandId, saveId, method, total, commit, legendaryResistance, expectedRevision } = request;
      const pending = store.snapshot.combat.pendingSaves.find((entry) => entry.id === saveId);
      let answered: ReturnType<typeof answerSave> | undefined;
      const result = await store.execute({ id: commandId, type: "save.answer", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        answered = answerSave(state, commandId, saveId, method, total, commit, scope, {
          random: (sides) => context.random(sides),
          newRollId: context.newId,
          sessionId,
          role: scope.role,
          now: () => new Date().toISOString(),
          resolveDefinition
        }, legendaryResistance);
      });
      const outcome = answered?.outcome;
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        if (outcome && outcome.committed && pending) context.broadcastTableEvent({ kind: "save", text: `${actorName(pending.targetActorId)} ${outcome.autoFailed ? "automatically failed" : outcome.success ? "succeeded on" : "failed"} a ${pending.ability.toUpperCase()} save${outcome.appliedDamage > 0 ? ` - ${outcome.appliedDamage} damage` : ""}.`, actorIds: [pending.targetActorId], gmOnly: actorHidden(pending.targetActorId) });
        publishNarrations(answered?.events ?? []);
      }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(outcome && !result.duplicate ? { outcome } : {}) };
    },

    async saveDismiss(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SaveDismissSchema, raw, "The dismissal is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, saveId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "save.dismiss", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => dismissSave(state, saveId, scope));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Reaction prompts (ADR-0020 amendment) ----------

    async reactionAnswer(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ReactionAnswerSchema, raw, "The reaction answer is malformed.");
      const scope = actorScopeOf(principal);
      const gmSessionId = sessionIdOf(principal);
      const { commandId, reactionId, use, actionId: chosenActionId, expectedRevision } = request;
      let outcome: ReturnType<typeof answerReaction> | undefined;
      const result = await store.execute({ id: commandId, type: "reaction.answer", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        outcome = answerReaction(state, commandId, reactionId, use, chosenActionId, scope, {
          resolveDefinition: (definitionId) => storedDefinition(state, definitionId) ?? contentLibrary.monster(definitionId),
          random: (sides) => context.random(sides),
          newRollId: context.newId,
          gmSessionId,
          now: () => new Date().toISOString()
        });
      });
      if (!result.duplicate && outcome) {
        await context.publishGameState(result.state);
        const hidden = actorHidden(outcome.actorId);
        if (outcome.kind === "leaves-reach") {
          if (outcome.used && outcome.resolution) {
            const attack = outcome.resolution.attack;
            const verdict = attack ? (attack.outcome === "crit" ? "CRIT" : attack.outcome.toUpperCase()) : "resolved";
            const text = `${outcome.actorName} made an opportunity attack against ${outcome.sourceName} - ${verdict}${outcome.appliedDamage > 0 ? `, ${outcome.appliedDamage} damage` : ""}.`;
            context.appendLog({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
            context.broadcastTableEvent({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
          }
        } else if (outcome.used) {
          const text = `${outcome.actorName} used ${outcome.actionName} - ${outcome.proposedDamage} damage becomes ${outcome.appliedDamage}.`;
          context.appendLog({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
          context.broadcastTableEvent({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
        } else {
          const text = `${outcome.actorName} declined ${outcome.actionName} - ${outcome.sourceName} hit for ${outcome.appliedDamage} damage.`;
          context.appendLog({ kind: "damage", text, actorIds: [outcome.actorId], gmOnly: hidden });
          context.broadcastTableEvent({ kind: "damage", text, actorIds: [outcome.actorId], gmOnly: hidden });
        }
        publishNarrations(outcome.events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(outcome && !result.duplicate ? { outcome: { used: outcome.used, appliedDamage: outcome.appliedDamage, ...(outcome.resolution ? { resolution: outcome.resolution } : {}) } } : {}) };
    },

    async reactionDismiss(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ReactionDismissSchema, raw, "The dismissal is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, reactionId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "reaction.dismiss", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => dismissReaction(state, reactionId, scope));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    /**
     * Server-computed action availability (read-only): per stat-block action, whether strict mode
     * would allow it right now and every violated rule - the same evaluation resolution runs, so the
     * report can never drift from enforcement. GM-grade any combatant; a player their claimed one.
     */
    actorAvailableActions(principal: GamePrincipal, raw: unknown) {
      const request = parse(ActorAvailableActionsSchema, raw, "The availability lookup is malformed.");
      const state = store.snapshot;
      const actor = state.actors.find((candidate) => candidate.id === request.actorId);
      if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
      if (!isGmGrade(principal) && actor.ownerSessionId !== principal.sessionId) throw new GameAccessDeniedError("You can only check your own character's actions.");
      const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
      if (actor.definitionId && !definition) throw new CommandRejectedError("That combatant's stat block is unavailable.");
      // Stat-block rows first, then the builtin generic actions (a stat block shadows a builtin id).
      const builtins = BUILTIN_ACTIONS.filter((candidate) => !definition?.actions.some((declared) => declared.id === candidate.id));
      return {
        rulesMode: state.combat.rulesMode,
        actions: [
          ...(definition ? actionAvailability(state, actor, definition.actions, definition) : []),
          ...actionAvailability(state, actor, builtins, definition, true)
        ]
      };
    },

    // ---------- Effects, death saves, rest (ADR-0020) ----------

    async effectAdd(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can add effects.");
      const request = parse(EffectAddSchema, raw, "The effect command is malformed.");
      const { commandId, actorId, name, tags, duration, modifiers, concentration, expectedRevision } = request;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "effect.add", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        events = [];
        addEffect(state, actorId, {
          id: commandId,
          name,
          tags: tags ? [...tags] : [],
          // A GM-added concentration effect is sustained by its bearer (damage to them prompts the CON save).
          sourceActorId: concentration ? actorId : null,
          sourceName: null,
          sourceActionId: null,
          startedRound: state.combat.round,
          duration: duration === undefined ? { type: "manual" } : duration.type === "rounds" ? { type: "rounds", remaining: duration.rounds } : duration,
          endsWhenSourceDefeated: false,
          voidWhileIncapacitated: false,
          concentration: concentration ?? false,
          modifiers: modifiers ? [...modifiers] : [],
          linkedConditionIds: [],
          escapeDc: null,
          onEnd: [],
          endsWithTag: null
        }, events);
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "effect", text: `${actorName(actorId)} gains ${name}.`, actorIds: [actorId], gmOnly: actorHidden(actorId) });
        context.broadcastTableEvent({ kind: "effect", text: `${actorName(actorId)} gains ${name}.`, actorIds: [actorId], gmOnly: actorHidden(actorId) });
        publishNarrations(events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate, effectId: commandId };
    },

    async effectEnd(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(EffectEndSchema, raw, "The effect command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, effectId, expectedRevision } = request;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "effect.end", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        // A player may end effects only on their own claimed character (the GM anyone) - same
        // boundary as hp/condition commands; ending fires onEnd and clears linked conditions.
        if (scope.role === "player") {
          const actor = state.actors.find((candidate) => candidate.id === actorId);
          if (!actor || actor.ownerSessionId !== scope.sessionId) throw new CommandRejectedError("You can only track your own character.");
        }
        events = endEffect(state, actorId, effectId);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); publishNarrations(events); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async deathSaveRoll(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(DeathSaveRollSchema, raw, "The death save is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, expectedRevision } = request;
      const rollId = context.newId();
      const initiatorSessionId = sessionIdOf(principal);
      let outcome: ReturnType<typeof resolveDeathSave> | undefined;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "death-save.roll", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (scope.role === "player" && actor.ownerSessionId !== scope.sessionId) throw new CommandRejectedError("You can only roll for your own character.");
        if (actor.deathSaves === null || actor.hp.current > 0) throw new CommandRejectedError("That character isn't dying.");
        if (actor.deathSaves.stable) throw new CommandRejectedError("A stable character doesn't roll death saves.");
        if (actor.deathSaves.failures >= 3) throw new CommandRejectedError("That character is dead - heal or revive them through the GM.");
        const face = context.random(20);
        outcome = resolveDeathSave(actor.deathSaves, face);
        actor.deathSaves = outcome.state;
        // The roll lands in the shared history under the dying character's name and real initiator role.
        const record: RollRecord = {
          id: rollId, commandId, initiatorSessionId, initiatorRole: isGmGrade(principal) ? "gm" : "player", initiatorLabel: actor.name, actorId,
          purpose: "save", visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
          formula: "1d20", normalizedFormula: "1d20",
          dice: [{ group: 0, sides: 20, face, kept: true, sign: 1 }], modifiers: [], total: face, createdAt: new Date().toISOString()
        };
        state.rolls.push(record);
        if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
        if (outcome.regainsOneHitPoint) {
          events = healActor(state, actorId, 1, { role: "gm" });
        }
      });
      if (!result.duplicate && outcome) {
        await context.publishGameState(result.state);
        const hidden = actorHidden(actorId);
        const text = outcome.regainsOneHitPoint ? `${actorName(actorId)} rolled a natural 20 on a death save and regains 1 HP!`
          : outcome.dead ? `${actorName(actorId)} failed a third death save and dies.`
          : outcome.state.stable ? `${actorName(actorId)} is stable.`
          : `${actorName(actorId)} ${outcome.outcome === "critical-failure" ? "rolled a natural 1 - two death save failures" : outcome.outcome === "success" ? "succeeded on a death save" : "failed a death save"} (${outcome.state.successes}S/${outcome.state.failures}F).`;
        context.appendLog({ kind: "death-save", text, actorIds: [actorId], gmOnly: hidden });
        context.broadcastTableEvent({ kind: "death-save", text, actorIds: [actorId], gmOnly: hidden });
        publishNarrations(events);
      }
      return {
        revision: result.state.revision, duplicate: result.duplicate, rollId,
        ...(outcome && !result.duplicate ? { deathSave: { naturalRoll: result.state.rolls.find((roll) => roll.id === rollId)?.total ?? 0, outcome: outcome.outcome, successes: outcome.state.successes, failures: outcome.state.failures, stable: outcome.state.stable, dead: outcome.dead, regainedConsciousness: outcome.regainsOneHitPoint } } : {})
      };
    },

    async encounterSetRulesMode(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change the rules mode.");
      const request = parse(SetRulesModeSchema, raw, "The rules-mode command is malformed.");
      const { commandId, mode, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "encounter.set-rules-mode", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.combat = { ...state.combat, rulesMode: mode };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `Rules mode set to ${mode}.`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async encounterSetEnvironment(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change the encounter environment.");
      const request = parse(SetEnvironmentSchema, raw, "The environment command is malformed.");
      const { commandId, underwater, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "encounter.set-environment", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.combat = { ...state.combat, underwater };
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: underwater ? "The fight is now underwater: melee has Disadvantage unless it deals piercing damage, ranged attacks miss beyond normal range, and everyone resists fire." : "The fight is no longer underwater.", gmOnly: false });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorRest(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can apply a rest.");
      const request = parse(ActorRestSchema, raw, "The rest command is malformed.");
      const { commandId, actorId, kind, expectedRevision } = request;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "actor.rest", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        events = applyRest(state, actorId, kind, resolveDefinition);
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "heal", text: `${actorName(actorId)} completed a ${kind} rest.`, actorIds: [actorId], gmOnly: actorHidden(actorId) });
        publishNarrations(events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSpendHitDice(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ActorSpendHitDiceSchema, raw, "The hit-dice command is malformed.");
      const scope = actorScopeOf(principal);
      const initiatorSessionId = sessionIdOf(principal);
      const { commandId, actorId, count, expectedRevision } = request;
      // Roll BEFORE the store executes (the dice.roll pattern): a duplicate retry replays the stored
      // outcome and must not consume fresh randomness. Sides come from the snapshot; the execute
      // callback re-validates against live state.
      const snapshotActor = store.snapshot.actors.find((candidate) => candidate.id === actorId);
      const sides = snapshotActor?.hitDice ? Number.parseInt(snapshotActor.hitDice.die.slice(1), 10) : 8;
      const faces = Array.from({ length: count }, () => context.random(sides));
      const rollId = context.newId();
      let healed = 0;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "actor.spend-hit-dice", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const outcome = spendHitDice(state, actorId, faces, scope, (definitionId) => storedDefinition(state, definitionId) ?? contentLibrary.monster(definitionId));
        healed = outcome.healed;
        events = outcome.events;
        const actor = state.actors.find((candidate) => candidate.id === actorId)!;
        // The dice land in the shared roll history so the table sees the heal happen; hidden actors stay GM-only.
        const record: RollRecord = {
          id: rollId, commandId, initiatorSessionId, initiatorRole: scope.role, initiatorLabel: actor.name, actorId,
          purpose: "manual", visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
          formula: `${count}${actor.hitDice!.die}${outcome.conModifier !== 0 ? ` ${outcome.conModifier < 0 ? "-" : "+"} ${Math.abs(outcome.conModifier * count)}` : ""}`,
          normalizedFormula: `${count}${actor.hitDice!.die}`,
          dice: faces.map((face) => ({ group: 0, sides, face, kept: true, sign: 1 as const })),
          modifiers: outcome.conModifier !== 0 ? [{ value: Math.abs(outcome.conModifier * count), sign: (outcome.conModifier < 0 ? -1 : 1) as -1 | 1 }] : [],
          total: outcome.healed, createdAt: new Date().toISOString()
        };
        state.rolls.push(record);
        if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "heal", text: `${actorName(actorId)} spends ${count} Hit ${count === 1 ? "Die" : "Dice"} and regains ${healed} HP.`, actorIds: [actorId], gmOnly: actorHidden(actorId) });
        publishNarrations(events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Fog of war ----------

    async fogSetEnabled(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM controls the fog of war.");
      const request = parse(FogSetEnabledSchema, raw, "The fog command is malformed.");
      const { commandId, enabled, sceneId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "fog.set-enabled", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setFogEnabled(state, sceneId, enabled));
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        if (sceneId === undefined) context.appendLog({ kind: "scene", text: enabled ? "Fog of war enabled - unrevealed ground is hidden from players." : "Fog of war disabled.", gmOnly: true });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async fogPaint(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM controls the fog of war.");
      const request = parse(FogPaintSchema, raw, "The fog stroke is malformed.");
      const { commandId, op, rect, sceneId, expectedRevision } = request;
      // Geometry comes from whichever map the stroke targets: the live table's, or the parked scene's own.
      const mapAssetId = sceneId === undefined
        ? store.snapshot.combat.mapAssetId
        : store.snapshot.combat.scenes.find((scene) => scene.id === sceneId)?.mapAssetId ?? null;
      if (!mapAssetId) throw new CommandRejectedError("Pick a map before painting fog.");
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const shapeId = context.newId();
      const result = await store.execute({ id: commandId, type: "fog.paint", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => paintFog(state, sceneId, geometry, { id: shapeId, op, rect }));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async fogReset(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM controls the fog of war.");
      const request = parse(FogResetSchema, raw, "The fog command is malformed.");
      const { commandId, sceneId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "fog.reset", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => resetFog(state, sceneId));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Annotations ----------

    async annotationAdd(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationAddSchema, raw, "The annotation is malformed.");
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) throw new CommandRejectedError("Start an encounter before adding to the map.");
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const { commandId, kind, shape, geometry: geometryInput, visibility, visibleToActorId, movableByOthers, color, expectedRevision } = request;
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.add", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try again.");
        addAnnotation(state, { id: commandId, kind, shape, origin: geometryInput.origin, target: geometryInput.target, visibility: visibility ?? "public", visibleToActorId: visibleToActorId ?? null, movableByOthers, color, actor, now: Date.now() }, geometry);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.scheduleAnnotationExpiry(); }
      return { revision: result.state.revision, duplicate: result.duplicate, annotationId: commandId };
    },

    async annotationPing(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationPingSchema, raw, "The ping is malformed.");
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) throw new CommandRejectedError("Start an encounter before pinging the map.");
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const { commandId, point, color, expectedRevision } = request;
      const sessionId = sessionIdOf(principal);
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.ping", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try again.");
        const label = isGmGrade(principal) ? gmGradeLabelOf(principal) : state.actors.find((candidate) => candidate.ownerSessionId === sessionId)?.name ?? "A player";
        addPing(state, { id: commandId, point, label, color, actor, now: Date.now() }, geometry);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.scheduleAnnotationExpiry(); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async annotationSetColor(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationColorSetSchema, raw, "The color change is malformed.");
      const { commandId, id, color, expectedRevision } = request;
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.set-color", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { setAnnotationColor(state, id, color, actor); });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async annotationMove(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationMoveSchema, raw, "The annotation update is malformed.");
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) throw new CommandRejectedError("Start an encounter before editing the map.");
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const { commandId, id, geometry: geometryInput, expectedRevision } = request;
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.move", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        moveAnnotation(state, id, geometryInput.origin, geometryInput.target, actor, geometry);
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async annotationRemove(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationRemoveSchema, raw, "The annotation command is malformed.");
      const { commandId, id, expectedRevision } = request;
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.remove", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { removeAnnotation(state, id, actor); });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async annotationSetVisibility(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationVisibilitySetSchema, raw, "The visibility change is malformed.");
      const { commandId, id, visibility, visibleToActorId, expectedRevision } = request;
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.set-visibility", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { setAnnotationVisibility(state, id, visibility, visibleToActorId ?? null, actor); });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async annotationSetMovable(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationMovableSetSchema, raw, "The move-control change is malformed.");
      const { commandId, id, movableByOthers, expectedRevision } = request;
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.set-movable", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { setAnnotationMovable(state, id, movableByOthers, actor); });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async annotationClear(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(AnnotationClearSchema, raw, "The clear command is malformed.");
      const { commandId, scope, expectedRevision } = request;
      const actor = annotationActorOf(principal);
      const result = await store.execute({ id: commandId, type: "annotation.clear", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { clearAnnotations(state, scope, actor); });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Character claims ----------

    async characterClaim(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      // Claims bind a character to a PLAYER session; GM sessions and integrations (GM authority) are
      // refused with the table's own message. Integrations wanting a seat hold a player session.
      if (isGmGrade(principal)) throw new GameAccessDeniedError("GM sessions do not claim player characters.");
      const request = parse(ActorRemoveSchema, raw, "The claim command is malformed.");
      const { commandId, actorId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.claim", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => claimCharacter(state, actorId, principal.sessionId));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterRelease(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      // Same audience rule as the socket: only a player session has claims to release.
      if (isGmGrade(principal)) throw new GameAccessDeniedError("Join a session first.");
      const request = parse(CommandIdentitySchema, raw, "The release command is malformed.");
      const { commandId, expectedRevision } = request;
      const sessionId = principal.sessionId;
      const result = await store.execute({ id: commandId, type: "character.release", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => releaseCharactersForSession(state, sessionId));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterForceRelease(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can force-release a character.");
      const request = parse(ActorRemoveSchema, raw, "The force-release command is malformed.");
      const { commandId, actorId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.force-release", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => forceReleaseCharacter(state, actorId, "gm"));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Actor cosmetics ----------

    async actorSetTokenImage(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can set token images.");
      const request = parse(SetTokenImageSchema, raw, "The token image command is malformed.");
      const { commandId, actorId, tokenAssetId, expectedRevision } = request;
      if (tokenAssetId !== null && !context.tokenCatalog.get(tokenAssetId)) throw new CommandRejectedError("That token image is not in your library.");
      const result = await store.execute({ id: commandId, type: "actor.set-token-image", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((item) => item.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (tokenAssetId === null) delete actor.tokenAssetId; else actor.tokenAssetId = tokenAssetId;
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        if (tokenAssetId !== null) {
          context.tokenCatalog.touchLastUsed(tokenAssetId);
          const definitionId = result.state.actors.find((item) => item.id === actorId)?.definitionId;
          if (definitionId) context.tokenCatalog.rememberForDefinition(definitionId, tokenAssetId);
        }
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetSpeed(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can set movement speed.");
      const request = parse(ActorSetSpeedSchema, raw, "The speed command is malformed.");
      const { commandId, actorId, speedFeet, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.set-speed", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (speedFeet === null) delete actor.speedFeet; else actor.speedFeet = speedFeet;
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetSize(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can resize tokens.");
      const request = parse(SetActorSizeSchema, raw, "The token size command is malformed.");
      const { commandId, actorId, size, expectedRevision } = request;
      const mapAssetId = store.snapshot.combat.mapAssetId;
      const geometry = mapAssetId ? await context.tokenGeometryFor(mapAssetId) : null;
      const result = await store.execute({ id: commandId, type: "actor.set-size", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setActorSize(state, actorId, size, geometry));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetVisibility(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change token visibility.");
      const request = parse(SetActorVisibilitySchema, raw, "The token visibility command is malformed.");
      const { commandId, actorId, visibility, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.set-visibility", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setActorVisibility(state, actorId, visibility));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Scenes ----------

    async sceneCreate(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can prepare scenes.");
      const request = parse(SceneCreateSchema, raw, "The scene setup is malformed.");
      const sceneMap = context.mapCatalog.get(request.mapAssetId);
      if (!sceneMap || sceneMap.kind !== "battlemap") throw new CommandRejectedError("Prepare scenes on an uploaded battlemap.");
      const { commandId, name, mapAssetId, combatantIds, expectedRevision } = request;
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const result = await store.execute({ id: commandId, type: "scene.create", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { createScene(state, { sceneId: commandId, name, mapAssetId, combatantIds }, geometry); });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate, sceneId: commandId };
    },

    async sceneRename(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can rename scenes.");
      const request = parse(SceneRenameSchema, raw, "The scene rename is malformed.");
      const { commandId, sceneId, name, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "scene.rename", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => renameScene(state, sceneId, name));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async sceneRemove(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can remove scenes.");
      const request = parse(SceneIdSchema, raw, "The scene command is malformed.");
      const { commandId, sceneId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "scene.remove", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => removeScene(state, sceneId));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async sceneActivate(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can switch scenes.");
      const request = parse(SceneIdSchema, raw, "The scene command is malformed.");
      const { commandId, sceneId, expectedRevision } = request;
      const result = await store.executeTimeline({ id: commandId, type: "scene.activate", expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        activateScene(state, sceneId, commandId); // rejects while rewound
        // Snapshots belong to the scene that was live; the swap invalidates them, so start clean.
        timeline.truncateAll();
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        const scene = result.state.combat.scenes.find((candidate) => candidate.id === sceneId);
        context.appendLog({ kind: "scene", text: `Switched to scene "${scene?.name ?? "Untitled"}".`, gmOnly: true });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async sceneSetCombatants(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change a scene's combatants.");
      const request = parse(SceneSetCombatantsSchema, raw, "The scene update is malformed.");
      const { commandId, sceneId, combatantIds, expectedRevision } = request;
      const scene = store.snapshot.combat.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new CommandRejectedError("That scene no longer exists.");
      const geometry = await context.tokenGeometryFor(scene.mapAssetId);
      const result = await store.execute({ id: commandId, type: "scene.set-combatants", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setSceneCombatants(state, sceneId, combatantIds, geometry));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    }
  };
}

/**
 * The command catalog for the generic HTTP tunnel (`POST /api/v1/game/commands`), its GET discovery
 * listing, AND the typed HTTP routes (which derive their scope + handler from here rather than
 * restating them). Types use the store's dot-separated receipt form - the same strings the archive
 * journal and `domain_events` table record. Scopes come from `GAME_COMMAND_SCOPES` (single source).
 */
export type GameCommandDescriptor = Readonly<{
  type: GameCommandType;
  scope: IntegrationScope;
  summary: string;
  run: (principal: GamePrincipal, payload: unknown) => Promise<GameMutationResult>;
}>;

export function gameCommandRegistry(operations: GameOperations): ReadonlyMap<string, GameCommandDescriptor> {
  const entries: ReadonlyArray<[GameCommandType, string, GameCommandDescriptor["run"]]> = [
    ["encounter.start", "Start an encounter on a battlemap with initial combatants (GM).", (p, raw) => operations.encounterStart(p, raw)],
    ["encounter.end", "End the encounter and archive it permanently (GM).", (p, raw) => operations.encounterEnd(p, raw)],
    ["encounter.add-combatant", "Add a rostered actor to the running encounter (GM).", (p, raw) => operations.encounterAddCombatant(p, raw)],
    ["initiative.set", "Set a combatant's initiative score (GM).", (p, raw) => operations.initiativeSet(p, raw)],
    ["initiative.next", "Advance the turn; steps forward through recorded history while rewound (GM).", (p, raw) => operations.initiativeNext(p, raw)],
    ["initiative.previous", "Rewind the whole table to the previous turn boundary (GM).", (p, raw) => operations.initiativePrevious(p, raw)],
    ["turn.end", "End the current turn (GM anyone; a player only their own turn).", (p, raw) => operations.turnEnd(p, raw)],
    ["turn.use", "Mark the current turn's action or bonus action used/unused.", (p, raw) => operations.turnUse(p, raw)],
    ["turn.use-reaction", "Mark a combatant's reaction used/unused.", (p, raw) => operations.turnUseReaction(p, raw)],
    ["turn.use-legendary", "Set a legendary creature's spent legendary actions this round.", (p, raw) => operations.turnUseLegendary(p, raw)],
    ["token.move", "Move a combatant's token (server-snapped); position null returns it to the tray.", (p, raw) => operations.tokenMove(p, raw)],
    ["actor.add-from-definition", "Instantiate a bundled SRD monster onto the roster (GM).", (p, raw) => operations.actorAddFromDefinition(p, raw)],
    ["actor.import-definition", "Import a canonical ActorDefinition JSON as a claimable actor (GM).", (p, raw) => operations.actorImportDefinition(p, raw)],
    ["actor.remove", "Remove an actor from the roster (GM).", (p, raw) => operations.actorRemove(p, raw)],
    ["actor.apply-damage", "Apply damage (GM anyone; a player their claimed character).", (p, raw) => operations.actorApplyDamage(p, raw)],
    ["actor.heal", "Heal hit points (GM anyone; a player their claimed character).", (p, raw) => operations.actorHeal(p, raw)],
    ["actor.set-temp-hp", "Set temporary hit points (GM anyone; a player their claimed character).", (p, raw) => operations.actorSetTempHp(p, raw)],
    ["actor.set-hp", "Set current hit points directly (GM).", (p, raw) => operations.actorSetHp(p, raw)],
    ["actor.set-condition", "Apply or clear an SRD condition, with exhaustion levels.", (p, raw) => operations.actorSetCondition(p, raw)],
    ["dice.roll", "Roll dice into the shared, auditable roll history.", (p, raw) => operations.diceRoll(p, raw)],
    ["action.resolve", "Run a stat-block action: attack vs AC or save-DC with typed damage (GM).", (p, raw) => operations.actionResolve(p, raw)],
    ["save.answer", "Answer a pending saving throw by rolling or entering a total.", (p, raw) => operations.saveAnswer(p, raw)],
    ["save.dismiss", "Dismiss a pending saving throw without resolving it.", (p, raw) => operations.saveDismiss(p, raw)],
    ["reaction.answer", "Answer a pending reaction prompt: use it (spend the reaction, halve the parked damage) or decline (apply it in full).", (p, raw) => operations.reactionAnswer(p, raw)],
    ["reaction.dismiss", "Dismiss a pending reaction prompt without applying its damage (GM).", (p, raw) => operations.reactionDismiss(p, raw)],
    ["effect.add", "Add a rules-engine effect to a combatant (GM).", (p, raw) => operations.effectAdd(p, raw)],
    ["effect.end", "End an effect (GM anyone; a player their claimed character), clearing linked conditions and firing its on-end grants.", (p, raw) => operations.effectEnd(p, raw)],
    ["death-save.roll", "Roll a death saving throw for a dying character (GM anyone; a player their claimed character).", (p, raw) => operations.deathSaveRoll(p, raw)],
    ["encounter.set-rules-mode", "Set the rules-engine enforcement mode: strict, assisted, or freeform (GM).", (p, raw) => operations.encounterSetRulesMode(p, raw)],
    ["encounter.set-environment", "Toggle the underwater environment: melee disadvantage unless piercing, ranged auto-miss beyond normal range, fire resistance for all (GM).", (p, raw) => operations.encounterSetEnvironment(p, raw)],
    ["actor.rest", "Apply a long rest: full HP, cleared dying state, refreshed limited uses, one less Exhaustion level (GM).", (p, raw) => operations.actorRest(p, raw)],
    ["actor.spend-hit-dice", "Spend Hit Point Dice to heal on a short rest (roll + Con modifier each, minimum 1).", (p, raw) => operations.actorSpendHitDice(p, raw)],
    ["annotation.add", "Draw a measurement or area shape on the encounter map.", (p, raw) => operations.annotationAdd(p, raw)],
    ["annotation.ping", "Ping a point on the encounter map.", (p, raw) => operations.annotationPing(p, raw)],
    ["annotation.move", "Move or resize an annotation you may edit.", (p, raw) => operations.annotationMove(p, raw)],
    ["annotation.remove", "Remove an annotation you may edit.", (p, raw) => operations.annotationRemove(p, raw)],
    ["annotation.set-color", "Change an annotation's color.", (p, raw) => operations.annotationSetColor(p, raw)],
    ["annotation.set-visibility", "Change who can see an annotation.", (p, raw) => operations.annotationSetVisibility(p, raw)],
    ["annotation.set-movable", "Allow or disallow other players moving a shape.", (p, raw) => operations.annotationSetMovable(p, raw)],
    ["annotation.clear", "Clear drawn shapes by scope (mine/players/all).", (p, raw) => operations.annotationClear(p, raw)],
    ["character.claim", "Claim an unclaimed player character for the calling player session.", (p, raw) => operations.characterClaim(p, raw)],
    ["character.release", "Release every character claimed by the calling player session.", (p, raw) => operations.characterRelease(p, raw)],
    ["character.force-release", "Force-release a claimed character (GM).", (p, raw) => operations.characterForceRelease(p, raw)],
    ["actor.set-token-image", "Set or clear a combatant's token image from the token library (GM).", (p, raw) => operations.actorSetTokenImage(p, raw)],
    ["actor.set-size", "Set a combatant's creature size; the token re-snaps to its footprint (GM).", (p, raw) => operations.actorSetSize(p, raw)],
    ["actor.set-visibility", "Move a combatant between the shared layer and the GM-only layer (GM).", (p, raw) => operations.actorSetVisibility(p, raw)],
    ["actor.set-speed", "Set a combatant's walking speed in feet (null clears to unknown, skipping movement rules) (GM).", (p, raw) => operations.actorSetSpeed(p, raw)],
    ["scene.create", "Prepare a staged scene on a battlemap without touching the live table (GM).", (p, raw) => operations.sceneCreate(p, raw)],
    ["scene.rename", "Rename a prepared scene (GM).", (p, raw) => operations.sceneRename(p, raw)],
    ["scene.remove", "Remove a prepared scene (GM).", (p, raw) => operations.sceneRemove(p, raw)],
    ["scene.activate", "Switch the live table to a prepared scene, parking the current one (GM).", (p, raw) => operations.sceneActivate(p, raw)],
    ["scene.set-combatants", "Replace a prepared scene's combatant list (GM).", (p, raw) => operations.sceneSetCombatants(p, raw)],
    ["fog.set-enabled", "Turn manual fog of war on/off for the live table or a prepared scene (GM).", (p, raw) => operations.fogSetEnabled(p, raw)],
    ["fog.paint", "Paint a reveal/hide fog rect, grid-snapped and clamped to the map (GM).", (p, raw) => operations.fogPaint(p, raw)],
    ["fog.reset", "Hide the whole map again (clear every fog stroke) (GM).", (p, raw) => operations.fogReset(p, raw)]
  ];
  return new Map<string, GameCommandDescriptor>(entries.map(([type, summary, run]) => [type, { type, scope: GAME_COMMAND_SCOPES[type], summary, run }]));
}
