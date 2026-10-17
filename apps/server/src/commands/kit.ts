import type {
  ActionResolution,
  ActionTableNarration,
  CombatLogEntry,
  GameState,
  GmView,
  PlayerView,
  RollRecord,
  SoundBoard,
  SoundBoardView,
  TableEvent
} from "@vtt/domain";
import { d20Die } from "@vtt/rules-5e";
import { storedDefinition } from "../actor-roster.js";
import type { CharacterDraftStore } from "../character-drafts.js";
import type { Initiator } from "../authorization.js";
import type { CombatLogStore } from "../combat-log.js";
import type { TimelineOutcome } from "../combat-history.js";
import type { ContentLibrary } from "../content-library.js";
import type { EffectNarration } from "../effects.js";
import type { InitiativeRollDeps, InitiativeRollSink } from "../encounter.js";
import { equipmentCatalogOf } from "../equipment-derivation.js";
import type { GameStore } from "../game-store.js";
import type { SoundDeps } from "../sound-board.js";
import { tokenCreatureDistance } from "../movement-narration.js";
import { withoutSourceName } from "../projections.js";
import { describeRoll, recordRoll, rollFeedIsGmOnly, rollsForCommand } from "../roll-history.js";
import type { TokenMapGeometry } from "../token-placement.js";
import { partySight, playerSight } from "../vision/audience.js";
import type { SightContent } from "../vision/senses.js";

/** Who is acting. Integration credentials are the GM's own automation and act with GM authority
 *  (ADR-0016); players keep player limits. The public viewer never reaches a command. */
export type GamePrincipal =
  | Readonly<{ kind: "gm"; sessionId: string }>
  | Readonly<{ kind: "player"; sessionId: string }>
  | Readonly<{ kind: "integration"; credentialId: string; name: string }>;

export function isGmGrade(
  principal: GamePrincipal
): principal is Exclude<GamePrincipal, Readonly<{ kind: "player"; sessionId: string }>> {
  return principal.kind !== "player";
}

/** The principal as authorization reads it: GM-grade acts on anyone, a player on their own claimed actor. */
export function initiatorOf(principal: GamePrincipal): Initiator {
  return isGmGrade(principal) ? { role: "gm" } : { role: "player", sessionId: principal.sessionId };
}

/** A stable UUID identity for ownership fields (annotation owners, roll initiators). Credential ids are UUIDs too. */
export function sessionIdOf(principal: GamePrincipal): string {
  return principal.kind === "integration" ? principal.credentialId : principal.sessionId;
}

/** Journal attribution tag. */
export function principalTag(principal: GamePrincipal): string {
  switch (principal.kind) {
    case "gm":
      return `gm:${principal.sessionId}`;
    case "player":
      return `player:${principal.sessionId}`;
    case "integration":
      return `integration:${principal.credentialId}`;
  }
}

/** "Who rolled this" for a GM-grade principal: the GM, or the integration's credential name. */
export function gmGradeLabelOf(principal: GamePrincipal): string {
  return principal.kind === "integration" ? principal.name : "GM";
}

