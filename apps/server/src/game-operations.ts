import { z } from "zod";
import type { AskableCommand, CombatLogEntry, EncounterStartEntry, GameState, GmView, PartyVisibility, PendingRuleAsk, PlayerView, RollRecord, RuleExceptions, TableEvent } from "@vtt/domain";
import { ABILITY_ROLL_FORMULA, parseDiceFormula, resolveDice, rollDice, validateAbilityFormula } from "@vtt/rules-5e";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { generateCharacterRequest } from "./character-generate.js";
import { buildCharacterDefinition } from "./character-build.js";
import type { IntegrationScope } from "@vtt/api-contract";
import { addAnnotation, addPing, clearAnnotations, moveAnnotation, removeAnnotation, setAnnotationColor, setAnnotationMovable, setAnnotationVisibility, shapeGeometry, type AnnotationActor } from "./annotations.js";
import { setCondition } from "./actor-conditions.js";
import { actionAvailability, resolveDefinitionAction } from "./action-resolution.js";
import { deriveActorSheet } from "./actor-derived.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, equipmentCatalogOf } from "./equipment-derivation.js";
import { builtinAction, BUILTIN_ACTIONS, BUILTIN_TARGETING } from "./builtin-actions.js";
import { parseAreaProse, tokensInTemplate } from "./area-targeting.js";
import { addActorFromDefinition, importActorDefinition, rebuildActorDefinition, removeActor, resolvePendingImport, storedDefinition, submitPendingImport } from "./actor-roster.js";
import { canInitiateForActor, canPlayerTarget } from "./authorization.js";
import { replaceableOffers } from "./choice-overrides.js";
import { setPreparedSpell, setSpellSlotRemaining } from "./spellcasting.js";
import { setCurrency, setInventoryItem } from "./inventory.js";
import { setCharacterIdentity, setCharacterProficiencies } from "./character-edit.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "./character-claims.js";
import type { CombatLogStore } from "./combat-log.js";
import { actionSummaryOf, type ContentAudience, type ContentLibrary } from "./content-library.js";
import { addCombatant, endEncounter, nextInitiativeTurn, rollRemainingInitiative, rollSelfInitiative, setInitiativeScore, startEncounter, type InitiativeRollSink } from "./encounter.js";
import { addEffect, endEffect, endEncounterEffects, removeConditionDirect, type EffectNarration } from "./effects.js";
import { rollDeathSave } from "./death-saves.js";
import { creatureDistance, mapDistance, tokenCreatureDistance } from "./movement-narration.js";
import { activateScene, createScene, duplicateScene, removeScene, renameScene, reorderScenes, setSceneCombatants } from "./scenes.js";
import { buildEncounterArchive, type EncounterArchiveDocument } from "./encounter-archive.js";
import { launchReplay } from "./replay-launch.js";
import { planNextTurn, planPreviousTurn, turnLabel, type TimelineOutcome } from "./combat-history.js";
import { CommandRejectedError, RulesBlockedError, type GameStore, type JournalEntry } from "./game-store.js";
import { applyMovementRules } from "./movement-rules.js";
import { applyRest, spendHitDice } from "./rests.js";
import { paintFog, resetFog, setFogEnabled } from "./fog.js";
import { applyDamage, applyDamageDetailed, damageAdjustmentDetail, healActor, setCurrentHp, setTemporaryHp, type ActorScope } from "./hit-points.js";
import { settlePlayerHit, resolvePendingDamage, type AppliedDamage } from "./player-damage.js";
import { narrateTokenMove, type MovementNarration } from "./movement-narration.js";
import { moveEncounterToken, moveSceneToken, setActorSize, setActorVisibility, type TokenMapGeometry } from "./token-placement.js";
import { answerSave, dismissSave, saveTotalFor } from "./saving-throws.js";
import { askRerunPayload, clearRuleAsk, findRuleAsk, parkRuleAsk, rerunPayload } from "./rule-asks.js";
import { familyOf, overrideReason, rememberOverride } from "./rules-families.js";
import { looseRollPlan, NOT_YOUR_TURN, offTurnVerdict, routeForTap } from "./tap-routing.js";
import { describeRoll, recordRoll, rollFeedIsGmOnly, rollsForCommand } from "./roll-history.js";
import { answerReaction, dismissReaction } from "./reactions.js";
import { endTurn, setLegendaryUsed, setReactionUsed, setTurnSlot } from "./turn-economy.js";
import {
  ActionResolveSchema, ActorAddFromDefinitionSchema, ActorAvailableActionsSchema, ActorImportDefinitionSchema, BuilderSetPolicySchema, CharacterCreateSchema, CharacterGenerateSchema, CharacterSubmitImportSchema, CharacterResolveImportSchema, ActorRechooseSchema, ActorRemoveSchema, ActorRestSchema, ActorSetSpeedSchema, ActorSpendHitDiceSchema, AddCombatantSchema, CharacterSetCurrencySchema, CharacterSetIdentitySchema, CharacterSetInventorySchema, CharacterSetPreparedSchema, CharacterSetProficienciesSchema, CharacterSetSlotSchema,
  AnnotationAddSchema, AnnotationClearSchema, AnnotationColorSetSchema, AnnotationMovableSetSchema, AnnotationMoveSchema,
  AnnotationPingSchema, AnnotationRemoveSchema, AnnotationVisibilitySetSchema, ApplyDamageSchema, CommandIdentitySchema, ContentActionsSchema,
  DamageResolveSchema, DeathSaveRollSchema, DiceRollSchema, EffectAddSchema, EffectEndSchema, EncounterStartSchema, GAME_COMMAND_SCOPES, HpAmountSchema, InitiativeNextSchema, InitiativePreviousSchema,
  InitiativeRollRemainingSchema, InitiativeRollSelfSchema, InitiativeScoreSchema, ReactionAnswerSchema, ReactionDismissSchema, SaveAnswerSchema, SaveDismissSchema, SceneCreateSchema, SceneIdSchema, SceneRenameSchema,
  SetPlayerInitiativeModeSchema,
  FogPaintSchema, FogResetSchema, FogSetEnabledSchema,
  ActionUseSchema, RulesAnswerSchema, RulesAskSchema, RulesSetPolicySchema, SaveRollSchema, TableSetPartyVisibilitySchema, TableSetStagingDefaultsSchema,
  BuilderRollAbilitiesSchema, CharacterRebuildSchema, ReplayLaunchSchema, SceneReorderSchema, SceneSetCombatantsSchema, SetActorArchivedSchema, SetActorSheetPreviewSchema, SetActorHealthDisplaySchema, SetActorSizeSchema, SetActorVisibilitySchema, SetConditionSchema, SetEnvironmentSchema, SetHealthDisplaySchema, SetHpSchema, SetPlayerDamageModeSchema, SetRulesModeSchema, SetTokenImageSchema, TempHpSchema,
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
/** The reduced initiator the authorization seam reads: GM-grade acts on anyone, a player on their own claimed actor. */
function initiatorOf(principal: GamePrincipal): { role: "gm" } | { role: "player"; sessionId: string } { return isGmGrade(principal) ? { role: "gm" } : { role: "player", sessionId: principal.sessionId }; }
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

/**
 * GM-only audit line for a party-visibility tier. The GM-FACING words on the settings page are the
 * client's (Off · Name and class · Full sheet · Sheet + resources); this is the log's own sentence, so
 * the two read naturally in their own places without either owning the other's copy. `off` says what
 * players KEEP as well as what they lose, because "nothing" would misdescribe it - a character is
 * still on the map and in the turn order at every tier.
 *
 * THE `off` LINE USED TO CONTRADICT THE SENTENCE ABOVE IT. It read "nothing ... beyond the tokens on
 * the map", which omits the turn order - the one thing this very docblock says the tier keeps, and a
 * surface that names every character in the fight. A GM reading it would have set `off` believing it
 * hid more than it does. The tier is right and was always right (`projections.ts` argues the case:
 * strip the entry and a player gets a name in the turn order and an empty square where their
 * teammate was standing); the SENTENCE was wrong. What `off` actually removes is the SHEET - no
 * party list, nothing to open, no resources - so that is what it now says.
 */
const PARTY_VISIBILITY_LOG: Readonly<Record<PartyVisibility, string>> = {
  off: "Players no longer read anything of each other's sheets. Each other's characters stay on the map and in the turn order.",
  "name-and-class": "Players now see each other's name and class.",
  "full-sheet": "Players can now read each other's full sheets.",
  "sheet-and-resources": "Players can now read each other's full sheets and live resources."
};

/** GM-only audit text for a per-family exception set ("movement: freeform, slots: strict"), or "no exceptions". */
function describeRuleExceptions(exceptions: RuleExceptions): string {
  const entries = Object.entries(exceptions).filter(([, mode]) => mode !== undefined);
  return entries.length === 0 ? "no exceptions" : entries.map(([family, mode]) => `${family}: ${mode}`).join(", ");
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
  /** Bridge: present a newly-live scene's map on the shared screen (best-effort; a viewer hiccup must not undo the scene switch). */
  presentSceneMap: (mapAssetId: string) => Promise<void>;
  /**
   * Fire a transient toast. It is ALSO written to the feed by default (every toast has always been a
   * durable line); pass `logged: false` when the durable record is a richer feed row already being
   * written - an initiative toast beside its own roll row would say the same thing twice.
   */
  broadcastTableEvent: (event: Readonly<{ kind: TableEvent["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean; logged?: boolean }>) => void;
  /**
   * Append one line to THE TABLE FEED (D11). `actorId` attributes the line to a character or monster
   * (what the feed's "just mine" filter reads); `roll` makes it a `kind: "roll"` row carrying the whole
   * roll, and its visibility - not `gmOnly` alone - decides who receives it.
   */
  appendLog: (entry: Readonly<{ kind: CombatLogEntry["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean; actorId?: string | null; roll?: RollRecord | null }>) => void;
  logTurnBegin: (state: GameState) => void;
  logTimelineOutcome: (outcome: TimelineOutcome, state: GameState) => void;
  scheduleAnnotationExpiry: () => void;
  gmView: (state: GameState) => GmView;
  playerView: (state: GameState, playerSessionId: string | undefined) => PlayerView;
  /** Uniform die: an integer in [1, sides]. */
  random: (sides: number) => number;
  newId: () => string;
  /** Best-effort hook fired after an encounter is archived, so the worldbuilding codex can log a combat-history entry against its location. Implementations MUST swallow their own errors - a codex hiccup can never affect ending a fight. */
  onEncounterArchived?: (info: Readonly<{ mapAssetId: string | null; sceneId: string | null; turnCount: number }>) => void;
  /**
   * Reads one stored encounter-archive document (the raw JSON string), so `replay.launch` can make an
   * archived moment live. Optional because the archives live in the game store's own table rather
   * than in GameState: a context assembled without them simply cannot launch replays, and says so.
   */
  archiveDocument?: (id: number) => string | null;
}>;

/** Every mutation resolves to at least the accepted revision + idempotent-duplicate flag; commands add their own extras. */
export type GameMutationResult = { revision: number; duplicate: boolean } & Record<string, unknown>;

export type GameOperations = ReturnType<typeof createGameOperations>;

export function createGameOperations(context: GameOperationsContext) {
  const { store, contentLibrary } = context;
  const actorName = (actorId: string) => store.snapshot.actors.find((actor) => actor.id === actorId)?.name ?? "A combatant";
  const actorHidden = (actorId: string) => store.snapshot.actors.find((actor) => actor.id === actorId)?.visibility === "gm-only";

  /**
   * Which merged catalog this principal may READ. GM-grade covers the GM's own session and the GM's
   * minted integration credentials (an integration is the GM's trusted automation, ADR-0016); a
   * player session sees only player-visible records.
   *
   * Every content read below derives its audience here rather than taking the whole library, because
   * the catalogs are about to stop being SRD-only: the moment homebrew merges in, a read that
   * ignored its principal would serve every GM-only record to every player - and it would do so far
   * away from `projections.ts`, where a viewer-safety audit looks.
   */
  /**
   * D13's two abuse guards, both bounded and in-memory (the viewer pairing-limit idiom): a restart
   * forgives, which is right for limits whose job is to stop a runaway loop, not to punish anyone.
   * `MAX_STORED_DEFINITIONS` mirrors `GameStateSchema`'s own cap so the refusal is a sentence rather
   * than a Zod failure mid-transaction.
   */
  const MAX_STORED_DEFINITIONS = 100;
  const CREATES_PER_DAY = 5;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const creates = new Map<string, number[]>();
  function withinCreateCap(sessionId: string): boolean {
    const now = Date.now();
    const recent = (creates.get(sessionId) ?? []).filter((at) => now - at < DAY_MS);
    if (recent.length >= CREATES_PER_DAY) { creates.set(sessionId, recent); return false; }
    creates.set(sessionId, [...recent, now]);
    return true;
  }

  const audienceOf = (principal: GamePrincipal): ContentAudience => isGmGrade(principal) ? "gm" : "player";
  const catalogFor = (principal: GamePrincipal) => contentLibrary.forAudience(audienceOf(principal));
  /**
   * PLAY-TIME item catalog - where magic-item riders live (never on the inventory row, so a cursed
   * item's mechanics cannot reach the player through their own projection). Deliberately the GM
   * audience and NOT `catalogFor(principal)`: a player must be able to roll their own GM-authored
   * cursed sword, and a player-audience view would resolve it to nothing and silently make the item
   * mundane. What a player may BROWSE stays gated on the catalog read, not on the rules engine.
   */
  const equipmentCatalog = () => equipmentCatalogOf(contentLibrary.forAudience("gm"));

  /**
   * PLAY-TIME definition lookup, hoisted so the ten transaction-scoped copies of this expression
   * cannot drift apart. Imported stat blocks take precedence over the bundle so sheets/actions
   * resolve for both, and `monsterForInstance` deliberately ignores a homebrew record's
   * draft/published/deleted status: a live actor's actions, typed defences and recharge behaviour
   * are read from the definition per use, so anything narrower would silently disarm every token of
   * a creature the GM soft-deleted mid-fight.
   */
  const resolveDefinitionIn = (state: GameState, definitionId: string) => storedDefinition(state, definitionId) ?? contentLibrary.monsterForInstance(definitionId);
  /** The same lookup against the current snapshot, for reads that run outside a command transaction. */
  const resolveDefinition = (definitionId: string) => resolveDefinitionIn(store.snapshot, definitionId);

  /**
   * Initiative joins the feed as an ordinary roll (D11). Every initiative die the server throws - the
   * `encounter.start` auto-rolls, a player's own `initiative.roll-self`, the GM's roll-for-the-rest, and
   * a mid-fight add - lands in `state.rolls` through the ONE writer, attributed to the combatant and
   * labelled "Initiative", so the dice tray, the sheet's "Mine" filter and the feed all agree it happened.
   * Hidden combatants keep their monster-roll rule: the roll is GM-only, exactly like a stat-block attack.
   */
  const initiativeRollSink = (state: GameState, commandId: string, principal: GamePrincipal): InitiativeRollSink =>
    (roll) => {
      const actor = state.actors.find((candidate) => candidate.id === roll.actorId);
      const formula = roll.mode === "advantage" ? "2d20kh1" : roll.mode === "disadvantage" ? "2d20kl1" : "1d20";
      const gmGrade = isGmGrade(principal);
      recordRoll(state, {
        id: context.newId(), commandId, initiatorSessionId: sessionIdOf(principal), initiatorRole: gmGrade ? "gm" : "player",
        initiatorLabel: actor?.name ?? (gmGrade ? gmGradeLabelOf(principal) : "A player"), label: "Initiative", actorId: roll.actorId,
        purpose: "check", visibility: actor?.visibility === "gm-only" ? "gm-only" : "public",
        formula, normalizedFormula: formula,
        dice: [{ group: 0, sides: 20, face: roll.natural, kept: true, sign: 1 }],
        modifiers: roll.modifier === 0 ? [] : [{ value: Math.abs(roll.modifier), sign: roll.modifier < 0 ? -1 : 1 }],
        total: roll.total, createdAt: new Date().toISOString()
      });
    };

  /**
   * THE feed side of a roll (D11): after a command commits, every roll it produced becomes a
   * `kind: "roll"` feed row - attributed to its character, carrying the whole `RollRecord`, gated on the
   * roll's own visibility. Called only on a non-duplicate result, because a replayed command never
   * re-rolled: the receipt returns the stored outcome and the feed must not gain a second copy.
   */
  const publishRolls = (state: GameState, commandId: string) => {
    for (const roll of rollsForCommand(state, commandId)) {
      context.appendLog({
        kind: "roll",
        text: describeRoll(roll),
        actorId: roll.actorId,
        actorIds: roll.actorId === null ? [] : [roll.actorId],
        roll,
        gmOnly: rollFeedIsGmOnly(roll)
      });
    }
  };

  /** Shared narration fan-out for engine transitions (effect ends, dying, consciousness). */
  const publishNarrations = (events: readonly EffectNarration[]) => {
    for (const event of events) {
      const gmOnly = actorHidden(event.actorId);
      context.broadcastTableEvent({ kind: event.kind, text: event.text, actorIds: [event.actorId], gmOnly });
    }
  };

  const operations = {
    // ---------- Reads ----------

    /** The projection for this principal. GM-grade principals get the full GM view unless they explicitly ask for the player-safe one; players only ever get theirs. */
    view(principal: GamePrincipal, requested?: "gm" | "player"): { view: "gm" | "player"; game: GmView | PlayerView } {
      const state = store.snapshot;
      if (!isGmGrade(principal) || requested === "player") {
        return { view: "player", game: context.playerView(state, principal.kind === "player" ? principal.sessionId : undefined) };
      }
      return { view: "gm", game: context.gmView(state) };
    },

    /**
     * The table feed for THIS reader (D11). The player's session id rides along because it is the only
     * thing that unlocks their own `self-only` rolls - the store decides, not the caller.
     */
    logEntries(principal: GamePrincipal, limit?: number): readonly CombatLogEntry[] {
      return context.combatLog.list(isGmGrade(principal), limit, principal.kind === "player" ? principal.sessionId : undefined);
    },

    // Every content read below scopes its catalog to the CALLING principal through `catalogFor`.
    // Which of them a player may call at all is unchanged - the bestiary and stat blocks stay
    // GM-only, the rules catalogs stay open - but "may call it" and "sees everything in it" are now
    // separate questions, and the second is answered once, structurally, by the audience.

    contentMonsters(principal: GamePrincipal) {
      requireGmGrade(principal, "Only the GM can browse bundled content.");
      const catalog = catalogFor(principal);
      return { monsters: catalog.monsterSummaries(), attribution: catalog.attribution };
    },

    contentConditions(principal: GamePrincipal) {
      // Reference text is public information: any joined session (GM or player) may read it.
      // Attribution rides along like every other catalog: ADR-0015 requires the BUNDLE's canonical
      // statement (author, source URL, license URI) on any surface that displays this content, and a
      // client that has to hand-write a substitute always writes a weaker one.
      const catalog = catalogFor(principal);
      return { conditions: catalog.conditionSummaries(), attribution: catalog.attribution };
    },

    contentSkills(principal: GamePrincipal) {
      // The skill catalog (reference text + the ability each check uses) is public reference like
      // conditions: any joined session reads it, and the sheet/builder derive skill modifiers from
      // it instead of a hardcoded client table.
      const catalog = catalogFor(principal);
      return { skills: catalog.skillSummaries(), attribution: catalog.attribution };
    },

    contentLanguages(principal: GamePrincipal) {
      // The language catalog is public reference exactly like skills: the builder's species step
      // offers "Common plus two languages" from it, and the sheet renders what a character knows.
      const catalog = catalogFor(principal);
      return { languages: catalog.languageSummaries(), attribution: catalog.attribution };
    },

    contentSpells(principal: GamePrincipal) {
      // Spell rules are public reference text (the CC-BY SRD), like conditions - any joined session may read them.
      const catalog = catalogFor(principal);
      return { spells: catalog.spellSummaries(), attribution: catalog.attribution };
    },

    contentEquipment(principal: GamePrincipal) {
      // The SRD equipment catalog is public reference (like spells); the sheet's browse-and-add picker reads it.
      // Attribution rides along so any surface that displays the gear can show the required CC-BY line.
      const catalog = catalogFor(principal);
      return { equipment: catalog.equipmentSummaries(), attribution: catalog.attribution };
    },

    // The six character-builder catalogs. Deliberately NOT gated like the bestiary: a player builds
    // their own character, so any joined session reads them (the same audience as conditions, spells
    // and equipment). Attribution rides on every one - ADR-0015 requires the wizard to display it.
    contentClasses(principal: GamePrincipal) {
      const catalog = catalogFor(principal);
      return { classes: catalog.classSummaries(), attribution: catalog.attribution };
    },

    contentSubclasses(principal: GamePrincipal) {
      const catalog = catalogFor(principal);
      return { subclasses: catalog.subclassSummaries(), attribution: catalog.attribution };
    },

    contentSpecies(principal: GamePrincipal) {
      const catalog = catalogFor(principal);
      return { species: catalog.speciesSummaries(), attribution: catalog.attribution };
    },

    contentBackgrounds(principal: GamePrincipal) {
      const catalog = catalogFor(principal);
      return { backgrounds: catalog.backgroundSummaries(), attribution: catalog.attribution };
    },

    contentFeats(principal: GamePrincipal) {
      const catalog = catalogFor(principal);
      return { feats: catalog.featSummaries(), attribution: catalog.attribution };
    },

    contentNames(principal: GamePrincipal) {
      const catalog = catalogFor(principal);
      return { names: catalog.nameBundles(), attribution: catalog.attribution };
    },

    contentMonsterActions(principal: GamePrincipal, raw: unknown) {
      requireGmGrade(principal, "Only the GM can browse stat blocks.");
      const request = parse(ContentActionsSchema, raw, "The action lookup is malformed.");
      const catalog = catalogFor(principal);
      const imported = storedDefinition(store.snapshot, request.definitionId);
      // Browse, so the catalog's own lookup (which honours draft/published/deleted) rather than the
      // play-time resolver: a stat block the GM has not published is not a stat block to browse.
      const definition = imported ?? catalog.monster(request.definitionId);
      const actions = imported
        ? imported.actions.map(actionSummaryOf)
        : catalog.monsterActionSummaries(request.definitionId);
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
      // GM-only, and reached from a LIVE token as often as from the bestiary, so this one uses the
      // play-time resolver on purpose: the GM must still be able to read the sheet of a creature
      // that is on the table but has since been soft-deleted from the library.
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
      const { commandId, mapAssetId, rulesMode, ruleExceptions, playersRollInitiative, expectedRevision } = request;
      const tokenGeometry = await context.tokenGeometryFor(mapAssetId);
      // Omitted `entries` means "start the fight that is already staged here": the server derives the
      // combatants from the LIVE scene rather than trusting the client's copy of the staged list.
      // Derived INSIDE the transaction, against the state the command actually commits against - and
      // deliberately without a refusal of its own, so `startEncounter`'s own guards keep their order
      // and their wording (an already-running fight is told to end it, not to pick combatants).
      const stagedEntries = (state: GameState): readonly EncounterStartEntry[] => {
        // The ACTIVE scene's own slot is empty by invariant - its live copy is the top-level combat -
        // so the staged list IS the top-level initiative; the scene lookup only proves one is live.
        const live = state.combat.activeSceneId !== null && state.combat.scenes.some((candidate) => candidate.id === state.combat.activeSceneId);
        return live ? state.combat.initiative.map((entry) => ({ actorId: entry.actorId })) : [];
      };
      const result = await store.executeTimeline({ id: commandId, type: "encounter.start", expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        const entries = request.entries ?? stagedEntries(state);
        // A fresh fight starts from the TABLE's standing rules policy (D7) unless this command names
        // its own; the previous fight's mid-combat re-tune does not silently become the new normal.
        startEncounter(state, {
          mapAssetId,
          entries,
          rulesMode: rulesMode ?? state.rulesPolicy.dial,
          ruleExceptions: ruleExceptions ?? { ...state.rulesPolicy.exceptions },
          playersRollInitiative
        }, () => context.random(20), tokenGeometry, (definitionId) => resolveDefinitionIn(state, definitionId), Date.now(), equipmentCatalog(), initiativeRollSink(state, commandId, principal));
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
        publishRolls(result.state, commandId);
        for (const entry of request.entries ?? []) {
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
      let endedSceneId: string | null = null;
      let endedMapAssetId: string | null = null;
      let endedTurnCount = 0;
      const result = await store.executeTimeline({ id: commandId, type: "encounter.end", expectedRevision, payload: request, principal: tag }, (state, timeline) => {
        // The last live picture of the fight, captured before endEncounter clears the combat.
        const finalState = structuredClone(state);
        endedSceneId = finalState.combat.activeSceneId;
        endedMapAssetId = finalState.combat.mapAssetId;
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
            // Archiving the fight that just ended is a play-time read, not a browse: the archive
            // must snapshot the definition every combatant actually fought with, whatever the
            // library has since done with the record.
            resolveBundledDefinition: (definitionId) => contentLibrary.monsterForInstance(definitionId),
            attribution: contentLibrary.attribution
          });
          timeline.archive({ commandId, startedAt: document.startedAt, endedAt: document.endedAt, turnCount: document.turnCount, documentJson: JSON.stringify(document) });
          endedTurnCount = document.turnCount;
        }
        timeline.truncateAll(); // the fight is over - its live turn snapshots go with it
        timeline.clearJournal();
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: "The encounter ended.", gmOnly: false });
        publishNarrations(effectEvents);
        context.onEncounterArchived?.({ mapAssetId: endedMapAssetId, sceneId: endedSceneId, turnCount: endedTurnCount });
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
      const result = await store.execute({ id: commandId, type: "encounter.add-combatant", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => addCombatant(state, actorId, score, () => context.random(20), geometry, Date.now(), initiativeRollSink(state, commandId, principal)));
      if (!result.duplicate) { await context.publishGameState(result.state); publishRolls(result.state, commandId); }
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

    async initiativeRollSelf(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(InitiativeRollSelfSchema, raw, "The initiative roll is malformed.");
      const { commandId, actorId, natural, rollMode, expectedRevision } = request;
      const initiator = initiatorOf(principal);
      let score: number | undefined;
      const result = await store.execute({ id: commandId, type: "initiative.roll-self", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        // A player rolls only their own claimed character's initiative; the GM (integration) anyone's.
        const verdict = canInitiateForActor(initiator, state, actorId, "check");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        score = rollSelfInitiative(state, actorId, { natural, rollMode }, () => context.random(20), initiativeRollSink(state, commandId, principal));
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        publishRolls(result.state, commandId);
        // The toast stays (it is the transient "X rolled 14" everyone glances at); the durable line is
        // now the roll row itself, so this no longer writes a second, dice-less feed sentence.
        if (score !== undefined) context.broadcastTableEvent({ kind: "action", text: `${actorName(actorId)} rolled ${score} for initiative.`, actorIds: [actorId], logged: false });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async initiativeRollRemaining(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can roll initiative for the rest of the table.");
      const request = parse(InitiativeRollRemainingSchema, raw, "The initiative command is malformed.");
      const { commandId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "initiative.roll-remaining", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => rollRemainingInitiative(state, () => context.random(20), initiativeRollSink(state, commandId, principal)));
      if (!result.duplicate) { await context.publishGameState(result.state); publishRolls(result.state, commandId); context.appendLog({ kind: "action", text: "The GM rolled initiative for the remaining players.", gmOnly: false }); }
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
          resolveDefinition: (definitionId) => resolveDefinitionIn(advancing, definitionId),
          catalog: equipmentCatalog(),
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
          resolveDefinition: (definitionId) => resolveDefinitionIn(advancing, definitionId),
          catalog: equipmentCatalog(),
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
          resolveDefinition: (definitionId) => resolveDefinitionIn(state, definitionId),
          catalog: equipmentCatalog(),
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
          context.broadcastTableEvent({ kind: "reaction", text: `${prompt.name} may make an opportunity attack against ${actorName(actorId)}.`, actorIds: [prompt.actorId], gmOnly: promptHidden });
        }
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Actors: roster, hit points, conditions ----------

    async actorAddFromDefinition(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can add combatants.");
      const request = parse(ActorAddFromDefinitionSchema, raw, "The add-combatant command is malformed.");
      // A browse-driven add, so the GM's catalog: a creature that is still a draft is not yet
      // something to drop on the map. (Library state and TABLE visibility stay independent - a
      // published, player-invisible monster is perfectly addable as a public token; players fight
      // it, they just cannot browse its statblock.)
      const definition = catalogFor(principal).monster(request.definitionId);
      if (!definition) throw new CommandRejectedError("That monster is not in the bundled content.");
      // Like annotation:add, the commandId doubles as the new entity id so a duplicate
      // delivery acks the same actorId instead of minting a fresh unused one.
      const actorId = request.commandId;
      // `joinEncounter` closes the mid-fight two-step trap: the "add monsters" browser used to put a
      // creature on the ROSTER only, and joining the fight was a second trip through a different menu.
      // One command, one revision - roster row, initiative entry and tray token together.
      const mapAssetId = store.snapshot.combat.mapAssetId;
      const geometry = request.joinEncounter === true && mapAssetId ? await context.tokenGeometryFor(mapAssetId) : null;
      const result = await store.execute({ id: request.commandId, type: "actor.add-from-definition", actorId, expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        addActorFromDefinition(state, definition, actorId, request.visibility, equipmentCatalog());
        // Ignored out of combat: there is no fight to join, and the roster add is the whole intent.
        if (request.joinEncounter === true && state.combat.active && geometry) addCombatant(state, actorId, undefined, () => context.random(20), geometry);
      });
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
      const result = await store.execute({ id: envelope.commandId, type: "actor.import-definition", actorId, expectedRevision: envelope.expectedRevision, payload: envelope, principal: principalTag(principal) }, (state) => importActorDefinition(state, parsed.data, actorId, envelope.visibility, equipmentCatalog()));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate, actorId };
    },

    /**
     * D13 - PLAYERS BUILD THEIR OWN. The gate is the table's stored `builderPolicy.playerBuilder`
     * (GM-set, projected so the wizard can grey itself out), plus the one-character rule the claim
     * system already enforces, plus two abuse guards a GM-only command never needed:
     *
     *   - a per-session daily CREATE CAP, because a create-then-release loop would otherwise let one
     *     phone mint actors until the roster cap stopped it;
     *   - a definitions HEADROOM pre-check, so a full sheet library refuses in a sentence a person
     *     can act on instead of failing mid-transaction on a Zod max().
     *
     * On success the new character is AUTO-CLAIMED by its creator: "players build their own" made
     * structural rather than a convention the next command has to remember.
     */
    async characterCreate(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterCreateSchema, raw, "The character-create command is malformed.");
      const isPlayer = !isGmGrade(principal);
      if (isPlayer) {
        const policy = store.snapshot.builderPolicy;
        if (policy.playerBuilder !== "open") throw new GameAccessDeniedError("Your GM builds the characters at this table.");
        if (store.snapshot.actors.some((actor) => actor.ownerSessionId === principal.sessionId)) {
          throw new CommandRejectedError("You already have a character - release it before building another.");
        }
        if (!withinCreateCap(principal.sessionId)) throw new CommandRejectedError("That is a lot of characters for one evening - ask your GM to add the next one.");
      }
      const actorId = request.commandId;
      const result = await store.execute({ id: request.commandId, type: "character.create", actorId, expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        // Headroom first, in a sentence the person can act on (the cap itself throws a blunter one).
        if (state.definitions.length >= MAX_STORED_DEFINITIONS) throw new CommandRejectedError("The table's sheet library is full - ask your GM to delete old characters.");
        // Assemble INSIDE the command so validation reads the CURRENT builder policy, then land the
        // definition through the same import path as every other sheet (`import-<actorId>` keying).
        // The builder gets the CALLER's catalog, never the whole library: a player must not be able
        // to name a GM-only homebrew class id they were never shown. GM-only today, so the audience
        // is always "gm" - passing it anyway is what keeps phase 3's player path correct by default.
        // The table's level cap is enforced HERE, inside the command, against the policy the state
        // actually holds - not against a copy the caller sent. The sheet's shallow identity edit
        // carries the same check (`character-edit.ts`), so neither door can exceed the cap.
        if (request.level > state.builderPolicy.maxLevel) throw new CommandRejectedError(`This table builds characters up to level ${state.builderPolicy.maxLevel}.`);
        const definition = buildCharacterDefinition(request, catalogFor(principal), state.builderPolicy);
        importActorDefinition(state, definition, actorId, "public", equipmentCatalog());
        // Auto-claim: the character a player built is theirs from the first tick, so no window
        // exists in which someone else can take it.
        if (isPlayer) {
          const created = state.actors.find((actor) => actor.id === actorId);
          if (created) created.ownerSessionId = principal.sessionId;
        }
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: `${actorName(actorId)} joined the roster (character builder).`, actorIds: [actorId] });
      }
      return { revision: result.state.revision, duplicate: result.duplicate, actorId };
    },

    /**
     * ROLL A WHOLE CHARACTER (issue `2d`) - a complete, playable, single-class character at a named
     * level, with every decision but the ability spread drawn at random.
     *
     * SERVER-SIDE IS THE WHOLE POINT. The dice are `context.random`, the same authority every other
     * roll comes from, and they are thrown INSIDE the command against the CURRENT catalog and the
     * CURRENT policy - so a caller cannot pre-roll a character and send it in. That is CLAUDE.md
     * rule 2, and D14 already moved the builder's own six dice for exactly this reason.
     *
     * The gate is `builderPolicy.playerRandom`, which mirrors `characterCreate`'s `playerBuilder`
     * gate line for line - the same one-character rule, the same per-session create cap, the same
     * definitions headroom pre-check, the same auto-claim - with one deliberate difference: it is
     * DENY BY DEFAULT. A guided builder is eight considered steps; a generator is one tap that fills
     * a roster slot, which is a different kind of thing to hand out.
     *
     * The generated character lands through `character.create`'s own path: same assembler, same
     * import, same `import-<actorId>` keying, same choice ledger. It is a hand-built character that
     * nobody had to sit through - not a second species of sheet.
     */
    async characterGenerate(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterGenerateSchema, raw, "The character-generate command is malformed.");
      const isPlayer = !isGmGrade(principal);
      if (isPlayer) {
        const policy = store.snapshot.builderPolicy;
        if (policy.playerRandom !== "open") throw new GameAccessDeniedError("Your GM rolls the random characters at this table.");
        if (store.snapshot.actors.some((actor) => actor.ownerSessionId === principal.sessionId)) {
          throw new CommandRejectedError("You already have a character - release it before rolling another.");
        }
        if (!withinCreateCap(principal.sessionId)) throw new CommandRejectedError("That is a lot of characters for one evening - ask your GM to add the next one.");
      }
      const actorId = request.commandId;
      let summary = "";
      let rolls: readonly number[] = [];
      let faces = 0;
      let rollId: string | undefined;
      const result = await store.execute({ id: request.commandId, type: "character.generate", actorId, expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        if (state.definitions.length >= MAX_STORED_DEFINITIONS) throw new CommandRejectedError("The table's sheet library is full - ask your GM to delete old characters.");
        if (request.level > state.builderPolicy.maxLevel) throw new CommandRejectedError(`This table builds characters up to level ${state.builderPolicy.maxLevel}.`);
        // The CALLER's catalog, exactly as `characterCreate` does: a player must not roll up a
        // GM-only homebrew class they were never shown.
        const generated = generateCharacterRequest(request, catalogFor(principal), state.builderPolicy, (sides) => context.random(sides));
        ({ summary, hitPointRolls: rolls, hitDieFaces: faces } = generated);
        const definition = buildCharacterDefinition(generated.request, catalogFor(principal), state.builderPolicy);
        importActorDefinition(state, definition, actorId, "public", equipmentCatalog());
        if (isPlayer) {
          const created = state.actors.find((actor) => actor.id === actorId);
          if (created) created.ownerSessionId = principal.sessionId;
        }
        // The hit-point dice land in the table feed like any other roll (D11/D14): a character
        // rolled up at the table is a table event, not a private one. Level 1 throws none.
        if (rolls.length > 0) {
          rollId = context.newId();
          recordRoll(state, {
            id: rollId, commandId: request.commandId, initiatorSessionId: sessionIdOf(principal), initiatorRole: isGmGrade(principal) ? "gm" : "player",
            initiatorLabel: isGmGrade(principal) ? "GM" : "A player", label: `Hit points, ${state.actors.find((actor) => actor.id === actorId)?.name ?? "a new character"}`,
            actorId, purpose: "manual", visibility: "public",
            formula: `${rolls.length}d${faces}`, normalizedFormula: `${rolls.length}d${faces}`,
            dice: rolls.map((face) => ({ group: 0, sides: faces, face, kept: true, sign: 1 as const })),
            modifiers: [], total: rolls.reduce((sum, face) => sum + face, 0), createdAt: new Date().toISOString()
          });
        }
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: `${actorName(actorId)} was rolled up — ${summary}.`, actorIds: [actorId] });
      }
      return { revision: result.state.revision, duplicate: result.duplicate, actorId };
    },

    /**
     * D13/D14 - LEVEL UP, LEVEL DOWN, RESPEC: one command, because they are one motion. The client
     * prefills the whole request from the stored choice ledger; the server re-runs the identical
     * build and re-validates every part of it (it never trusts a prefill), then updates the live
     * character in place through `rebuildActorDefinition`, whose header states exactly what survives.
     */
    async characterRebuild(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterRebuildSchema, raw, "The character-rebuild command is malformed.");
      const { commandId, actorId, expectedRevision } = request;
      const isPlayer = !isGmGrade(principal);
      if (isPlayer && store.snapshot.builderPolicy.playerBuilder !== "open") throw new GameAccessDeniedError("Your GM builds the characters at this table.");
      const verdict = canInitiateForActor(initiatorOf(principal), store.snapshot, actorId, "edit");
      if (!verdict.ok) throw new GameAccessDeniedError(verdict.message);
      const result = await store.execute({ id: commandId, type: "character.rebuild", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const inside = canInitiateForActor(initiatorOf(principal), state, actorId, "edit");
        if (!inside.ok) throw new CommandRejectedError(inside.message);
        if (request.level > state.builderPolicy.maxLevel) throw new CommandRejectedError(`This table builds characters up to level ${state.builderPolicy.maxLevel}.`);
        const actor = state.actors.find((entry) => entry.id === actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        // The NAME stays the live actor's: a rebuild changes what a character can do, never who they are.
        const definition = buildCharacterDefinition({ ...request, name: actor.name }, catalogFor(principal), state.builderPolicy);
        rebuildActorDefinition(state, actorId, definition, equipmentCatalog());
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: `${actorName(actorId)} was rebuilt at level ${request.level}.`, actorIds: [actorId] });
      }
      return { revision: result.state.revision, duplicate: result.duplicate, actorId };
    },

    /**
     * D14 - the builder's dice move SERVER-SIDE. The client used to call `Math.random` six times,
     * which is the oldest rule-2 violation in the ledger. The roll now runs through `context.random`
     * and the same dice grammar every other roll uses, and it lands in the table feed like any other
     * roll: character creation is a table event, not a private browser event.
     *
     * `character.create` keeps its BOUND CHECK rather than binding scores to this roll's id -
     * physical dice at the table are a supported path and always have been (see
     * `validateAbilityScores`). What is closed here is client-generated randomness.
     */
    async builderRollAbilities(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(BuilderRollAbilitiesSchema, raw, "The ability-roll command is malformed.");
      const policy = store.snapshot.builderPolicy;
      if (!isGmGrade(principal) && policy.playerBuilder !== "open") throw new GameAccessDeniedError("Your GM builds the characters at this table.");
      if (!policy.allowedAbilityMethods.includes(request.method)) throw new CommandRejectedError("That ability method is not allowed at this table.");
      if (request.method === "custom" && !policy.customFormula) throw new CommandRejectedError("The custom ability method needs the GM to configure a formula first.");
      const formula = request.method === "custom" ? policy.customFormula! : ABILITY_ROLL_FORMULA;
      const check = validateAbilityFormula(formula);
      if (!check.ok) throw new CommandRejectedError(`The configured ability formula is unusable: ${check.message}`);
      const scores: Array<{ total: number; faces: readonly number[] }> = [];
      let rollId: string | undefined;
      const result = await store.execute({ id: request.commandId, type: "builder.roll-abilities", expectedRevision: request.expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        scores.length = 0;
        const dice: Array<{ group: number; sides: number; face: number; kept: boolean; sign: 1 | -1 }> = [];
        for (let group = 0; group < 6; group += 1) {
          const resolution = resolveDice(parseDiceFormula(formula), (sides) => context.random(sides));
          const faces: number[] = [];
          for (const term of resolution.terms) {
            if (term.kind !== "dice") continue;
            for (const die of term.dice) { dice.push({ group, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign }); faces.push(die.face); }
          }
          scores.push({ total: resolution.total, faces });
        }
        rollId = context.newId();
        recordRoll(state, {
          id: rollId, commandId: request.commandId, initiatorSessionId: sessionIdOf(principal), initiatorRole: isGmGrade(principal) ? "gm" : "player",
          initiatorLabel: isGmGrade(principal) ? "GM" : "A player", label: "Ability scores", actorId: null, purpose: "manual", visibility: "public",
          formula: `6 x ${formula}`, normalizedFormula: `6 x ${formula}`,
          dice, modifiers: [], total: scores.reduce((sum, score) => sum + score.total, 0), createdAt: new Date().toISOString()
        });
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate, scores: scores.map((score) => score.total), dice: scores.map((score) => score.faces), rollId };
    },

    async builderSetPolicy(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can set the character-builder policy.");
      const request = parse(BuilderSetPolicySchema, raw, "The builder-policy command is malformed.");
      // A supplied formula must clear the SAME validator the roll path uses - never stored unvetted.
      if (typeof request.customFormula === "string") {
        const check = validateAbilityFormula(request.customFormula);
        if (!check.ok) throw new GameInputError(check.message);
      }
      const { commandId, allowedAbilityMethods, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "builder.set-policy", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.builderPolicy = {
          allowedAbilityMethods: [...allowedAbilityMethods],
          // Omitted = keep the stored formula; null = clear; a string = the validated new formula.
          customFormula: request.customFormula === undefined ? state.builderPolicy.customFormula : request.customFormula,
          // Same tri-state spirit for the two additive fields: omitted keeps what is stored.
          maxLevel: request.maxLevel ?? state.builderPolicy.maxLevel,
          playerBuilder: request.playerBuilder ?? state.builderPolicy.playerBuilder,
          playerRandom: request.playerRandom ?? state.builderPolicy.playerRandom
        };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `Character-builder ability methods set to ${allowedAbilityMethods.join(", ")}.`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterSubmitImport(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      // Any authenticated player or GM may submit a sheet; GM approval (below) is the gate.
      const envelope = parse(CharacterSubmitImportSchema, raw, "The import submission is malformed.");
      if (JSON.stringify(envelope.definition ?? null).length > 262_144) throw new GameInputError("That sheet is too large to import.");
      const parsed = ActorDefinitionSchema.safeParse(envelope.definition);
      if (!parsed.success) { const issue = parsed.error.issues[0]; throw new GameInputError(`That file is not a valid character (${issue.path.join(".") || "root"}: ${issue.message}).`); }
      const result = await store.execute({ id: envelope.commandId, type: "character.submit-import", expectedRevision: envelope.expectedRevision, payload: envelope, principal: principalTag(principal) }, (state) => submitPendingImport(state, parsed.data, envelope.commandId, sessionIdOf(principal)));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterResolveImport(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can approve imported sheets.");
      const envelope = parse(CharacterResolveImportSchema, raw, "The import decision is malformed.");
      const actorId = envelope.commandId;
      const result = await store.execute({ id: envelope.commandId, type: "character.resolve-import", actorId, expectedRevision: envelope.expectedRevision, payload: envelope, principal: principalTag(principal) }, (state) => resolvePendingImport(state, envelope.importId, envelope.approve, actorId));
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
        outcome = applyDamageDetailed(state, actorId, { amount, parts, critical, sourceName: sourceName ?? null, nonlethal }, scope, { resolveDefinition, newId: context.newId, now: () => new Date().toISOString(), catalog: equipmentCatalog() });
      });
      if (!result.duplicate && outcome) {
        await context.publishGameState(result.state);
        // Typed damage narrates its adjustments ("17 bludgeoning → 8, resistance: Rage") so the
        // table sees WHY the applied number differs - never a silent reduction (ADR-0020).
        const detail = damageAdjustmentDetail(outcome.application);
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
      if (!catalogFor(principal).hasCondition(request.conditionId)) throw new CommandRejectedError("That condition is not in the bundled rules.");
      if (request.override && !isGmGrade(principal)) throw new GameAccessDeniedError("Only the GM can override movement rules.");
      const scope = actorScopeOf(principal);
      const { commandId, actorId, conditionId, active, level, expectedRevision } = request;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "actor.set-condition", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        events = setCondition(state, actorId, conditionId, active, level, scope, { override: request.override ?? null, resolveDefinition, catalog: equipmentCatalog() });
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        const conditionName = catalogFor(principal).conditionSummaries().find((entry) => entry.id === conditionId)?.name ?? conditionId;
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
      const { commandId, formula, purpose, visibility, label, actorId, expectedRevision } = request;
      const gmGrade = isGmGrade(principal);
      if (!gmGrade && visibility === "gm-only") throw new GameAccessDeniedError("Only the GM can make a GM-only roll.");
      const initiatorSessionId = sessionIdOf(principal);
      const initiatorRole = gmGrade ? ("gm" as const) : ("player" as const);
      let resolution: ReturnType<typeof rollDice>;
      try { resolution = rollDice(formula, (sides) => context.random(sides)); }
      catch (error) { throw new CommandRejectedError(error instanceof Error ? error.message : "The roll failed."); }
      const rollId = context.newId();
      const result = await store.execute({ id: commandId, type: "dice.roll", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        // ATTRIBUTION (D11: "every roll is attributed to its character"). A player's loose tray roll used
        // to arrive with no actorId at all, so it vanished from the sheet's "Mine" filter and from the
        // feed's per-character view - the roll happened and then belonged to nobody. The server knows who
        // claimed what, so it fills the blank itself rather than waiting for every client to remember:
        // exactly one claimed, non-archived character, or it stays unattributed (an ambiguous claim must
        // not guess). An explicit actorId always wins and is still authorized below.
        const claimed = principal.kind === "player" ? state.actors.filter((candidate) => candidate.ownerSessionId === initiatorSessionId && !candidate.archived) : [];
        const attributedActorId = actorId ?? (claimed.length === 1 ? claimed[0].id : null);
        if (actorId && principal.kind === "player") {
          const verdict = canInitiateForActor({ role: "player", sessionId: principal.sessionId }, state, actorId, purpose === "save" ? "save" : purpose === "attack" || purpose === "damage" ? "attack" : "check");
          if (!verdict.ok) throw new CommandRejectedError("You may only roll for your claimed character.");
        }
        let group = 0;
        const dice = resolution.terms.flatMap((term) => {
          if (term.kind !== "dice") return [];
          const currentGroup = group++;
          return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign }));
        });
        const initiatorLabel = initiatorRole === "gm" ? gmGradeLabelOf(principal) : state.actors.find((candidate) => candidate.ownerSessionId === initiatorSessionId)?.name ?? "A player";
        const record: RollRecord = {
          id: rollId, commandId, initiatorSessionId, initiatorRole, initiatorLabel, ...(label ? { label } : {}), actorId: attributedActorId, purpose, visibility, formula,
          normalizedFormula: resolution.expression.normalized,
          dice,
          modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
          total: resolution.total, createdAt: new Date().toISOString()
        };
        recordRoll(state, record);
      });
      const accepted = result.state.rolls.find((roll) => roll.commandId === commandId);
      if (!result.duplicate) { await context.publishGameState(result.state); publishRolls(result.state, commandId); }
      return { revision: result.state.revision, duplicate: result.duplicate, rollId: accepted?.id, hiddenFromRoller: visibility === "blind" && !gmGrade };
    },

    // ---------- Stat-block actions & saving throws ----------

    async actionResolve(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ActionResolveSchema, raw, "The action command is malformed.", true);
      const { commandId, actorId, actionId, targetIds, template, conditionId, rollMode, override, commit, attackNatural, attackTotal, critical, expectedRevision } = request;
      // A player may resolve actions only for their own claimed character (re-checked against live state
      // inside the mutation). GM-only inputs - area templates (map calibration + a GM-authored annotation),
      // strict-mode overrides, cover, and applied conditions/notes - are refused or stripped for players,
      // who act through explicit target ids only.
      const initiator = initiatorOf(principal);
      const isPlayer = initiator.role === "player";
      if (isPlayer && template) throw new GameAccessDeniedError("Your GM places area templates.");
      if (isPlayer && override) throw new GameAccessDeniedError("Your GM adjudicates rules overrides.");
      const effectiveConditionId = isPlayer ? null : (conditionId ?? null);
      const effectiveCover = isPlayer ? null : (request.cover ?? null);
      const effectiveNote = isPlayer ? null : (request.note ?? null);
      if (effectiveConditionId !== null && !catalogFor(principal).hasCondition(effectiveConditionId)) throw new CommandRejectedError("That condition is not in the bundled reference.");
      // The map grid is fetched up front (async) so template containment AND token-distance rules
      // (prone within 5 ft, unconscious auto-crit) can run inside the synchronous mutation.
      const mapAssetId = store.snapshot.combat.mapAssetId;
      const geometry = mapAssetId ? await context.tokenGeometryFor(mapAssetId) : null;
      if (template && !geometry?.calibration) throw new CommandRejectedError("Calibrate this map before placing an area template.");
      const gmSessionId = sessionIdOf(principal);
      let resolution: ReturnType<typeof resolveDefinitionAction> | undefined;
      // A player's confirmed hit in "direct" mode applies server-side (GM-scoped) inside the mutation;
      // captured here so its damage narrates to the table after the state publishes (like actor:apply-damage).
      let playerDamageApplied: AppliedDamage | undefined;
      const result = await store.execute({ id: commandId, type: "action.resolve", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const attacker = state.actors.find((item) => item.id === actorId);
        if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
        // Authorize against live state (mirrors diceRoll): a player acts only on their own claimed
        // character; the GM (and integrations) may act on anyone. The seam is the intended per-table
        // policy hook (ADR-0021), so pass the action kind even though it is not read yet.
        const verdict = canInitiateForActor(initiator, state, actorId, "attack");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        const definition = attacker.definitionId ? resolveDefinitionIn(state, attacker.definitionId) : undefined;
        // The stat block wins on id collision; the builtin catalog (Dodge, Dash, Unarmed Strike, ...)
        // covers every combatant - including one without a definition.
        // EFFECTIVE actions: an item's derived action id (`item-<itemId>`) is otherwise unresolvable,
        // and a stat-block action's item-raised numbers would be read at their base values.
        const statBlockAction = effectiveActions(definition, attacker, equipmentCatalog()).find((candidate) => candidate.id === actionId);
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
        // A player may target only PUBLIC combatants. The runner offers only public targets, but the
        // server must not trust client input: resolving against a hidden (gm-only) actor id would leak
        // its name/AC/outcome back through the resolve ack (and, in direct mode, apply damage to it),
        // bypassing the player projection. Mirrors the attacker-ownership gate above (viewer safety).
        if (isPlayer) {
          for (const targetId of resolvedTargetIds) {
            if (!canPlayerTarget(state, targetId)) throw new CommandRejectedError("You can only target combatants you can see.");
          }
        }
        // Footprint-aware (SRD Creature Size): a Medium attacker adjacent to a Large creature is
        // 5 ft away - center-to-center would read 10 and wrongly block the melee swing.
        const distanceFeet = (actorIdA: string, actorIdB: string): number | null => {
          if (!geometry) return null;
          return tokenCreatureDistance(state, geometry, actorIdA, actorIdB)?.value ?? null;
        };
        resolution = resolveDefinitionAction(state, action, { actorId, targetIds: resolvedTargetIds, commandId, conditionId: effectiveConditionId, rollMode: rollMode ?? null, override: isPlayer ? null : (override ?? null), builtin: isBuiltin, note: effectiveNote, effectId: request.effectId ?? null, cover: effectiveCover, commit, attackNatural, attackTotal, critical }, { random: (sides) => context.random(sides), newRollId: context.newId, gmSessionId, initiatorRole: initiator.role, initiatorSessionId: sessionIdOf(principal), now: () => new Date().toISOString(), hasCondition: (id) => catalogFor(principal).hasCondition(id), definition, distanceFeet, resolveDefinition: (definitionId) => resolveDefinitionIn(state, definitionId), catalog: equipmentCatalog() });
        // A player's confirmed hit is settled server-side per the table's player-damage policy - parked as a
        // GM-confirmed proposal (default), or applied directly when the GM opted the table in - so the player
        // never mutates a creature they don't own. GM/integration resolves keep the runner's explicit Apply.
        if (isPlayer) playerDamageApplied = settlePlayerHit(state, resolution, attacker.name, actorId, state.combat.playerDamageMode, { resolveDefinition: (definitionId) => resolveDefinitionIn(state, definitionId), newId: context.newId, now: () => Date.now(), catalog: equipmentCatalog() }) ?? undefined;
        // Record the blast as a public shape so the whole table (and viewer) sees it; id=commandId keeps re-delivery idempotent.
        if (template) addAnnotation(state, { id: commandId, kind: "shape", shape: template.shape, origin: template.origin, target: template.target, visibility: "public", actor: { sessionId: gmSessionId, role: "gm" }, now: Date.now() }, geometry!);
      });
      if (!result.duplicate && resolution) {
        // A preview recorded only the attack die - publish it so the table sees the roll, but hold every
        // narration/broadcast until the resolve is confirmed (nothing was actually used yet).
        await context.publishGameState(result.state);
        publishRolls(result.state, commandId);
        if (!resolution.preview) {
        const hidden = actorHidden(actorId);
        context.broadcastTableEvent({ kind: "action", text: `${actorName(actorId)} used ${resolution.actionName}.`, actorIds: [actorId], gmOnly: hidden });
        // Rules-engine narration (ADR-0020): overrides are loudly audited, warnings reach the GM,
        // applied rider effects and granted self effects reach the whole table.
        if (resolution.overridden) context.appendLog({ kind: "override", text: `OVERRIDE (${resolution.overridden.rule}): ${actorName(actorId)} used ${resolution.actionName} - ${resolution.overridden.reason}`, actorIds: [actorId] });
        for (const warning of resolution.warnings ?? []) context.appendLog({ kind: "action", text: `Rules note: ${warning}`, actorIds: [actorId], gmOnly: true });
        for (const applied of resolution.effectsApplied ?? []) {
          context.broadcastTableEvent({ kind: "effect", text: `${applied.targetName} is ${applied.name}.`, actorIds: [applied.targetId], gmOnly: hidden });
        }
        if (resolution.effectGranted) {
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
          context.broadcastTableEvent({ kind: "effect", text: `${ended.name} ended on ${ended.actorName}.`, actorIds: [ended.actorId], gmOnly: hidden || actorHidden(ended.actorId) });
        }
        if (playerDamageApplied) {
          // Direct-mode auto-apply narrates its damage exactly like actor:apply-damage (with any typed-defense
          // breakdown). Both actors ride actorIds so gm-only-ness is re-derived correctly - the label names the
          // attacker, so a hidden attacker (unusual for a PC) must gate the line too.
          const { outcome, targetId, sourceActorId, label } = playerDamageApplied;
          const detail = damageAdjustmentDetail(outcome.application);
          context.broadcastTableEvent({ kind: "damage", text: `${label} hit ${actorName(targetId)} for ${outcome.application.totalApplied} damage${detail}.`, actorIds: [targetId, sourceActorId] });
          context.appendLog({ kind: "damage", text: `${label} hit ${actorName(targetId)} for ${outcome.application.totalApplied} damage${detail}.`, actorIds: [targetId, sourceActorId] });
          publishNarrations(outcome.events);
        }
        }
      }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(resolution && !result.duplicate ? { resolution } : {}) };
    },

    async saveAnswer(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SaveAnswerSchema, raw, "The saving-throw answer is malformed.", true);
      const scope = actorScopeOf(principal);
      const sessionId = sessionIdOf(principal);
      const { commandId, saveId, method, total, rollMode, commit, legendaryResistance, expectedRevision } = request;
      const pending = store.snapshot.combat.pendingSaves.find((entry) => entry.id === saveId);
      let answered: ReturnType<typeof answerSave> | undefined;
      const result = await store.execute({ id: commandId, type: "save.answer", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        answered = answerSave(state, commandId, saveId, method, total, commit, scope, {
          random: (sides) => context.random(sides),
          newRollId: context.newId,
          sessionId,
          role: scope.role,
          now: () => new Date().toISOString(),
          resolveDefinition,
          catalog: equipmentCatalog()
        }, legendaryResistance, rollMode);
      });
      const outcome = answered?.outcome;
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        publishRolls(result.state, commandId);
        if (outcome && outcome.committed && pending) {
          // The save path narrated a bare total for as long as it existed - so a fire-resistant
          // target's halved damage arrived unexplained. Same formatter as every other damage line.
          const detail = damageAdjustmentDetail({ parts: outcome.parts ?? [], ...(outcome.flatReduction ? { flatReduction: outcome.flatReduction } : {}) });
          context.broadcastTableEvent({ kind: "save", text: `${actorName(pending.targetActorId)} ${outcome.autoFailed ? "automatically failed" : outcome.success ? "succeeded on" : "failed"} a ${pending.ability.toUpperCase()} save${outcome.appliedDamage > 0 ? ` - ${outcome.appliedDamage} damage${detail}` : ""}.`, actorIds: [pending.targetActorId], gmOnly: actorHidden(pending.targetActorId) });
        }
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
      const { commandId, reactionId, use, actionId: chosenActionId, commit, rollMode, attackNatural, expectedRevision } = request;
      let outcome: ReturnType<typeof answerReaction> | undefined;
      const result = await store.execute({ id: commandId, type: "reaction.answer", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        outcome = answerReaction(state, commandId, reactionId, use, chosenActionId, scope, {
          resolveDefinition: (definitionId) => resolveDefinitionIn(state, definitionId),
          catalog: equipmentCatalog(),
          random: (sides) => context.random(sides),
          newRollId: context.newId,
          gmSessionId,
          now: () => new Date().toISOString()
        }, { commit, rollMode, attackNatural });
      });
      if (!result.duplicate && outcome) {
        await context.publishGameState(result.state);
        publishRolls(result.state, commandId);
        const hidden = actorHidden(outcome.actorId);
        // Both reaction paths kept only the total; the breakdown now rides the outcome, so all three
        // lines below explain a number the defences changed instead of just printing it.
        const detail = damageAdjustmentDetail({ parts: outcome.parts ?? [], ...(outcome.flatReduction ? { flatReduction: outcome.flatReduction } : {}) });
        if (outcome.kind === "leaves-reach") {
          if (outcome.used && outcome.resolution) {
            const attack = outcome.resolution.attack;
            const verdict = attack ? (attack.outcome === "crit" ? "CRIT" : attack.outcome.toUpperCase()) : "resolved";
            const text = `${outcome.actorName} made an opportunity attack against ${outcome.sourceName} - ${verdict}${outcome.appliedDamage > 0 ? `, ${outcome.appliedDamage} damage${detail}` : ""}.`;
            context.broadcastTableEvent({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
          }
        } else if (outcome.used) {
          const text = `${outcome.actorName} used ${outcome.actionName} - ${outcome.proposedDamage} damage becomes ${outcome.appliedDamage}${detail}.`;
          context.broadcastTableEvent({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
        } else {
          const text = `${outcome.actorName} declined ${outcome.actionName} - ${outcome.sourceName} hit for ${outcome.appliedDamage} damage${detail}.`;
          context.broadcastTableEvent({ kind: "damage", text, actorIds: [outcome.actorId], gmOnly: hidden });
        }
        publishNarrations(outcome.events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(outcome && !result.duplicate ? { outcome: { used: outcome.used, appliedDamage: outcome.appliedDamage, ...(outcome.resolution ? { resolution: outcome.resolution } : {}), ...(outcome.parts ? { parts: outcome.parts } : {}), ...(outcome.flatReduction ? { flatReduction: outcome.flatReduction } : {}) } } : {}) };
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
      // The actor's EFFECTIVE list, so an item's derived actions appear in the runner and a
      // pool whose limit an item raised reports the right number remaining.
      const available = effectiveActions(definition, actor, equipmentCatalog());
      const builtins = BUILTIN_ACTIONS.filter((candidate) => !available.some((declared) => declared.id === candidate.id));
      return {
        rulesMode: state.combat.rulesMode,
        actions: [
          ...actionAvailability(state, actor, available, definition, false, available),
          ...actionAvailability(state, actor, builtins, definition, true, available)
        ],
        // The sheet's own numbers, computed AFTER the gate above - so they are never derived for an
        // actor this caller may not see. This is why the block rides a request instead of the
        // broadcast projection: one authorization already written, instead of two strips that must
        // both stay right forever (see `actor-derived.ts`).
        derived: deriveActorSheet(actor, definition, deriveEquipment(actor, definition, equipmentCatalog()), catalogFor(principal).skillSummaries())
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
      const { commandId, actorId, commit, rollMode, naturalRoll, expectedRevision } = request;
      const rollId = context.newId();
      const initiatorSessionId = sessionIdOf(principal);
      let roll: ReturnType<typeof rollDeathSave> | undefined;
      let events: EffectNarration[] = [];
      const result = await store.execute({ id: commandId, type: "death-save.roll", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (scope.role === "player" && actor.ownerSessionId !== scope.sessionId) throw new CommandRejectedError("You can only roll for your own character.");
        if (actor.deathSaves === null || actor.hp.current > 0) throw new CommandRejectedError("That character isn't dying.");
        if (actor.deathSaves.stable) throw new CommandRejectedError("A stable character doesn't roll death saves.");
        if (actor.deathSaves.failures >= 3) throw new CommandRejectedError("That character is dead - heal or revive them through the GM.");
        // The die (and preview-vs-commit) is the shared, unit-tested death-save core; the operation keeps
        // authorization above and the natural-20 heal + narration below.
        roll = rollDeathSave(state, actor, { commit, rollMode, naturalRoll }, { random: context.random, rollId, commandId, sessionId: initiatorSessionId, role: isGmGrade(principal) ? "gm" : "player", now: () => new Date().toISOString() });
        if (commit && roll.outcome.regainsOneHitPoint) events = healActor(state, actorId, 1, { role: "gm" });
      });
      if (!result.duplicate && roll) {
        await context.publishGameState(result.state);
        publishRolls(result.state, commandId);
        if (commit) {
          const outcome = roll.outcome;
          const hidden = actorHidden(actorId);
          const text = outcome.regainsOneHitPoint ? `${actorName(actorId)} rolled a natural 20 on a death save and regains 1 HP!`
            : outcome.dead ? `${actorName(actorId)} failed a third death save and dies.`
            : outcome.state.stable ? `${actorName(actorId)} is stable.`
            : `${actorName(actorId)} ${outcome.outcome === "critical-failure" ? "rolled a natural 1 - two death save failures" : outcome.outcome === "success" ? "succeeded on a death save" : "failed a death save"} (${outcome.state.successes}S/${outcome.state.failures}F).`;
          context.broadcastTableEvent({ kind: "death-save", text, actorIds: [actorId], gmOnly: hidden });
          publishNarrations(events);
        }
      }
      return {
        revision: result.state.revision, duplicate: result.duplicate, rollId,
        ...(roll && !result.duplicate ? { deathSave: { naturalRoll: roll.face, outcome: roll.outcome.outcome, successes: roll.outcome.state.successes, failures: roll.outcome.state.failures, stable: roll.outcome.state.stable, dead: roll.outcome.dead, regainedConsciousness: roll.outcome.regainsOneHitPoint, committed: commit, ...(roll.mode ? { rollMode: roll.mode } : {}) } } : {})
      };
    },

    /**
     * THE TAP IS THE ATTACK (D10). The sheet says "use this action"; the SERVER decides what that means
     * right now and says so in the ack, instead of every client re-deriving it from a boolean.
     *
     * The old client gate also carried `actor.kind === "player-character"`, which is why a GM tapping a
     * monster's sheet mid-fight got loose dice while the same action through the tracker resolved
     * properly. That restriction was never in the server, and it does not come back here: a GM-grade
     * caller routes structured for any combatant, and the role check below is the only gate.
     */
    async actionUse(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ActionUseSchema, raw, "The action command is malformed.");
      const { commandId, actorId, actionId, targetIds, rollMode, includeDamage, override, expectedRevision } = request;
      if (override && !isGmGrade(principal)) throw new GameAccessDeniedError("Your GM adjudicates rules overrides.");
      const snapshot = store.snapshot;
      const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
      const route = routeForTap(snapshot.combat, actorId);

      // In the fight, on this creature's turn: delegate VERBATIM to the structured path - same resolver,
      // same economy, same narration, same idempotency receipt. Nothing is re-implemented here.
      if (route === "resolved") {
        const resolved = await operations.actionResolve(principal, { commandId, actorId, actionId, ...(targetIds ? { targetIds } : {}), ...(rollMode ? { rollMode } : {}), ...(expectedRevision === undefined ? {} : { expectedRevision }) });
        return { ...resolved, route: "resolved" };
      }

      const definition = actor.definitionId ? resolveDefinitionIn(snapshot, actor.definitionId) : undefined;
      const action = effectiveActions(definition, actor, equipmentCatalog()).find((candidate) => candidate.id === actionId) ?? builtinAction(actionId);
      if (!action) throw new CommandRejectedError("That action is not on the stat block.");

      // In the fight, off turn: a REAL rules block, which is what makes it overridable by the GM and
      // askable by the player. Under Advise it resolves with a warning; under Off it just resolves.
      if (route === "blocked") {
        const currentName = snapshot.combat.turnActorId === null ? "Someone else" : actorName(snapshot.combat.turnActorId);
        // A GM Allow (directly, or replayed by `rules.answer`) waves the refusal through AND remembers the
        // family, so the rest of this creature's off-turn flurry stops re-prompting - D9's one tap. The
        // memory write is its own tiny mutation because the block lives here, not inside the resolver.
        const verdict = override ? { warning: null } : offTurnVerdict(snapshot, action, currentName);
        if (override) {
          await store.execute({ id: context.newId(), type: "action.use", actorId, payload: { commandId, override }, principal: principalTag(principal) }, (state) => { rememberOverride(state, NOT_YOUR_TURN); });
          context.appendLog({ kind: "override", text: `OVERRIDE (${NOT_YOUR_TURN}): ${actorName(actorId)} acted off turn - ${overrideReason(override)}`, actorId, actorIds: [actorId] });
        }
        const resolved = await operations.actionResolve(principal, { commandId, actorId, actionId, ...(targetIds ? { targetIds } : {}), ...(rollMode ? { rollMode } : {}), ...(override ? { override } : {}), ...(expectedRevision === undefined ? {} : { expectedRevision }) });
        if (verdict.warning !== null) context.appendLog({ kind: "action", text: `Rules note: ${verdict.warning}`, actorId, actorIds: [actorId], gmOnly: true });
        return { ...resolved, route: "resolved", ...(verdict.warning === null ? {} : { warning: verdict.warning }) };
      }

      // Loose: the server rolls the action's own dice, attributed to the character, and touches no
      // combat state at all. No hit points move on this path - HP only ever flows through the resolver.
      const plan = looseRollPlan(action, { includeDamage: includeDamage === true, ...(rollMode ? { rollMode } : {}) });
      if (plan.length === 0) throw new CommandRejectedError(`${action.name} has nothing to roll outside a fight.`);
      const initiator = initiatorOf(principal);
      const gmGrade = isGmGrade(principal);
      const rollIds = plan.map(() => context.newId());
      const result = await store.execute({ id: commandId, type: "action.use", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiator, state, actorId, "attack");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        const live = state.actors.find((candidate) => candidate.id === actorId)!;
        plan.forEach((entry, index) => {
          const resolution = rollDice(entry.formula, (sides) => context.random(sides));
          let group = 0;
          recordRoll(state, {
            id: rollIds[index], commandId, initiatorSessionId: sessionIdOf(principal), initiatorRole: gmGrade ? "gm" : "player",
            initiatorLabel: live.name, label: entry.label, actorId, purpose: entry.purpose,
            visibility: live.visibility === "gm-only" ? "gm-only" : "public",
            formula: entry.formula, normalizedFormula: resolution.expression.normalized,
            dice: resolution.terms.flatMap((term) => { if (term.kind !== "dice") return []; const currentGroup = group++; return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign })); }),
            modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
            total: resolution.total, createdAt: new Date().toISOString()
          });
        });
      });
      if (!result.duplicate) { await context.publishGameState(result.state); publishRolls(result.state, commandId); }
      return { revision: result.state.revision, duplicate: result.duplicate, route: "loose", rollIds };
    },

    /**
     * THE SAVE CHIP ANSWERS THE QUESTION (D10). A pending save open for this character and ability is
     * ANSWERED - the same `save.answer` path the tracker uses, so the damage and condition apply and the
     * prompt closes. With nothing open it is an ordinary attributed save roll, which is what the chip
     * always did and all it could ever do before.
     */
    async saveRoll(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SaveRollSchema, raw, "The saving throw is malformed.");
      const { commandId, actorId, ability, rollMode, total, expectedRevision } = request;
      const snapshot = store.snapshot;
      const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
      // Oldest first: a character owing two saves answers the one they have been waiting on longest.
      const pending = snapshot.combat.pendingSaves.find((entry) => entry.targetActorId === actorId && entry.ability === ability);
      if (pending) {
        const answered = await operations.saveAnswer(principal, { commandId, saveId: pending.id, method: total === undefined ? "roll" : "manual", ...(total === undefined ? {} : { total }), ...(rollMode ? { rollMode } : {}), commit: true, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
        return { ...answered, route: "answered", saveId: pending.id };
      }
      // No open prompt: a loose save, rolled server-side at the SAME modifier the resolver would use,
      // so a chip and a forced save can never disagree about the number (the actor-derived contract).
      const definition = actor.definitionId ? resolveDefinitionIn(snapshot, actor.definitionId) : undefined;
      const modifier = saveTotalFor(definition, actor, ability, deriveEquipment(actor, definition, equipmentCatalog()));
      const die = rollMode === "advantage" ? "2d20kh1" : rollMode === "disadvantage" ? "2d20kl1" : "1d20";
      const loose = await operations.diceRoll(principal, {
        commandId, actorId, formula: total === undefined ? `${die}${modifier === 0 ? "" : modifier < 0 ? ` - ${Math.abs(modifier)}` : ` + ${modifier}`}` : `${total}`,
        purpose: "save", visibility: actor.visibility === "gm-only" ? "gm-only" : "public", label: `${ability.toUpperCase()} save`,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
      });
      return { ...loose, route: "loose" };
    },

    // ---------- Ask the GM (D8/D9) ----------

    /**
     * A blocked player taps "Ask the GM" and the SAME command arrives here.
     *
     * The server re-runs it first, under the ASKER's own authority and with no override at all. That is
     * the whole design: if the situation changed and the command now succeeds, it just succeeds and
     * nobody is asked anything; only a command that still blocks is parked. It also means the parked
     * ask is never a lie - the block was re-proved a moment ago, against live state.
     */
    async rulesAsk(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(RulesAskSchema, raw, "The question is malformed.");
      const { commandId, type, payload, expectedRevision } = request;
      // Re-run under the asker's own authority: their role limits are unchanged, so a player still
      // cannot reach another character's command by wrapping it in an ask.
      const attempt = askRerunPayload(payload);
      try {
        const outcome = await askableRunners[type](principal, attempt);
        return { ...outcome, ran: true };
      } catch (error) {
        if (!(error instanceof RulesBlockedError)) throw error;
        // Only a rules block becomes a question. Everything else - a malformed payload, an actor the
        // caller may not act for, a target that no longer exists - is still that command's own refusal.
        const actorId = askActorId(attempt);
        if (actorId === null) throw new CommandRejectedError("That action names no character to ask about.");
        const askId = context.newId();
        let parked: PendingRuleAsk | undefined;
        const result = await store.execute({ id: commandId, type: "rules.ask", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
          const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "check");
          if (!verdict.ok) throw new CommandRejectedError(verdict.message);
          parked = parkRuleAsk(state, {
            id: askId, actorId, rule: error.rule, family: familyOf(error.rule), message: error.message,
            command: { type, payload: attempt }, createdAt: new Date().toISOString()
          });
        });
        if (!result.duplicate) {
          await context.publishGameState(result.state);
          // GM-only: the question reaches the GM through their projection (and this line); the asker
          // already knows what they asked, and the rest of the table has no business seeing it.
          context.appendLog({ kind: "override", text: `${actorName(actorId)} asked the GM about a blocked action (${error.rule}): ${error.message}`, actorId, gmOnly: true });
        }
        return { revision: result.state.revision, duplicate: result.duplicate, askId: parked?.id ?? askId, ran: false, blocked: { rule: error.rule, message: error.message, overridable: error.overridable } };
      }
    },

    /**
     * The GM's one tap (D9). Allow replays the parked command with an injected override under GM
     * authority - the roll and the economy still attribute to the parked character, and the rules
     * engine's own override path records the family memory, so the same KIND of block stops nagging for
     * the rest of that turn. Deny clears the ask and tells the player plainly.
     *
     * Order matters: the replay runs BEFORE the ask is cleared. A replay that fails against current
     * state (the target moved, the target died, a different rule now bites) surfaces its own rejection
     * and leaves the question parked, so the GM can look and answer again instead of losing it.
     */
    async rulesAnswer(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can answer a rules question.");
      const request = parse(RulesAnswerSchema, raw, "The answer is malformed.");
      const { commandId, askId, allow, reason, expectedRevision } = request;
      const ask = findRuleAsk(store.snapshot, askId);
      if (!ask) throw new CommandRejectedError("That question is no longer waiting - the fight moved on.");
      let ran: GameMutationResult | undefined;
      if (allow) ran = await askableRunners[ask.command.type](principal, rerunPayload(ask, reason));
      const result = await store.execute({ id: commandId, type: "rules.answer", actorId: ask.actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { clearRuleAsk(state, askId); });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        const hidden = actorHidden(ask.actorId);
        const relaxed = ask.family === null ? "" : ` (${ask.family} checks relaxed for this turn)`;
        context.appendLog({
          kind: "override",
          text: allow
            ? `The GM allowed ${actorName(ask.actorId)}'s blocked action${relaxed} - ${overrideReason({ ...(reason === undefined ? {} : { reason }) })}.`
            : `The GM declined ${actorName(ask.actorId)}'s blocked action.`,
          actorId: ask.actorId, actorIds: [ask.actorId], gmOnly: hidden
        });
      }
      return { revision: result.state.revision, duplicate: result.duplicate, allowed: allow, ...(ran ? { outcome: ran } : {}) };
    },

    async encounterSetRulesMode(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change the rules mode.");
      const request = parse(SetRulesModeSchema, raw, "The rules-mode command is malformed.");
      const { commandId, mode, exceptions, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "encounter.set-rules-mode", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        // Omitted exceptions leave the stored ones alone, so an old mode-only payload still means
        // exactly what it always meant - the field is additive, not a reset.
        state.combat = { ...state.combat, rulesMode: mode, ...(exceptions === undefined ? {} : { ruleExceptions: { ...exceptions } }) };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `Rules mode set to ${mode}${exceptions === undefined ? "" : ` (${describeRuleExceptions(exceptions)})`}.`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    /**
     * The STANDING rules policy every new fight inherits (D7) - campaign policy, not fight state, which
     * is why it lives top-level beside `builderPolicy` instead of on `combat` (parking it on combat
     * would drag it through scene park/resume). Changing it does NOT touch the fight in progress; that
     * is `encounter.set-rules-mode`, and keeping the two separate is what makes "each fight starts from
     * the table's settings" a promise rather than a surprise mid-combat re-tune.
     */
    async rulesSetPolicy(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can set the rules policy.");
      const request = parse(RulesSetPolicySchema, raw, "The rules-policy command is malformed.");
      const { commandId, dial, exceptions, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "rules.set-policy", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.rulesPolicy = { dial, exceptions: exceptions === undefined ? { ...state.rulesPolicy.exceptions } : { ...exceptions } };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `Table rules policy set to ${dial}${exceptions === undefined ? "" : ` (${describeRuleExceptions(exceptions)})`}.`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    /**
     * Table defaults for staging (D2). Stored only - the per-add `visibility` argument stays explicit
     * on the wire, so this is what a surface INITIALIZES its toggle from, never a silent server-side
     * substitution that would make an add command say one thing and do another.
     */
    async tableSetStagingDefaults(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can set the table's staging defaults.");
      const request = parse(TableSetStagingDefaultsSchema, raw, "The staging-defaults command is malformed.");
      const { commandId, visibility, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "table.set-staging-defaults", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.stagingDefaults = { visibility };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `New combatants now stage as ${visibility === "gm-only" ? "GM only" : "shown to players"}.`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    /**
     * How much a player sees of ANOTHER player's character (rulings 5/8/19). Stored only - the whole
     * of the enforcement is `projectPlayerView` in `projections.ts`, which is what makes this a real
     * setting rather than a client-side filter over data already on the wire.
     *
     * `publishGameState` re-projects for every connected socket, so a player already at the table sees
     * the new tier on the next tick without reconnecting - the same mechanism every other table
     * setting rides. The audit line is GM-only: what the GM lets players see is table management, and
     * announcing it to the table would be its own small leak.
     */
    async tableSetPartyVisibility(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can set what players see of each other.");
      const request = parse(TableSetPartyVisibilitySchema, raw, "The party-visibility command is malformed.");
      const { commandId, visibility, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "table.set-party-visibility", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.partyVisibility = visibility;
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: PARTY_VISIBILITY_LOG[visibility], gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async encounterSetPlayerDamageMode(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change how players' hits apply damage.");
      const request = parse(SetPlayerDamageModeSchema, raw, "The player-damage-mode command is malformed.");
      const { commandId, mode, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "encounter.set-player-damage-mode", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.combat = { ...state.combat, playerDamageMode: mode };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `Players' hits now ${mode === "direct" ? "apply damage directly" : "wait for the GM to confirm"}.`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async encounterSetPlayerInitiativeMode(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change how player initiative works.");
      const request = parse(SetPlayerInitiativeModeSchema, raw, "The initiative-mode command is malformed.");
      const { commandId, mode, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "encounter.set-player-initiative-mode", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.combat = { ...state.combat, playerInitiativeMode: mode };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `Player initiative now ${mode === "wait" ? "waits for everyone to roll" : "begins immediately"}.`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async damageResolve(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can apply proposed damage.");
      const request = parse(DamageResolveSchema, raw, "The damage-resolution command is malformed.");
      const { commandId, proposalId, apply, amount, expectedRevision } = request;
      let applied: AppliedDamage | undefined;
      const result = await store.execute({ id: commandId, type: "damage.resolve", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        applied = resolvePendingDamage(state, proposalId, apply, amount, { resolveDefinition, newId: context.newId, now: () => Date.now(), catalog: equipmentCatalog() }) ?? undefined;
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        if (applied) {
          const { outcome, targetId, sourceActorId, label } = applied;
          const detail = damageAdjustmentDetail(outcome.application);
          const text = `${label} hit ${actorName(targetId)} for ${outcome.application.totalApplied} damage${detail}.`;
          context.broadcastTableEvent({ kind: "damage", text, actorIds: [targetId, sourceActorId] });
          context.appendLog({ kind: "damage", text, actorIds: [targetId, sourceActorId] });
          publishNarrations(outcome.events);
        }
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async encounterSetHealthDisplay(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change how health is shown.");
      const request = parse(SetHealthDisplaySchema, raw, "The health-display command is malformed.");
      const { commandId, style, audience, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "encounter.set-health-display", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        state.combat = { ...state.combat, healthDisplay: { style, audience } };
      });
      if (!result.duplicate) { await context.publishGameState(result.state); context.appendLog({ kind: "encounter", text: `Token health now shows as ${style === "band" ? "a status badge" : style === "bar" ? "an HP bar" : "a health ring"}${audience === "all" ? ", for everyone." : ", on the GM map only."}`, gmOnly: true }); }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorSetHealthDisplay(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can change how health is shown.");
      const request = parse(SetActorHealthDisplaySchema, raw, "The health-display command is malformed.");
      const { commandId, actorId, display, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.set-health-display", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((item) => item.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (display === null) delete actor.healthDisplay; else actor.healthDisplay = display;
      });
      if (!result.duplicate) await context.publishGameState(result.state);
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

    /**
     * RE-MAKE A PICK the content says may be re-made on a rest - ruling A's runtime half.
     *
     * "Whenever you finish a Long Rest, choose one type of land." The answer is NOT written to
     * `character.choices[]`: that ledger is the provenance level-up and respec are built on, and a
     * re-choice between fights must not require a rebuild. It goes on the actor as `choiceOverrides`,
     * beside `actionUses`, and the matching rest clears it (`rests.ts`).
     *
     * The server decides both halves of legality from the CONTENT, never from the request: which
     * offers this character may re-choose at all (a feature declaring `replaces`), and what each may
     * be re-chosen to (that offer's own option list). A client cannot widen either.
     */
    async actorRechoose(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ActorRechooseSchema, raw, "The re-choose command is malformed.");
      const { commandId, actorId, offer, id, expectedRevision } = request;
      let label = "";
      const result = await store.execute({ id: commandId, type: "actor.rechoose", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        // The same owner-or-GM seam a rest uses: this is a resource decision on a character sheet.
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "resource");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
        // The GM audience deliberately: legality is a CONTENT question (which feature declares the
        // clause, what its option list is), and a player re-choosing on their own sheet must get the
        // same answer the GM would. Nothing GM-only is projected - only the offer they may already see.
        const choices = replaceableOffers(definition, contentLibrary.forAudience("gm"));
        const match = choices.find((candidate) => candidate.offer === offer);
        if (!match) {
          throw new CommandRejectedError(choices.length === 0
            ? `Nothing on ${actor.name}'s sheet can be re-chosen on a rest.`
            : `${actor.name} cannot re-choose "${offer}" - only ${choices.map((candidate) => `"${candidate.offer}"`).join(", ")}.`);
        }
        if (!match.options.includes(id)) {
          throw new CommandRejectedError(`"${id}" is not one of the options ${match.label} offers (${match.options.join(", ")}).`);
        }
        label = match.label;
        actor.choiceOverrides = { ...actor.choiceOverrides, [offer]: { id, per: match.per } };
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: `${actorName(actorId)} re-chose ${label}: ${id}.`, actorIds: [actorId], gmOnly: actorHidden(actorId) });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async actorRest(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(ActorRestSchema, raw, "The rest command is malformed.");
      const { commandId, actorId, kind, expectedRevision } = request;
      let events: EffectNarration[] = [];
      // A player may rest their own claimed character (v5 #5); the GM rests anyone. Same owner-or-GM seam
      // as spending a slot - authorised inside the mutation against live state (applyRest itself still
      // refuses to rest a combatant who is in a running encounter).
      const result = await store.execute({ id: commandId, type: "actor.rest", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "resource");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        events = applyRest(state, actorId, kind, resolveDefinition, equipmentCatalog());
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
        const outcome = spendHitDice(state, actorId, faces, scope, (definitionId) => resolveDefinitionIn(state, definitionId));
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
        recordRoll(state, record);
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        publishRolls(result.state, commandId);
        context.appendLog({ kind: "heal", text: `${actorName(actorId)} spends ${count} Hit ${count === 1 ? "Die" : "Dice"} and regains ${healed} HP.`, actorIds: [actorId], gmOnly: actorHidden(actorId) });
        publishNarrations(events);
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterSetSlot(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterSetSlotSchema, raw, "The spell-slot command is malformed.");
      const { commandId, actorId, level, remaining, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.set-slot", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "resource");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        setSpellSlotRemaining(state, actorId, level, remaining, (definitionId) => resolveDefinitionIn(state, definitionId), equipmentCatalog());
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterSetPrepared(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterSetPreparedSchema, raw, "The prepared-spell command is malformed.");
      const { commandId, actorId, spellId, prepared, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.set-prepared", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "resource");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        setPreparedSpell(state, actorId, spellId, prepared, (definitionId) => resolveDefinitionIn(state, definitionId));
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterSetInventory(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterSetInventorySchema, raw, "The inventory command is malformed.");
      const { commandId, actorId, item, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.set-inventory", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "inventory");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        setInventoryItem(state, actorId, item, (definitionId) => resolveDefinitionIn(state, definitionId), { catalog: equipmentCatalog(), role: isGmGrade(principal) ? "gm" : "player" });
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterSetCurrency(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterSetCurrencySchema, raw, "The currency command is malformed.");
      const { commandId, actorId, currency, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.set-currency", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "inventory");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        setCurrency(state, actorId, currency);
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterSetIdentity(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterSetIdentitySchema, raw, "The identity command is malformed.");
      const { commandId, actorId, character, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.set-identity", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "edit");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        setCharacterIdentity(state, actorId, character);
      });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    async characterSetProficiencies(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(CharacterSetProficienciesSchema, raw, "The proficiencies command is malformed.");
      const { commandId, actorId, proficiencies, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "character.set-proficiencies", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const verdict = canInitiateForActor(initiatorOf(principal), state, actorId, "edit");
        if (!verdict.ok) throw new CommandRejectedError(verdict.message);
        setCharacterProficiencies(state, actorId, proficiencies);
      });
      if (!result.duplicate) await context.publishGameState(result.state);
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

    /**
     * D18: a player picks the token for their OWN claimed character. The GM still sets anyone's -
     * `canInitiateForActor` is the same one-line gate every other player-initiated command uses, so
     * "own claimed character only" has one definition, not a second copy here.
     */
    async actorSetTokenImage(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      const request = parse(SetTokenImageSchema, raw, "The token image command is malformed.");
      const { commandId, actorId, tokenAssetId, expectedRevision } = request;
      const verdict = canInitiateForActor(initiatorOf(principal), store.snapshot, actorId, "edit");
      if (!verdict.ok) throw new GameAccessDeniedError(verdict.message);
      if (tokenAssetId !== null && !context.tokenCatalog.get(tokenAssetId)) throw new CommandRejectedError("That token image is not in your library.");
      const result = await store.execute({ id: commandId, type: "actor.set-token-image", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((item) => item.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        // Re-checked INSIDE the transaction: the snapshot check above races a claim release.
        const inside = canInitiateForActor(initiatorOf(principal), state, actorId, "edit");
        if (!inside.ok) throw new CommandRejectedError(inside.message);
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

    async actorSetArchived(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can archive characters.");
      const request = parse(SetActorArchivedSchema, raw, "The archive command is malformed.");
      const { commandId, actorId, archived, expectedRevision } = request;
      // Archiving hides a character from players (projection) and the encounter builder; a live actor may
      // not be archived while it's in the running fight - the GM removes it from combat first.
      let releasedClaim = false;
      const result = await store.execute({ id: commandId, type: "actor.set-archived", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        if (archived && state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("Remove this character from the encounter before archiving it.");
        // Archiving a CLAIMED character used to leave the claim in place while the projection hid the
        // character from everyone INCLUDING its owner: the player held an invisible claim and, because
        // the one-claim rule counts by session, could not claim anything else. Release it here, in the
        // same mutation, so archiving means what it says - hidden, kept, out of play.
        releasedClaim = archived && actor.ownerSessionId !== null;
        if (releasedClaim) forceReleaseCharacter(state, actorId, "gm");
        actor.archived = archived;
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        if (releasedClaim) context.appendLog({ kind: "encounter", text: `${actorName(actorId)} was archived - their player's claim was released.`, actorIds: [actorId], gmOnly: true });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    /**
     * Share (or un-share) an ARCHIVED character's sheet back to players as a read-only keepsake (D26).
     * Default hidden; the flag is meaningless while the character is live, whose sheet reaches only its
     * owner exactly as before. Players receive nothing but the id and name (`archivedCharacters`).
     */
    async actorSetSheetPreview(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can share an archived character's sheet.");
      const request = parse(SetActorSheetPreviewSchema, raw, "The sheet-preview command is malformed.");
      const { commandId, actorId, enabled, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "actor.set-sheet-preview", actorId, expectedRevision, payload: request, principal: principalTag(principal) }, (state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        actor.sheetPreview = enabled;
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "encounter", text: `${actorName(actorId)}'s archived sheet is now ${enabled ? "shared with players" : "hidden from players"}.`, actorIds: [actorId], gmOnly: true });
      }
      return { revision: result.state.revision, duplicate: result.duplicate };
    },

    // ---------- Scenes ----------

    async sceneCreate(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can prepare scenes.");
      const request = parse(SceneCreateSchema, raw, "The scene setup is malformed.");
      const sceneMap = context.mapCatalog.get(request.mapAssetId);
      if (!sceneMap || sceneMap.kind !== "battlemap") throw new CommandRejectedError("Prepare scenes on an uploaded battlemap.");
      const { commandId, name, mapAssetId, combatantIds, activate, expectedRevision } = request;
      const geometry = await context.tokenGeometryFor(mapAssetId);
      const implicitSceneId = context.newId();
      // `activate` makes "prepare and go" one command instead of prepare-then-switch. It runs the SAME
      // park/resume swap `scene.activate` runs (and inherits its refusals - a GM mid-history-review is
      // still told to finish first), which is why it goes through executeTimeline and truncates.
      const result = await store.executeTimeline({ id: commandId, type: "scene.create", expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        createScene(state, { sceneId: commandId, name, mapAssetId, combatantIds }, geometry);
        if (activate === true) {
          // The implicit-scene id must NOT be the commandId here: the scene we just created already
          // owns it, and parking a pre-scenes encounter under the same id would collide.
          activateScene(state, commandId, implicitSceneId);
          timeline.truncateAll();
        }
      });
      if (!result.duplicate) {
        await context.publishGameState(result.state);
        // Going live also presents the map on the shared screen - the same one action scene.activate is.
        if (activate === true && result.state.combat.mapAssetId) await context.presentSceneMap(result.state.combat.mapAssetId);
      }
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
        // A scene prepared before archived characters were rejected server-side may still hold one.
        // Activation deliberately does NOT refuse (that would strand the scene with no way back); the
        // GM is told instead, and removes them. No destructive scrub of stored prep.
        const resumedArchived = result.state.combat.initiative
          .map((entry) => result.state.actors.find((actor) => actor.id === entry.actorId))
          .filter((actor): actor is NonNullable<typeof actor> => actor !== undefined && actor.archived);
        if (resumedArchived.length > 0) context.appendLog({ kind: "scene", text: `This scene still stages ${resumedArchived.length} archived character${resumedArchived.length === 1 ? "" : "s"} (${resumedArchived.map((actor) => actor.name).join(", ")}) - restore or remove them.`, gmOnly: true });
        // Going live also presents the scene's map on the shared screen, so it's one action.
        if (result.state.combat.mapAssetId) await context.presentSceneMap(result.state.combat.mapAssetId);
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
    },

    /**
     * LAUNCH FROM HERE (D25). Parks the live table exactly as `sceneActivate` does - same park/resume
     * motion, same map presentation on the shared screen - and goes live on the recorded moment.
     * There is no second table: the parked scene is one `scene.activate` away, always.
     */
    async replayLaunch(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can launch a replay.");
      const request = parse(ReplayLaunchSchema, raw, "The replay launch is malformed.");
      const { commandId, archiveId, turnIndex, expectedRevision } = request;
      if (!context.archiveDocument) throw new CommandRejectedError("Recorded fights are not available on this server.");
      const stored = context.archiveDocument(archiveId);
      if (stored === null) throw new CommandRejectedError("No such recorded fight.");
      let document: EncounterArchiveDocument;
      try { document = JSON.parse(stored) as EncounterArchiveDocument; }
      catch { throw new CommandRejectedError("That recording could not be read."); }
      let outcome: ReturnType<typeof launchReplay> | undefined;
      const result = await store.executeTimeline({ id: commandId, type: "replay.launch", expectedRevision, payload: request, principal: principalTag(principal) }, (state, timeline) => {
        outcome = launchReplay(state, { archiveId, document, turnIndex, sceneId: commandId, implicitSceneId: `${commandId.slice(0, 35)}-p`, newActorId: context.newId });
        // The snapshots belonged to the fight that just parked; the swap invalidates them.
        timeline.truncateAll();
      });
      if (!result.duplicate && outcome) {
        await context.publishGameState(result.state);
        context.appendLog({ kind: "scene", text: `Launched a recorded moment: "${outcome.label}". The table you were on is parked - switch back any time.`, gmOnly: true });
        if (result.state.combat.mapAssetId) await context.presentSceneMap(result.state.combat.mapAssetId);
      }
      return { revision: result.state.revision, duplicate: result.duplicate, ...(outcome ? { sceneId: outcome.scene.id, actorIds: outcome.actorIds } : {}) };
    },

    async sceneDuplicate(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can duplicate scenes.");
      const request = parse(SceneIdSchema, raw, "The scene command is malformed.");
      const { commandId, sceneId, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "scene.duplicate", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => { duplicateScene(state, sceneId, commandId); });
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate, sceneId: commandId };
    },

    async sceneReorder(principal: GamePrincipal, raw: unknown): Promise<GameMutationResult> {
      requireGmGrade(principal, "Only the GM can reorder scenes.");
      const request = parse(SceneReorderSchema, raw, "The scene order is malformed.");
      const { commandId, order, expectedRevision } = request;
      const result = await store.execute({ id: commandId, type: "scene.reorder", expectedRevision, payload: request, principal: principalTag(principal) }, (state) => reorderScenes(state, order));
      if (!result.duplicate) await context.publishGameState(result.state);
      return { revision: result.state.revision, duplicate: result.duplicate };
    }
  };

  /**
   * The closed list of commands an ask can carry, mapped to the SAME handlers every other caller uses
   * (D8). Deliberately not the command registry: the registry is built from these operations, so this
   * would be a cycle - and a closed table is the point. `rules.ask` re-runs through it under the asker's
   * authority; `rules.answer` re-runs through it under the GM's, with the override injected.
   */
  const askableRunners: Readonly<Record<AskableCommand, (principal: GamePrincipal, raw: unknown) => Promise<GameMutationResult>>> = {
    "action.resolve": (principal, raw) => operations.actionResolve(principal, raw),
    "action.use": (principal, raw) => operations.actionUse(principal, raw),
    "token.move": (principal, raw) => operations.tokenMove(principal, raw),
    "actor.set-condition": (principal, raw) => operations.actorSetCondition(principal, raw)
  };

  return operations;
}

/** The character a parked payload is about - every askable command names one, and an ask without one is not askable. */
function askActorId(payload: unknown): string | null {
  const actorId = (payload as { actorId?: unknown } | null | undefined)?.actorId;
  return typeof actorId === "string" && actorId.length > 0 ? actorId : null;
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
    ["encounter.start", "Start an encounter on a battlemap; omit the combatants to start on the live scene's staged list (GM).", (p, raw) => operations.encounterStart(p, raw)],
    ["encounter.end", "End the encounter and archive it permanently (GM).", (p, raw) => operations.encounterEnd(p, raw)],
    ["encounter.add-combatant", "Add a rostered actor to the running encounter (GM).", (p, raw) => operations.encounterAddCombatant(p, raw)],
    ["initiative.set", "Set a combatant's initiative score (GM).", (p, raw) => operations.initiativeSet(p, raw)],
    ["initiative.roll-self", "Roll your own claimed character's initiative (GM anyone); the server rolls unless a manual d20 is given.", (p, raw) => operations.initiativeRollSelf(p, raw)],
    ["initiative.roll-remaining", "Roll initiative for every player still pending, beginning a wait-mode fight (GM).", (p, raw) => operations.initiativeRollRemaining(p, raw)],
    ["initiative.next", "Advance the turn; steps forward through recorded history while rewound (GM).", (p, raw) => operations.initiativeNext(p, raw)],
    ["initiative.previous", "Rewind the whole table to the previous turn boundary (GM).", (p, raw) => operations.initiativePrevious(p, raw)],
    ["turn.end", "End the current turn (GM anyone; a player only their own turn).", (p, raw) => operations.turnEnd(p, raw)],
    ["turn.use", "Mark the current turn's action or bonus action used/unused.", (p, raw) => operations.turnUse(p, raw)],
    ["turn.use-reaction", "Mark a combatant's reaction used/unused.", (p, raw) => operations.turnUseReaction(p, raw)],
    ["turn.use-legendary", "Set a legendary creature's spent legendary actions this round.", (p, raw) => operations.turnUseLegendary(p, raw)],
    ["token.move", "Move a combatant's token (server-snapped); position null returns it to the tray.", (p, raw) => operations.tokenMove(p, raw)],
    ["actor.add-from-definition", "Instantiate a bundled SRD monster onto the roster, optionally joining the running fight in the same command (GM).", (p, raw) => operations.actorAddFromDefinition(p, raw)],
    ["actor.import-definition", "Import a canonical ActorDefinition JSON as a claimable actor (GM).", (p, raw) => operations.actorImportDefinition(p, raw)],
    ["character.submit-import", "Submit a character sheet into the GM's approval queue (anyone at the table); the queued importId equals the commandId.", (p, raw) => operations.characterSubmitImport(p, raw)],
    ["character.resolve-import", "Approve or reject a queued character submission (GM); approving instantiates the actor, whose id equals the commandId.", (p, raw) => operations.characterResolveImport(p, raw)],
    ["actor.remove", "Remove an actor from the roster (GM).", (p, raw) => operations.actorRemove(p, raw)],
    ["actor.apply-damage", "Apply damage (GM anyone; a player their claimed character).", (p, raw) => operations.actorApplyDamage(p, raw)],
    ["actor.heal", "Heal hit points (GM anyone; a player their claimed character).", (p, raw) => operations.actorHeal(p, raw)],
    ["actor.set-temp-hp", "Set temporary hit points (GM anyone; a player their claimed character).", (p, raw) => operations.actorSetTempHp(p, raw)],
    ["actor.set-hp", "Set current hit points directly (GM).", (p, raw) => operations.actorSetHp(p, raw)],
    ["actor.set-condition", "Apply or clear an SRD condition, with exhaustion levels.", (p, raw) => operations.actorSetCondition(p, raw)],
    ["dice.roll", "Roll dice into the shared, auditable roll history.", (p, raw) => operations.diceRoll(p, raw)],
    ["action.resolve", "Run a stat-block action: attack vs AC or save-DC with typed damage (GM anyone; a player their own claimed character).", (p, raw) => operations.actionResolve(p, raw)],
    ["action.use", "Use an action and let the SERVER route it: resolved in the fight on your turn, refused off turn, loose dice outside a fight (GM anyone; a player their own claimed character).", (p, raw) => operations.actionUse(p, raw)],
    ["save.roll", "Roll a saving throw: answers a matching pending save when one is open, otherwise rolls a loose, attributed save.", (p, raw) => operations.saveRoll(p, raw)],
    ["save.answer", "Answer a pending saving throw by rolling or entering a total.", (p, raw) => operations.saveAnswer(p, raw)],
    ["save.dismiss", "Dismiss a pending saving throw without resolving it.", (p, raw) => operations.saveDismiss(p, raw)],
    ["reaction.answer", "Answer a pending reaction prompt: use it (spend the reaction, halve the parked damage) or decline (apply it in full).", (p, raw) => operations.reactionAnswer(p, raw)],
    ["reaction.dismiss", "Dismiss a pending reaction prompt without applying its damage (GM).", (p, raw) => operations.reactionDismiss(p, raw)],
    ["damage.resolve", "Apply or dismiss a player-hit damage proposal parked in proposal mode (GM).", (p, raw) => operations.damageResolve(p, raw)],
    ["effect.add", "Add a rules-engine effect to a combatant (GM).", (p, raw) => operations.effectAdd(p, raw)],
    ["effect.end", "End an effect (GM anyone; a player their claimed character), clearing linked conditions and firing its on-end grants.", (p, raw) => operations.effectEnd(p, raw)],
    ["death-save.roll", "Roll a death saving throw for a dying character (GM anyone; a player their claimed character).", (p, raw) => operations.deathSaveRoll(p, raw)],
    ["encounter.set-rules-mode", "Set the LIVE fight's rules-engine enforcement mode (strict, assisted, freeform) and, optionally, its per-family exceptions (GM).", (p, raw) => operations.encounterSetRulesMode(p, raw)],
    ["rules.set-policy", "Set the table's standing rules policy - the dial and per-family exceptions every new fight starts from (GM).", (p, raw) => operations.rulesSetPolicy(p, raw)],
    ["rules.ask", "Ask the GM to allow a blocked command; it re-runs first and is parked only if it still blocks (GM anyone; a player their own claimed character).", (p, raw) => operations.rulesAsk(p, raw)],
    ["rules.answer", "Allow (re-running the parked command with an override) or decline a parked rules question (GM).", (p, raw) => operations.rulesAnswer(p, raw)],
    ["table.set-staging-defaults", "Set the table's staging defaults: the token visibility a newly staged combatant starts at (GM).", (p, raw) => operations.tableSetStagingDefaults(p, raw)],
    ["table.set-party-visibility", "Set how much a player sees of another player's character: nothing, name and class, the full sheet, or the sheet plus live resources (GM).", (p, raw) => operations.tableSetPartyVisibility(p, raw)],
    ["encounter.set-player-damage-mode", "Set how a player's own hit reaches an enemy's HP: a GM-confirmed proposal or direct server-side apply (GM).", (p, raw) => operations.encounterSetPlayerDamageMode(p, raw)],
    ["encounter.set-player-initiative-mode", "Set whether player-rolled initiative begins turns immediately or waits for all players to roll (GM).", (p, raw) => operations.encounterSetPlayerInitiativeMode(p, raw)],
    ["encounter.set-health-display", "Set the table-wide default for how token health shows on the map: status badge, HP bar, or health ring, for the GM only or everyone (GM).", (p, raw) => operations.encounterSetHealthDisplay(p, raw)],
    ["actor.set-health-display", "Override one combatant's token health display, or clear it to follow the table default (GM).", (p, raw) => operations.actorSetHealthDisplay(p, raw)],
    ["encounter.set-environment", "Toggle the underwater environment: melee disadvantage unless piercing, ranged auto-miss beyond normal range, fire resistance for all (GM).", (p, raw) => operations.encounterSetEnvironment(p, raw)],
    ["actor.rechoose", "Re-make a pick a feature says may be re-made on a rest (Circle of the Land's land type on a Long Rest, Fiendish Resilience's damage type on either). Your own character; the GM anyone.", (p, raw) => operations.actorRechoose(p, raw)],
    ["actor.rest", "Take a rest on your own character (GM: anyone): short re-arms short-rest uses; long restores HP, hit dice, spell slots, prepared spells, limited uses, clears dying, and drops one Exhaustion level.", (p, raw) => operations.actorRest(p, raw)],
    ["actor.spend-hit-dice", "Spend Hit Point Dice to heal on a short rest (roll + Con modifier each, minimum 1).", (p, raw) => operations.actorSpendHitDice(p, raw)],
    ["character.set-slot", "Spend or restore a character's spell slots for one level (clamped to the sheet maximum).", (p, raw) => operations.characterSetSlot(p, raw)],
    ["character.set-prepared", "Prepare or un-prepare one of a character's known spells.", (p, raw) => operations.characterSetPrepared(p, raw)],
    ["character.set-inventory", "Add, update, or remove one of a character's inventory items.", (p, raw) => operations.characterSetInventory(p, raw)],
    ["character.set-currency", "Set a character's coin purse.", (p, raw) => operations.characterSetCurrency(p, raw)],
    ["character.set-identity", "Edit a character's identity (class/level/race/background/feats) on its imported sheet.", (p, raw) => operations.characterSetIdentity(p, raw)],
    ["character.set-proficiencies", "Edit a character's save and skill proficiency selections on its imported sheet.", (p, raw) => operations.characterSetProficiencies(p, raw)],
    ["character.create", "Create a character from choices (ids, scores, HP entries, the choices ledger); the server assembles and imports the sheet (GM). The actor's id equals the commandId.", (p, raw) => operations.characterCreate(p, raw)],
    ["character.generate", "Roll a complete, playable, single-class character at a level: the standard array by the class's stat priority and every other pick drawn server-side - the GM always, a player when builderPolicy.playerRandom is open (deny by default). The actor's id equals the commandId.", (p, raw) => operations.characterGenerate(p, raw)],
    ["builder.set-policy", "Set the character-builder policy: allowed ability-score methods and the GM's custom roll formula (GM).", (p, raw) => operations.builderSetPolicy(p, raw)],
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
    ["actor.set-token-image", "Set or clear a combatant's token image from the token library - the GM for anyone, a player for their own claimed character (D18).", (p, raw) => operations.actorSetTokenImage(p, raw)],
    ["actor.set-size", "Set a combatant's creature size; the token re-snaps to its footprint (GM).", (p, raw) => operations.actorSetSize(p, raw)],
    ["actor.set-visibility", "Move a combatant between the shared layer and the GM-only layer (GM).", (p, raw) => operations.actorSetVisibility(p, raw)],
    ["actor.set-archived", "Archive or restore a character - archived characters are hidden from players, refused by claim, rejected by scene and encounter staging, and any claim is released on archive (GM).", (p, raw) => operations.actorSetArchived(p, raw)],
    ["actor.set-sheet-preview", "Share or hide an archived character's sheet as a read-only keepsake for players; hidden by default (GM).", (p, raw) => operations.actorSetSheetPreview(p, raw)],
    ["actor.set-speed", "Set a combatant's walking speed in feet (null clears to unknown, skipping movement rules) (GM).", (p, raw) => operations.actorSetSpeed(p, raw)],
    ["scene.create", "Prepare a staged scene on a battlemap without touching the live table, or go live on it in the same command (GM).", (p, raw) => operations.sceneCreate(p, raw)],
    ["scene.rename", "Rename a prepared scene (GM).", (p, raw) => operations.sceneRename(p, raw)],
    ["scene.remove", "Remove a prepared scene (GM).", (p, raw) => operations.sceneRemove(p, raw)],
    ["scene.activate", "Switch the live table to a prepared scene, parking the current one (GM).", (p, raw) => operations.sceneActivate(p, raw)],
    ["scene.set-combatants", "Replace a prepared scene's combatant list (GM).", (p, raw) => operations.sceneSetCombatants(p, raw)],
    ["scene.duplicate", "Duplicate a prepared scene as a new staged copy (GM).", (p, raw) => operations.sceneDuplicate(p, raw)],
    ["scene.reorder", "Reorder the prepared-scene list (GM).", (p, raw) => operations.sceneReorder(p, raw)],
    ["character.rebuild", "Rebuild one character at a new level (up or down) or respec it, re-running the whole build from the choice ledger - the GM for anyone, a player for their own claimed character when the table's builder is open (D13).", (p, raw) => operations.characterRebuild(p, raw)],
    ["builder.roll-abilities", "Roll six ability scores server-side for the character builder, recorded in the table feed (D14).", (p, raw) => operations.builderRollAbilities(p, raw)],
    ["replay.launch", "Launch one recorded moment of an archived fight onto the live table, parking the current scene; the moment's combatants are cloned under new ids so live characters are never rewritten (GM).", (p, raw) => operations.replayLaunch(p, raw)],
    ["fog.set-enabled", "Turn manual fog of war on/off for the live table or a prepared scene (GM).", (p, raw) => operations.fogSetEnabled(p, raw)],
    ["fog.paint", "Paint a reveal/hide fog rect, grid-snapped and clamped to the map (GM).", (p, raw) => operations.fogPaint(p, raw)],
    ["fog.reset", "Hide the whole map again (clear every fog stroke) (GM).", (p, raw) => operations.fogReset(p, raw)]
  ];
  return new Map<string, GameCommandDescriptor>(entries.map(([type, summary, run]) => [type, { type, scope: GAME_COMMAND_SCOPES[type], summary, run }]));
}
