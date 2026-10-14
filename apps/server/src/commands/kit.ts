import type {
  ActionTableNarration,
  CombatLogEntry,
  GameState,
  GmView,
  PlayerView,
  RollRecord,
  TableEvent
} from "@vtt/domain";
import type { rollDice } from "@vtt/rules-5e";
import { storedDefinition } from "../actor-roster.js";
import type { Initiator } from "../authorization.js";
import type { CombatLogStore } from "../combat-log.js";
import type { TimelineOutcome } from "../combat-history.js";
import type { ContentLibrary } from "../content-library.js";
import type { EffectNarration } from "../effects.js";
import type { InitiativeRollSink } from "../encounter.js";
import { equipmentCatalogOf } from "../equipment-derivation.js";
import type { GameStore } from "../game-store.js";
import { describeRoll, recordRoll, rollFeedIsGmOnly, rollsForCommand } from "../roll-history.js";
import type { TokenMapGeometry } from "../token-placement.js";

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
  combatLog: Pick<CombatLogStore, "list" | "exportSince">;
  contentLibrary: ContentLibrary;
  mapCatalog: Readonly<{ get: (assetId: string) => { kind: string } | undefined | null }>;
  tokenCatalog: Readonly<{
    get: (assetId: string) => unknown;
    touchLastUsed: (assetId: string) => void;
    rememberForDefinition: (definitionId: string, assetId: string) => void;
  }>;
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
}>;

export type Kit = ReturnType<typeof createKit>;

/** The helpers every command area shares, bound to one server's context. */
export function createKit(context: CommandContext) {
  const { store, contentLibrary } = context;
  const read = () => store.snapshot;
  const actorName = (actorId: string) => read().actors.find((actor) => actor.id === actorId)?.name ?? "A combatant";
  const actorHidden = (actorId: string) =>
    read().actors.find((actor) => actor.id === actorId)?.visibility === "gm-only";

  /** Play-time definition lookup: imported stat blocks first; `monsterForInstance` ignores homebrew status so
   *  a soft-deleted creature's live tokens keep working. */
  const resolveDefinitionIn = (state: GameState, definitionId: string) =>
    storedDefinition(state, definitionId) ?? contentLibrary.monsterForInstance(definitionId);

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
    resolveDefinitionIn,
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

    /** Server-thrown initiative dice land in `state.rolls` attributed to the combatant; hidden ones are GM-only. */
    initiativeRollSink:
      (state: GameState, commandId: string, principal: GamePrincipal): InitiativeRollSink =>
      (roll) => {
        const actor = state.actors.find((candidate) => candidate.id === roll.actorId);
        const formula = roll.mode === "advantage" ? "2d20kh1" : roll.mode === "disadvantage" ? "2d20kl1" : "1d20";
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

    /** Shared narration fan-out for engine transitions (effect ends, dying, consciousness). */
    publishNarrations(events: readonly EffectNarration[]) {
      for (const event of events) {
        context.broadcastTableEvent({
          kind: event.kind,
          text: event.text,
          actorIds: [event.actorId],
          gmOnly: actorHidden(event.actorId)
        });
      }
    },

    /** Drains a resolution's `tableNarration` into the feed (the one writer, for both resolve paths).
     *  `appendLog` re-derives visibility from live state; the resolver's `gmOnly` only adds to it. */
    appendTableNarration(resolution: Readonly<{ tableNarration?: readonly ActionTableNarration[] }>) {
      for (const line of resolution.tableNarration ?? []) {
        context.appendLog({
          kind: line.kind,
          text: line.text,
          actorIds: line.actorIds,
          ...(line.gmOnly === true ? { gmOnly: true } : {})
        });
      }
    }
  };
}

/** A resolved formula's dice and flat modifiers, as a roll record stores them. */
export function rolledTerms(resolution: ReturnType<typeof rollDice>): Pick<RollRecord, "dice" | "modifiers"> {
  let group = 0;
  return {
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
      .map((term) => ({ value: term.value, sign: term.sign }))
  };
}
