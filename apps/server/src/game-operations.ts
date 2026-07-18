import { z } from "zod";
import type { CombatLogEntry, GameState, GmView, PlayerView, RollRecord, TableEvent } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { IntegrationScope } from "@vtt/api-contract";
import { addAnnotation, addPing, clearAnnotations, moveAnnotation, removeAnnotation, setAnnotationColor, setAnnotationMovable, setAnnotationVisibility, shapeGeometry, type AnnotationActor } from "./annotations.js";
import { setCondition } from "./actor-conditions.js";
import { resolveDefinitionAction } from "./action-resolution.js";
import { parseAreaProse, tokensInTemplate } from "./area-targeting.js";
import { addActorFromDefinition, importActorDefinition, removeActor, storedDefinition } from "./actor-roster.js";
import type { CombatLogStore } from "./combat-log.js";
import type { ContentLibrary } from "./content-library.js";
import { addCombatant, endEncounter, setInitiativeScore, startEncounter } from "./encounter.js";
import { buildEncounterArchive } from "./encounter-archive.js";
import { planNextTurn, planPreviousTurn, turnLabel, type TimelineOutcome } from "./combat-history.js";
import { CommandRejectedError, type GameStore, type JournalEntry } from "./game-store.js";
import { applyDamage, healActor, setCurrentHp, setTemporaryHp, type ActorScope } from "./hit-points.js";
import { moveEncounterToken, moveSceneToken, type TokenMapGeometry } from "./token-placement.js";
import { answerSave, dismissSave } from "./saving-throws.js";
import { endTurn, setReactionUsed, setTurnSlot } from "./turn-economy.js";
import {
  ActionResolveSchema, ActorAddFromDefinitionSchema, ActorImportDefinitionSchema, ActorRemoveSchema, AddCombatantSchema,
  AnnotationAddSchema, AnnotationClearSchema, AnnotationColorSetSchema, AnnotationMovableSetSchema, AnnotationMoveSchema,
  AnnotationPingSchema, AnnotationRemoveSchema, AnnotationVisibilitySetSchema, CommandIdentitySchema, ContentActionsSchema,
  DiceRollSchema, EncounterStartSchema, HpAmountSchema, InitiativeNextSchema, InitiativePreviousSchema, InitiativeScoreSchema,
  SaveAnswerSchema, SaveDismissSchema, SetConditionSchema, SetHpSchema, TempHpSchema, TokenMoveSchema, TurnReactionSchema, TurnUseSchema
} from "./game-commands.js";