/** What the commands need from the server around them. */
export type CommandContext = Readonly<{
  store: GameStore;
  /** The committed state for reads: frozen, and cloned once per revision rather than per read. */
  readState: () => GameState;
  combatLog: Pick<CombatLogStore, "list" | "exportSince">;
  contentLibrary: ContentLibrary;
  mapCatalog: Readonly<{ get: (assetId: string) => { kind: string } | undefined | null }>;
  tokenCatalog: Readonly<{
    get: (assetId: string) => unknown;
    touchLastUsed: (assetId: string) => void;
    rememberForDefinition: (definitionId: string, assetId: string) => void;
  }>;
  /** The builder's parked drafts, kept outside the game state (see `character-drafts.ts`). */
  characterDrafts: Pick<CharacterDraftStore, "get" | "save" | "discard">;
  tokenGeometryFor: (mapAssetId: string) => Promise<TokenMapGeometry>;
  publishGameState: (state: GameState) => Promise<void>;
  /** Presents a newly-live scene's map on the shared screen; best-effort, a viewer failure must not undo the switch. */
  presentSceneMap: (mapAssetId: string) => Promise<void>;
  /** Fires a transient toast, also written to the feed unless `logged: false` (a richer row is written). */
  broadcastTableEvent: (
    event: Readonly<{
      kind: TableEvent["kind"];
      text: string;
      actorIds?: readonly string[];
      gmOnly?: boolean;
      logged?: boolean;
    }>
  ) => void;
  /** Appends a feed line; `actorId` attributes it, and a `roll` row's own visibility decides who receives it. */
  appendLog: (
    entry: Readonly<{
      kind: CombatLogEntry["kind"];
      text: string;
      actorIds?: readonly string[];
      gmOnly?: boolean;
      actorId?: string | null;
      roll?: RollRecord | null;
    }>
  ) => void;
  logTurnBegin: (state: GameState) => void;
  logTimelineOutcome: (outcome: TimelineOutcome, state: GameState) => void;
  scheduleAnnotationExpiry: () => void;
  gmView: (state: GameState) => GmView;
  playerView: (state: GameState, playerSessionId: string | undefined) => PlayerView;
  /** Uniform die: an integer in [1, sides]. */
  random: (sides: number) => number;
  newId: () => string;
  /** Best-effort hook after an encounter is archived, for the codex's combat history. Must swallow its own errors. */
  onEncounterArchived?: (
    info: Readonly<{ mapAssetId: string | null; sceneId: string | null; turnCount: number }>
  ) => void;
  /** Reads one stored archive document (raw JSON) for `replay.launch`; without it replays can't launch. */
  archiveDocument?: (id: number) => string | null;
  /** The sound board, kept in its own store (ADR-0024); without it the sound commands refuse. */
  sound?: SoundPort;
}>;

/** What the sound commands need from the sound board service (`sound-service.ts`). */
export type SoundPort = Readonly<{
  run: (
    commandId: string,
    change: (board: SoundBoard, deps: SoundDeps) => void
  ) => Promise<Readonly<{ soundRevision: number; duplicate: boolean }>>;
  durationOf: (assetId: string) => number | null;
  view: () => SoundBoardView;
  /** Starts a scene's saved sound when it goes live, unless the GM turned that off. Best-effort. */
  sceneWentLive: (sceneId: string, sourceRevision: number) => Promise<void>;
}>;

export type Kit = ReturnType<typeof createKit>;