/**
 * Transport-agnostic game capabilities. Both adapters — the Socket.IO handlers in `server.ts` and
 * the public HTTP API in `game-http.ts` — validate, authorize, execute, and narrate through these
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
 * Who is acting. GM sessions and GM-minted integration credentials both act with GM authority —
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

    contentMonsterActions(principal: GamePrincipal, raw: unknown) {
      requireGmGrade(principal, "Only the GM can browse stat blocks.");
      const request = parse(ContentActionsSchema, raw, "The action lookup is malformed.");
      const imported = storedDefinition(store.snapshot, request.definitionId);
      const actions = imported
        ? imported.actions.map((action) => ({ id: action.id, name: action.name, activation: action.activation, description: action.description, attackBonus: action.attack?.bonus ?? null, reachFeet: action.attack?.reachFeet ?? null, rangeFeet: action.attack?.rangeFeet ?? null, saveAbility: action.save?.ability ?? null, saveDc: action.save?.dc ?? null, damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })), area: parseAreaProse(action.description) }))
        : contentLibrary.monsterActionSummaries(request.definitionId);
      if (!actions) throw new CommandRejectedError("That stat block is not in the bundled content.");
      return { actions };
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
      const { commandId, mapAssetId, entries, expectedRevision } = request;
      const tokenGeometry = await context.tokenGeometryFor(mapAssetId);
      const result = await store.executeTimeline({ id: commandId, type: "encounter.start", expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        startEncounter(state, { mapAssetId, entries }, () => context.random(20), tokenGeometry);
        // Fresh fight: clear any prior encounter's snapshots and record this start as the baseline
        // the GM can always rewind back to (a distinct label so it reads apart from turn boundaries).
        timeline.truncateAll();
        // The previous fight's journal goes with it; this very command stays as the new fight's first entry.
        timeline.clearJournal(commandId);
        timeline.capture("turn", `Combat begins — ${turnLabel(state)}`, state);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: "The encounter began.", gmOnly: false }); context.logTurnBegin(result.state); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async encounterEnd(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can end an encounter.");
      const request = parse(CommandIdentitySchema, raw, "The encounter command is malformed.");
      const { commandId, expectedRevision } = request;
      const tag = principalTag(principal);
      const result = await store.executeTimeline({ id: commandId, type: "encounter.end", expectedRevision, payload: request, principal: tag }, (state, timeline) => {
        // The last live picture of the fight, captured before endEncounter clears the combat.
        const finalState = structuredClone(state);
        endEncounter(state); // rejects while rewound
        // Auto-archive the whole fight permanently BEFORE wiping the live buffers — same transaction,
        // so an ended encounter's record can never be lost. Skip a fight that captured no boundaries.
        const entries = timeline.entries();
        if (entries.length > 0) {
          const endedAt = new Date().toISOString();
          const journal = timeline.journalEntries();
          // This end command's own journal row is written after the plan's clear wipes the table, so
          // append it to the document explicitly — the archive then covers the fight end-to-end.
          const endEntry: JournalEntry = { seq: (journal[journal.length - 1]?.seq ?? 0) + 1, commandId, type: "encounter.end", actorId: null, principal: tag, payload: request, revision: state.revision + 1, at: endedAt };
          const document = buildEncounterArchive({
            entries,
            readState: timeline.read,
            // The combat log persists independently; the fight's slice starts at its first boundary's revision.
            log: context.combatLog.exportSince(entries[0].revision),
            journal: [...journal, endEntry],
            finalState,
            endedAt,
            resolveBundledDefinition: (definitionId) => contentLibrary.monster(definitionId),
            attribution: contentLibrary.attribution
          });
          timeline.archive({ commandId, startedAt: document.startedAt, endedAt: document.endedAt, turnCount: document.turnCount, documentJson: JSON.stringify(document) });
        }
        timeline.truncateAll(); // the fight is over — its live turn snapshots go with it
        timeline.clearJournal();
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: "The encounter ended.", gmOnly: false }); }
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
      // (reaching the return-point resumes live). Rewound and changed: rewrite history — but only
      // once the GM confirms, which the plan demands by throwing TimelineConfirmationRequired.
      let outcome: TimelineOutcome | undefined;
      const result = await store.executeTimeline({ id: request.commandId, type: "initiative.next", expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        outcome = planNextTurn(state, timeline, request.confirmRewrite === true);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); if (outcome) context.logTimelineOutcome(outcome, result.state); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async initiativePrevious(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can move Initiative backward.");
      const request = parse(InitiativePreviousSchema, raw, "The Initiative command is malformed.");
      // From live, park a return-point and restore the last boundary; while rewound, step further
      // back — unless the GM changed things here, where confirming discards those changes in place.
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
      const result = await store.executeTimeline({ id: request.commandId, type: "turn.end", expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        if (state.combat.historyCursor !== null) throw new CommandRejectedError("The GM is reviewing an earlier turn. Try again once play resumes.");
        planNextTurn(state, timeline, false, (advancing) => endTurn(advancing, scope));
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.logTurnBegin(result.state); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async turnUse(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(TurnUseSchema, raw, "The turn command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, slot, used, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "turn.use", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setTurnSlot(state, slot, used, scope));
      if (!result.duplicate) await context.publishGameState(result.state);
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
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const result = await store.execute({ id: commandId, type: "token.move", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try moving the token again.");
        if (!isGmGrade(principal)) {
          const actor = state.actors.find((candidate) => candidate.id === actorId);
          if (!actor || actor.ownerSessionId !== principal.sessionId) throw new CommandRejectedError("You may only move your claimed character token.");
        }
        moveEncounterToken(state, actorId, position, geometry);
      });
      if (!result.duplicate) await context.publishGameState(result.state);
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
      const request = parse(HpAmountSchema, raw, "The damage command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, amount, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.apply-damage", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => applyDamage(state, actorId, amount, scope));
      if (!result.duplicate) { await context.publishGameState(result.state); context.broadcastTableEvent({ kind: "damage", text: `${actorName(actorId)} took ${amount} damage.`, actorIds: [actorId] }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorHeal(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(HpAmountSchema, raw, "The healing command is malformed.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, amount, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.heal", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => healActor(state, actorId, amount, scope));
      if (!result.duplicate) { await context.publishGameState(result.state); context.broadcastTableEvent({ kind: "heal", text: `${actorName(actorId)} healed ${amount}.`, actorIds: [actorId] }); }
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
      const result = await store.execute({ id: commandId, type: "actor.set-hp", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setCurrentHp(state, actorId, current, { role: "gm" }));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetCondition(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SetConditionSchema, raw, "The condition command is malformed.");
      if (!contentLibrary.hasCondition(request.conditionId)) throw new CommandRejectedError("That condition is not in the bundled rules.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, conditionId, active, level, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.set-condition", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => setCondition(state, actorId, conditionId, active, level, scope));
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        const conditionName = contentLibrary.conditionSummaries().find((entry) => entry.id === conditionId)?.name ?? conditionId;
        context.broadcastTableEvent({ kind: "condition", text: active ? `${actorName(actorId)} is ${conditionName}${conditionId === "exhaustion" && level ? ` ${level}` : ""}.` : `${actorName(actorId)} is no longer ${conditionName}.`, actorIds: [actorId] });
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
      const { commandId, actorId, actionId, targetIds, template, conditionId, expectedRevision } = request;
      if (conditionId !== undefined && !contentLibrary.hasCondition(conditionId)) throw new CommandRejectedError("That condition is not in the bundled reference.");
      // A template needs the map's grid up front (async fetch) so containment runs inside the mutation.
      const mapAssetId = store.snapshot.combat.mapAssetId;
      const geometry = template && mapAssetId ? await context.tokenGeometryFor(mapAssetId) : null;
      if (template && (!mapAssetId || !geometry?.calibration)) throw new CommandRejectedError("Calibrate this map before placing an area template.");
      const gmSessionId = sessionIdOf(principal);
      let resolution: ReturnType<typeof resolveDefinitionAction> | undefined;
      const result = await store.execute({ id: commandId, type: "action.resolve", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const attacker = state.actors.find((item) => item.id === actorId);
        if (!attacker?.definitionId) throw new CommandRejectedError("That combatant has no stat-block actions.");
        const action = (storedDefinition(state, attacker.definitionId) ?? contentLibrary.monster(attacker.definitionId))?.actions.find((candidate) => candidate.id === actionId);
        if (!action) throw new CommandRejectedError("That action is not on the stat block.");
        let resolvedTargetIds: readonly string[];
        if (template) {
          if (action.attack) throw new CommandRejectedError("Attacks target a single token — pick it directly instead of placing a template.");
          if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try again.");
          const calibration = geometry!.calibration!;
          // Snap the template the same way the drawn annotation will, then find who is under it.
          const snapped = shapeGeometry(calibration, template.shape, template.origin, template.target);
          resolvedTargetIds = tokensInTemplate(state, calibration, snapped, template.shape, parseAreaProse(action.description)?.widthFeet ?? null)
            .filter((id) => id !== actorId && state.combat.initiative.some((entry) => entry.actorId === id));
          if (resolvedTargetIds.length === 0) throw new CommandRejectedError("No combatants are inside that area.");
        } else {
          resolvedTargetIds = targetIds!;
        }
        resolution = resolveDefinitionAction(state, action, { actorId, targetIds: resolvedTargetIds, commandId, conditionId: conditionId ?? null }, { random: (sides) => context.random(sides), newRollId: context.newId, gmSessionId, now: () => new Date().toISOString(), hasCondition: (id) => contentLibrary.hasCondition(id) });
        // Record the blast as a public shape so the whole table (and viewer) sees it; id=commandId keeps re-delivery idempotent.
        if (template) addAnnotation(state, { id: commandId, kind: "shape", shape: template.shape, origin: template.origin, target: template.target, visibility: "public", actor: { sessionId: gmSessionId, role: "gm" }, now: Date.now() }, geometry!);
      });
      if (!result.duplicate) { await context.publishGameState(result.state); if (resolution) context.broadcastTableEvent({ kind: "action", text: `${actorName(actorId)} used ${resolution.actionName}.`, actorIds: [actorId], gmOnly: actorHidden(actorId) }); }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(resolution && !result.duplicate ? { resolution } : {}) };
    },

    async saveAnswer(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SaveAnswerSchema, raw, "The saving-throw answer is malformed.", true);
      const scope = actorScopeOf(principal);
      const sessionId = sessionIdOf(principal);
      const { commandId, saveId, method, total, commit, expectedRevision } = request;
      const pending = store.snapshot.combat.pendingSaves.find((entry) => entry.id === saveId);
      let outcome: ReturnType<typeof answerSave> | undefined;
      const result = await store.execute({ id: commandId, type: "save.answer", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        outcome = answerSave(state, commandId, saveId, method, total, commit, scope, {
          random: (sides) => context.random(sides),
          newRollId: context.newId,
          sessionId,
          role: scope.role,
          now: () => new Date().toISOString(),
          resolveDefinition
        });
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        if (outcome && outcome.committed && pending) context.broadcastTableEvent({ kind: "save", text: `${actorName(pending.targetActorId)} ${outcome.success ? "succeeded on" : "failed"} a ${pending.ability.toUpperCase()} save${outcome.appliedDamage > 0 ? ` — ${outcome.appliedDamage} damage` : ""}.`, actorIds: [pending.targetActorId], gmOnly: actorHidden(pending.targetActorId) });
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
    }
  };
}

/**
 * The command catalog for the generic HTTP tunnel (`POST /api/v1/game/commands`) and its GET
 * discovery listing: every game command reachable over the integration API, its required credential
 * scope, and the operation that runs it. Types use the store's dot-separated receipt form — the same
 * strings the archive journal and `domain_events` table record.
 */
export type GameCommandDescriptor = Readonly<{
  type: string;
  scope: IntegrationScope;
  summary: string;
  run: (principal: GamePrincipal, payload: unknown) => Promise<GameMutationResult>;
}>;

export function gameCommandRegistry(operations: GameOperations): ReadonlyMap<string, GameCommandDescriptor> {
  const descriptors: readonly GameCommandDescriptor[] = [
    { type: "encounter.start", scope: "combat:write", summary: "Start an encounter on a battlemap with initial combatants (GM).", run: (p, raw) => operations.encounterStart(p, raw) },
    { type: "encounter.end", scope: "combat:write", summary: "End the encounter and archive it permanently (GM).", run: (p, raw) => operations.encounterEnd(p, raw) },
    { type: "encounter.add-combatant", scope: "combat:write", summary: "Add a rostered actor to the running encounter (GM).", run: (p, raw) => operations.encounterAddCombatant(p, raw) },
    { type: "initiative.set", scope: "combat:write", summary: "Set a combatant's initiative score (GM).", run: (p, raw) => operations.initiativeSet(p, raw) },
    { type: "initiative.next", scope: "combat:write", summary: "Advance the turn; steps forward through recorded history while rewound (GM).", run: (p, raw) => operations.initiativeNext(p, raw) },
    { type: "initiative.previous", scope: "combat:write", summary: "Rewind the whole table to the previous turn boundary (GM).", run: (p, raw) => operations.initiativePrevious(p, raw) },
    { type: "turn.end", scope: "combat:write", summary: "End the current turn (GM anyone; a player only their own turn).", run: (p, raw) => operations.turnEnd(p, raw) },
    { type: "turn.use", scope: "combat:write", summary: "Mark the current turn's action or bonus action used/unused.", run: (p, raw) => operations.turnUse(p, raw) },
    { type: "turn.use-reaction", scope: "combat:write", summary: "Mark a combatant's reaction used/unused.", run: (p, raw) => operations.turnUseReaction(p, raw) },
    { type: "token.move", scope: "combat:write", summary: "Move a combatant's token (server-snapped); position null returns it to the tray.", run: (p, raw) => operations.tokenMove(p, raw) },
    { type: "actor.add-from-definition", scope: "actor:write", summary: "Instantiate a bundled SRD monster onto the roster (GM).", run: (p, raw) => operations.actorAddFromDefinition(p, raw) },
    { type: "actor.import-definition", scope: "actor:write", summary: "Import a canonical ActorDefinition JSON as a claimable actor (GM).", run: (p, raw) => operations.actorImportDefinition(p, raw) },
    { type: "actor.remove", scope: "actor:write", summary: "Remove an actor from the roster (GM).", run: (p, raw) => operations.actorRemove(p, raw) },
    { type: "actor.apply-damage", scope: "actor:write", summary: "Apply damage (GM anyone; a player their claimed character).", run: (p, raw) => operations.actorApplyDamage(p, raw) },
    { type: "actor.heal", scope: "actor:write", summary: "Heal hit points (GM anyone; a player their claimed character).", run: (p, raw) => operations.actorHeal(p, raw) },
    { type: "actor.set-temp-hp", scope: "actor:write", summary: "Set temporary hit points (GM anyone; a player their claimed character).", run: (p, raw) => operations.actorSetTempHp(p, raw) },
    { type: "actor.set-hp", scope: "actor:write", summary: "Set current hit points directly (GM).", run: (p, raw) => operations.actorSetHp(p, raw) },
    { type: "actor.set-condition", scope: "actor:write", summary: "Apply or clear an SRD condition, with exhaustion levels.", run: (p, raw) => operations.actorSetCondition(p, raw) },
    { type: "dice.roll", scope: "roll:create", summary: "Roll dice into the shared, auditable roll history.", run: (p, raw) => operations.diceRoll(p, raw) },
    { type: "action.resolve", scope: "combat:write", summary: "Run a stat-block action: attack vs AC or save-DC with typed damage (GM).", run: (p, raw) => operations.actionResolve(p, raw) },
    { type: "save.answer", scope: "combat:write", summary: "Answer a pending saving throw by rolling or entering a total.", run: (p, raw) => operations.saveAnswer(p, raw) },
    { type: "save.dismiss", scope: "combat:write", summary: "Dismiss a pending saving throw without resolving it.", run: (p, raw) => operations.saveDismiss(p, raw) },
    { type: "annotation.add", scope: "combat:write", summary: "Draw a measurement or area shape on the encounter map.", run: (p, raw) => operations.annotationAdd(p, raw) },
    { type: "annotation.ping", scope: "combat:write", summary: "Ping a point on the encounter map.", run: (p, raw) => operations.annotationPing(p, raw) },
    { type: "annotation.move", scope: "combat:write", summary: "Move or resize an annotation you may edit.", run: (p, raw) => operations.annotationMove(p, raw) },
    { type: "annotation.remove", scope: "combat:write", summary: "Remove an annotation you may edit.", run: (p, raw) => operations.annotationRemove(p, raw) },
    { type: "annotation.set-color", scope: "combat:write", summary: "Change an annotation's color.", run: (p, raw) => operations.annotationSetColor(p, raw) },
    { type: "annotation.set-visibility", scope: "combat:write", summary: "Change who can see an annotation.", run: (p, raw) => operations.annotationSetVisibility(p, raw) },
    { type: "annotation.set-movable", scope: "combat:write", summary: "Allow or disallow other players moving a shape.", run: (p, raw) => operations.annotationSetMovable(p, raw) },
    { type: "annotation.clear", scope: "combat:write", summary: "Clear drawn shapes by scope (mine/players/all).", run: (p, raw) => operations.annotationClear(p, raw) }
  ];
  return new Map(descriptors.map((descriptor) => [descriptor.type, descriptor]));
}