/** The helpers every command area shares, bound to one server's context. */
export function createKit(context: CommandContext) {
  const { store, contentLibrary } = context;
  const read = context.readState;
  const actorName = (actorId: string) => read().actors.find((actor) => actor.id === actorId)?.name ?? "A combatant";
  /** What dynamic vision reads from the content: stat blocks, and the catalog with species senses and lit items. */
  const sightContent = (): SightContent => ({
    definition: (definitionId) => contentLibrary.monsterForInstance(definitionId),
    catalog: equipmentCatalogOf(contentLibrary.forAudience("gm"))
  });
  /** The creatures hidden from this initiator by sight or the fog, which it may not target; none for the GM. */
  const unseenBy = (initiator: Initiator, state: GameState): ReadonlySet<string> =>
    initiator.role === "gm" ? new Set() : playerSight(state, initiator.sessionId, sightContent()).hidden;
  /** Hidden from the table: GM-only, or a creature no character perceives (dynamic vision) or wholly under the fog. */
  const actorHidden = (actorId: string) => {
    const state = read();
    return (
      state.actors.find((actor) => actor.id === actorId)?.visibility === "gm-only" ||
      partySight(state, sightContent()).hidden.has(actorId)
    );
  };

  /** Play-time definition lookup: imported stat blocks first; `monsterForInstance` ignores homebrew status so
   *  a soft-deleted creature's live tokens keep working. */
  const resolveDefinitionIn = (state: GameState, definitionId: string) =>
    storedDefinition(state, definitionId) ?? contentLibrary.monsterForInstance(definitionId);

  /** Drains a resolution's `tableNarration` into the feed (the one writer, for every resolve path).
   *  `appendLog` re-derives visibility from live state; the resolver's `gmOnly` only adds to it. */
  const appendTableNarration = (resolution: Readonly<{ tableNarration?: readonly ActionTableNarration[] }>) => {
    for (const line of resolution.tableNarration ?? []) {
      context.appendLog({
        kind: line.kind,
        text: line.text,
        actorIds: line.actorIds,
        ...(line.gmOnly === true ? { gmOnly: true } : {})
      });
    }
  };

  // Player character-creation abuse guards, in-memory (a restart forgives).
  const CREATES_PER_DAY = 5;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const creates = new Map<string, number[]>();

  return {
    context,
    store,
    contentLibrary,
    read,
    actorName,
    actorHidden,
    unseenBy,
    resolveDefinitionIn,
    sightContent,
    /** The same lookup against the committed state, for reads outside a command transaction. */
    resolveDefinition: (definitionId: string) => resolveDefinitionIn(read(), definitionId),
    /** The catalog a principal may read: GM-grade sees everything, a player only player-visible records. */
    catalogFor: (principal: GamePrincipal) => contentLibrary.forAudience(isGmGrade(principal) ? "gm" : "player"),
    /** Play-time item catalog (riders live here, never on the inventory row). GM audience so a player can
     *  still roll their own GM-authored item; browsing is gated on the catalog reads. */
    equipmentCatalog: () => equipmentCatalogOf(contentLibrary.forAudience("gm")),

    /** False once a player session has created its daily share of characters. */
    withinCreateCap(sessionId: string): boolean {
      const now = Date.now();
      const recent = (creates.get(sessionId) ?? []).filter((at) => now - at < DAY_MS);
      if (recent.length >= CREATES_PER_DAY) {
        creates.set(sessionId, recent);
        return false;
      }
      creates.set(sessionId, [...recent, now]);
      return true;
    },

    /** What an initiative roll reads about its roller in `state`: stat blocks and items for its riders. */
    initiativeRollDeps: (state: GameState): InitiativeRollDeps => ({
      resolveDefinition: (definitionId) => resolveDefinitionIn(state, definitionId),
      catalog: equipmentCatalogOf(contentLibrary.forAudience("gm"))
    }),

    /** Server-thrown initiative dice land in `state.rolls` attributed to the combatant; hidden ones are GM-only. */
    initiativeRollSink:
      (state: GameState, commandId: string, principal: GamePrincipal): InitiativeRollSink =>
      (roll) => {
        const actor = state.actors.find((candidate) => candidate.id === roll.actorId);
        const formula = d20Die(roll.mode);
        const gmGrade = isGmGrade(principal);
        recordRoll(state, {
          id: context.newId(),
          commandId,
          initiatorSessionId: sessionIdOf(principal),
          initiatorRole: gmGrade ? "gm" : "player",
          initiatorLabel: actor?.name ?? (gmGrade ? gmGradeLabelOf(principal) : "A player"),
          label: "Initiative",
          actorId: roll.actorId,
          purpose: "check",
          visibility: actor?.visibility === "gm-only" ? "gm-only" : "public",
          formula,
          normalizedFormula: formula,
          dice: [{ group: 0, sides: 20, face: roll.natural, kept: true, sign: 1 }],
          modifiers: roll.modifier === 0 ? [] : [{ value: Math.abs(roll.modifier), sign: roll.modifier < 0 ? -1 : 1 }],
          total: roll.total,
          createdAt: new Date().toISOString()
        });
      },

    /** Each committed roll becomes a feed row; skipped for duplicates, which never re-rolled. */
    publishRolls(state: GameState, commandId: string) {
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
    },

    /** Creature-to-creature distance on the active map, for rules a mutation checks (a strike-back reaction's
     *  range). The grid lookup is async, so it is fetched before the mutation runs. */
    async creatureDistance(): Promise<(state: GameState, actorIdA: string, actorIdB: string) => number | null> {
      const mapAssetId = read().combat.mapAssetId;
      const geometry = mapAssetId ? await context.tokenGeometryFor(mapAssetId) : null;
      return (state, actorIdA, actorIdB) =>
        geometry && state.combat.mapAssetId === mapAssetId
          ? (tokenCreatureDistance(state, geometry, actorIdA, actorIdB)?.value ?? null)
          : null;
    },

    /** A rule the table advises rather than enforces, let through: a note for the GM alone. */
    logRulesNotes(notes: readonly string[], actorId: string | null) {
      for (const note of notes)
        context.appendLog({
          kind: "action",
          text: `Rules note: ${note}`,
          actorIds: actorId === null ? [] : [actorId],
          gmOnly: true
        });
    },

    /** Shared narration fan-out for engine transitions (effect ends, dying, consciousness). */
    publishNarrations(events: readonly EffectNarration[]) {
      for (const event of events) {
        // A line naming a hidden cause reaches the table with that name masked, as the projection masks it.
        const masked =
          event.source && actorHidden(event.source.actorId) && !actorHidden(event.actorId)
            ? withoutSourceName(event.text, event.source.name ?? actorName(event.source.actorId))
            : event.text;
        context.broadcastTableEvent({
          kind: event.kind,
          text: masked,
          actorIds: [event.actorId],
          gmOnly: event.gmOnly === true || actorHidden(event.actorId)
        });
      }
    },

    appendTableNarration,

    /** What a committed resolve did, for the feed: GM-only rules notes, the table's narration, effects applied, granted
     *  and ended, and the reaction windows it opened. `actorId` acted; when hidden, its lines stay with the GM. */
    narrateResolution(resolution: ActionResolution, actorId: string) {
      const hidden = actorHidden(actorId);
      for (const warning of resolution.warnings ?? [])
        context.appendLog({ kind: "action", text: `Rules note: ${warning}`, actorIds: [actorId], gmOnly: true });
      appendTableNarration(resolution);
      for (const applied of resolution.effectsApplied ?? [])
        context.broadcastTableEvent({
          kind: "effect",
          text: `${applied.targetName} is ${applied.name}.`,
          actorIds: [applied.targetId],
          gmOnly: hidden
        });
      if (resolution.effectGranted)
        context.broadcastTableEvent({
          kind: "effect",
          text: `${actorName(actorId)} gains ${resolution.effectGranted.name}.`,
          actorIds: [actorId],
          gmOnly: hidden
        });
      // A reaction window opened: the table hears why nothing landed yet.
      const waiting = resolution.waitingOnReaction ? "the attack waits" : "the damage waits";
      for (const prompt of resolution.reactionPrompts ?? []) {
        const promptHidden = hidden || actorHidden(prompt.actorId);
        context.appendLog({
          kind: "reaction",
          text: `${prompt.actorName} may use ${prompt.actionName} - ${waiting} on their answer.`,
          actorIds: [prompt.actorId],
          gmOnly: promptHidden
        });
        context.broadcastTableEvent({
          kind: "reaction",
          text: `${prompt.actorName} may use ${prompt.actionName}.`,
          actorIds: [prompt.actorId],
          gmOnly: promptHidden
        });
      }
      for (const ended of resolution.effectsEnded ?? [])
        context.broadcastTableEvent({
          kind: "effect",
          text: `${ended.name} ended on ${ended.actorName}.`,
          actorIds: [ended.actorId],
          gmOnly: hidden || actorHidden(ended.actorId)
        });
    }
  };
}
