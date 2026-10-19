import { createServer as createHttpServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import express, { type Express } from "express";
import { Server, type Socket } from "socket.io";
import { CODEX_PATHS, HOST_NAMESPACE } from "@vtt/api-contract";
import type {
  ClientToServerEvents,
  ClientRole,
  CombatLogEntry,
  GameState,
  RollRecord,
  ServerToClientEvents,
  TableEvent
} from "@vtt/domain";
import { ACTOR_DEFINITION_SCHEMA_VERSION } from "@vtt/schemas";
import { nextAnnotationExpiry } from "./annotations.js";
import { fillMissingSpeeds, fillStoredProseFacts, reconcileArmorClasses, storedDefinition } from "./actor-roster.js";
import { createApiV1Router } from "./api-v1.js";
import { AudioAssetStore } from "./audio-assets.js";
import { ContentLibrary, type ContentReader } from "./content-library.js";
import { equipmentCatalogOf } from "./equipment-derivation.js";
import { reconcileMagicMarkers } from "./inventory.js";
import { refreshBuiltSheets, refreshIsDue, type SheetRefresh } from "./sheet-refresh.js";
import { AuthService } from "./auth.js";
import { developmentClientUrl } from "./client-hosting.js";
import { CombatLogStore, projectFeedRow } from "./combat-log.js";
import { timelineDirtied, type TimelineOutcome } from "./combat-history.js";
import { createGameApiRouter } from "./game-http.js";
import {
  createGameCommands,
  failureReply,
  NOT_JOINED_REPLY,
  SESSION_ENDED_REPLY,
  socketEventOf,
  type GamePrincipal
} from "./commands/index.js";
import { CommandRejectedError, GameStore } from "./game-store.js";
import { CodexStore } from "./codex-store.js";
import { createCodexImportGuard, createCodexRouter } from "./codex-http.js";
import { PlayerCodexChanges, readerKey, readerOf } from "./codex/player-reads.js";
import { EVERYONE, type CodexReader } from "./codex-projections.js";
import { HomebrewStore } from "./homebrew-store.js";
import { createHomebrewRouter, homebrewPackBodyParser, HOMEBREW_PACK_IMPORT_PATH } from "./homebrew-http.js";
import { createHomebrewValidator, scenarioCatalogs } from "./homebrew-validate.js";
import { buildHomebrewUsageIndex } from "./homebrew-usages.js";
import { findCatalogRecord } from "./homebrew-srd-copy.js";
import { requestConventions, sendFailure } from "./http-kit.js";
import { createInitialGameState } from "./initial-game-state.js";
import { createStateReader } from "./state-reader.js";
import { IntegrationCredentialStore } from "./integration-credentials.js";
import { LoginRateLimiter } from "./login-rate-limit.js";
import { createHostRouter } from "./host-http.js";
import { MapAssetStore } from "./map-assets.js";
import { MapCatalogStore } from "./map-catalog.js";
import { createMapRouter } from "./map-http.js";
import { TokenCatalogStore } from "./token-catalog.js";
import { createTokenRouter } from "./token-http.js";
import { PresenceRegistry } from "./presence.js";
import { projectGmView, projectPlayerView } from "./projections.js";
import { callerOfToken, type CredentialVerifiers } from "./request-auth.js";
import { playerReplayMapAssetIds } from "./replay-projection.js";
import type { EncounterArchiveDocument } from "./encounter-archive.js";
import type { TokenMapGeometry } from "./token-placement.js";
import { ViewerAccessStore } from "./viewer-access.js";
import { ViewerCoordinator } from "./viewer-coordinator.js";
import { createViewerRouter } from "./viewer-http.js";
import { projectViewerEncounter } from "./viewer-encounter.js";
import { ViewerPresentationStore } from "./viewer-presentation-store.js";
import { SoundCatalogStore } from "./sound-catalog.js";
import { createSoundRouter } from "./sound-http.js";
import { SoundService } from "./sound-service.js";
import { SoundStore } from "./sound-store.js";
import { CharacterDraftStore } from "./character-drafts.js";
import { turnReminder } from "./turn-reminder.js";
import { hiddenFrom, hideRollsOfHidden, rememberExplored } from "./vision/audience.js";
import { stampSceneChanges } from "./scenes.js";
import type { SightContent } from "./vision/senses.js";

export type CreateServerOptions = {
  authPath: string;
  databasePath: string;
  /** Separate SQLite file for integration credentials/audit, distinct from the game-state database. */
  integrationCredentialsPath: string;
  mapAssetsPath?: string;
  tokenAssetsPath?: string;
  soundAssetsPath?: string;
  webDist: string;
  useDevelopmentClient: boolean;
  developmentClientPort: number;
  clientOrigin?: string;
  initialGameState?: GameState;
  applicationVersion?: string;
  /** Browser origins that a GM can copy to a separate LAN display. */
  viewerBaseUrls?: readonly string[];
  /** Where the first GM password is set, said to a request from anywhere but loopback. */
  gmSetupHint?: string;
  /** How long a session stays "reconnecting" after its last connection drops before going "offline". */
  presenceGraceMs?: number;
  /** How often connected sockets are re-checked for a session that ran out. */
  sessionSweepMs?: number;
  /** How long after a GM password change the other GM devices are told their session ended. */
  passwordChangeGraceMs?: number;
};

const isLoopback = (ip: string | undefined) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
const isApiV1 = (path: string) => path === "/api/v1" || path.startsWith("/api/v1/");
const isHostRoute = (path: string) => path === HOST_NAMESPACE || path.startsWith(`${HOST_NAMESPACE}/`);

export function createServer(options: CreateServerOptions) {
  const app: Express = express();
  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: options.clientOrigin ? { origin: options.clientOrigin } : undefined
  });
  const auth = new AuthService(options.authPath);
  // Late-bound: the content library is built below, and the store only calls this from a command.
  let sightContent: () => SightContent = () => ({});
  const store = new GameStore(options.databasePath, options.initialGameState ?? createInitialGameState(), {
    timelineDirtied,
    // What the party sees joins what it has seen, in the same transaction as the move or door that showed it. A
    // failure here must not undo the command; the next one catches up.
    afterMutate: (state, before) => {
      try {
        rememberExplored(state, sightContent());
      } catch (error) {
        console.error("remembering what the party saw failed:", error instanceof Error ? error.message : error);
      }
      try {
        hideRollsOfHidden(state, before, sightContent());
      } catch (error) {
        console.error("hiding a hidden creature's rolls failed:", error instanceof Error ? error.message : error);
      }
      stampSceneChanges(state, before);
    }
  });
  // Every read of the game state outside a command's own transaction goes through here.
  const committedState = createStateReader(store);
  const combatLog = new CombatLogStore(options.databasePath);
  const credentials = new IntegrationCredentialStore(options.integrationCredentialsPath);
  const mapAssets = new MapAssetStore(options.mapAssetsPath ?? join(dirname(options.databasePath), "map-assets"));
  const mapCatalog = new MapCatalogStore(options.databasePath);
  const tokenAssets = new MapAssetStore(
    options.tokenAssetsPath ?? join(dirname(options.databasePath), "token-assets"),
    { maxBytes: 5 * 1024 * 1024, maxDimensionPx: 2048, maxPixels: 2048 * 2048 }
  );
  const tokenCatalog = new TokenCatalogStore(options.databasePath);
  const viewerAccess = new ViewerAccessStore(options.databasePath);
  const viewerPresentation = new ViewerPresentationStore(options.databasePath);
  const characterDrafts = new CharacterDraftStore(options.databasePath);
  const codexStore = new CodexStore(options.databasePath);
  const codexAssets = new MapAssetStore(join(dirname(options.databasePath), "codex-assets"), {
    maxBytes: 10 * 1024 * 1024,
    maxDimensionPx: 4096,
    maxPixels: 4096 * 4096
  });
  const homebrewStore = new HomebrewStore(options.databasePath);
  // `publishedFor(audience)` gives `ContentLibrary` only published records, and for a reader only those shown to
  // everyone or to one of its characters in packs that are on; drafts are in no slice.
  const contentLibrary = new ContentLibrary(homebrewStore);
  sightContent = () => ({
    definition: (definitionId) => contentLibrary.monsterForInstance(definitionId),
    catalog: equipmentCatalogOf(contentLibrary.forAudience("play"))
  });
  const authorizeGm = (token: string | undefined) => auth.verify(token) !== null;
  /** Every credential the server accepts, checked one way for every HTTP route and the socket (ADR-0027). */
  const verifiers = {
    gm: (token) => auth.verify(token),
    player: (token) => auth.verifyPlayer(token),
    integration: (token, scope) => {
      const checked = credentials.check(token, scope);
      return checked && { id: checked.credential.id, name: checked.credential.name, inScope: checked.inScope };
    },
    viewer: (token) => {
      try {
        viewerAccess.verify(token);
        return true;
      } catch {
        return false;
      }
    }
  } satisfies Required<CredentialVerifiers>;
  // Shared by `createCodexRouter` and the `POST /codex/import` guard so "who may write the codex" has one
  // definition. A codex credential acts at GM grade; scope decides read vs write, and `admin` implies both.
  const codexAuth = { verifiers };
  const viewerCoordinator = new ViewerCoordinator(viewerAccess, viewerPresentation, authorizeGm);
  // The table's sound (ADR-0024): the GM's library of files and the board, each in its own store. The board's
  // output reaches table screens through the viewer feed and the GM's devices as `sound:changed`; players get none.
  const soundAssets = new AudioAssetStore(
    options.soundAssetsPath ?? join(dirname(options.databasePath), "sound-assets")
  );
  const soundCatalog = new SoundCatalogStore(options.databasePath);
  const soundStore = new SoundStore(options.databasePath);
  const sound = new SoundService({
    store: soundStore,
    assets: soundAssets,
    catalog: soundCatalog,
    screens: () => viewerCoordinator.soundScreens(),
    changed: () => {
      viewerCoordinator.broadcast();
      pushSoundToGm();
    }
  });
  viewerCoordinator.attachSound(
    (now) => sound.viewerSound(now),
    () => pushSoundToGm()
  );
  const gmLoginRateLimiter = new LoginRateLimiter();
  const presence = new PresenceRegistry(options.presenceGraceMs ?? 8000, () => broadcast());
  const presenceFor = (sessionId: string) => presence.statusFor(sessionId);
  const annotationExpiryTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Re-publishes at the soonest annotation expiry: the projection hides expired annotations, but nothing
   *  else re-broadcasts once the timestamp passes. Re-publishing also clears it from the shared screen. */
  function scheduleAnnotationExpiry() {
    // One pending timer, re-armed from the callback so staggered annotations each expire on time.
    for (const timer of annotationExpiryTimers) clearTimeout(timer);
    annotationExpiryTimers.clear();
    const soonest = nextAnnotationExpiry(committedState.read(), Date.now());
    if (soonest === null) return;
    const timer = setTimeout(
      () => {
        annotationExpiryTimers.delete(timer);
        void publishGameState(committedState.read());
        scheduleAnnotationExpiry();
      },
      Math.max(0, soonest - Date.now())
    );
    timer.unref?.();
    annotationExpiryTimers.add(timer);
  }

  /** GM view plus the time-travel timeline (labels can name hidden combatants, so this is GM-only). */
  function gmView(state: GameState, now = Date.now()) {
    return { ...projectGmView(state, presenceFor, now), turnHistory: store.listTurnSnapshots() };
  }
  /** Tells a socket its session ended (revoked or expired) and drops it, so the client signs in again. */
  function endSession(socket: Socket<ClientToServerEvents, ServerToClientEvents>) {
    socket.emit("session:ended");
    socket.disconnect(true);
  }
  /**
   * Also reauthorizes every connected socket, so a revoked GM client is told and disconnected promptly, and pings a
   * player socket's Codex when a claim changed what it can read there.
   */
  function broadcast() {
    const current = committedState.read();
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      const gm = auth.verify(token);
      const player = auth.verifyPlayer(token);
      if (token && !gm && !player) {
        endSession(socket);
        continue;
      }
      socket.emit(
        "state:updated",
        gm ? gmView(current) : projectPlayerView(current, player?.sessionId, presenceFor, Date.now(), sightContent())
      );
      if (!gm) {
        followCodexReader(socket);
        // A claim or a release changes which homebrew the socket receives.
        try {
          followHomebrewReader(socket);
        } catch (error) {
          console.error("checking a player's homebrew failed:", error instanceof Error ? error.message : error);
        }
      }
    }
  }
  /** The player characters a session has claimed: what it reads in the Codex beyond what everyone reads. */
  function claimedCharacters(sessionId: string): string[] {
    return committedState
      .read()
      .actors.filter((actor) => actor.kind === "player-character" && actor.ownerSessionId === sessionId)
      .map((actor) => actor.id);
  }
  /** The party's player characters: the only ids a Codex audience may name. */
  function partyCharacters(): ReadonlySet<string> {
    return new Set(
      committedState
        .read()
        .actors.filter((actor) => actor.kind === "player-character" && actor.replaySceneId === undefined)
        .map((actor) => actor.id)
    );
  }
  /** Who a socket's Codex pings are for: its player's claimed characters, or the ones a preview names. */
  function codexReaderOf(socket: Socket<ClientToServerEvents, ServerToClientEvents>): CodexReader {
    const player = auth.verifyPlayer(socket.handshake.auth?.token);
    if (!player) return EVERYONE;
    return readerOf(player.preview ? player.preview.characterIds : claimedCharacters(player.sessionId));
  }
  /** Each player socket's reader as its last ping counted it. */
  const codexReaders = new WeakMap<Socket<ClientToServerEvents, ServerToClientEvents>, string>();
  /**
   * Keeps a player socket's Codex reader current. A claim or a release changes what the socket can read, so it is
   * pinged with its new reader's count; the first sight of a socket only starts counting for it.
   */
  function followCodexReader(socket: Socket<ClientToServerEvents, ServerToClientEvents>) {
    if (!playerCodexChanges) return;
    const reader = codexReaderOf(socket);
    const key = readerKey(reader);
    const known = codexReaders.get(socket);
    if (known === key) return;
    codexReaders.set(socket, key);
    try {
      const count = playerCodexChanges.watch(reader);
      if (known !== undefined) socket.emit("codex:changed", { codexRevision: count });
    } catch (error) {
      console.error("checking a player's codex failed:", error instanceof Error ? error.message : error);
    }
  }
  /** A session that runs out ends with no state change to notice it, so every socket is re-checked on a timer. */
  const sessionSweep = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (token && !auth.verify(token) && !auth.verifyPlayer(token)) endSession(socket);
    }
  }, options.sessionSweepMs ?? 30_000);
  sessionSweep.unref?.();
  /** Sends the sound board to the GM's devices; a player's socket is never sent it. */
  function pushSoundToGm() {
    const view = sound.view();
    for (const socket of io.sockets.sockets.values())
      if (auth.verify(socket.handshake.auth?.token)) socket.emit("sound:changed", view);
  }
  /** Set once the Codex store is open; counts the changes each audience of players can read. */
  let playerCodexChanges: PlayerCodexChanges | undefined;
  /** The players' check waiting to run, so writes in one tick share it. */
  let playerCodexCheck: NodeJS.Immediate | undefined;
  /**
   * Tells clients the codex changed so each refetches its own projected view. Content-free (only a revision):
   * naming the changed scope would leak what the GM is working on. The GM's devices hear of every write. A
   * player's device hears only of a change it can read, with a count of its own audience's changes alone, since a
   * ping on a GM-only write would tell the table when the GM is writing secrets, and one on a reveal to Lyra would
   * tell Borin's player. That check reads each audience's whole Codex, so it runs after the write has answered.
   */
  function notifyCodexChanged() {
    for (const socket of io.sockets.sockets.values())
      if (auth.verify(socket.handshake.auth?.token))
        socket.emit("codex:changed", { codexRevision: codexStore.revision });
    playerCodexCheck ??= setImmediate(() => {
      playerCodexCheck = undefined;
      const readers = [...io.sockets.sockets.values()]
        .filter((socket) => !auth.verify(socket.handshake.auth?.token))
        .map((socket) => [socket, codexReaderOf(socket)] as const);
      let moved = new Map<string, number>();
      try {
        moved = playerCodexChanges?.next(readers.map(([, reader]) => reader)) ?? moved;
      } catch (error) {
        // Best-effort (the write already committed), but logged. With no answer, players are not pinged.
        console.error("checking the players' codex failed:", error instanceof Error ? error.message : error);
      }
      for (const [socket, reader] of readers) {
        const count = moved.get(readerKey(reader));
        if (count !== undefined) socket.emit("codex:changed", { codexRevision: count });
      }
    });
  }
  /** The characters whose homebrew a player socket receives: its session's claims, or the ones a preview names. */
  function homebrewReaderOf(socket: Socket<ClientToServerEvents, ServerToClientEvents>): ContentReader {
    const player = auth.verifyPlayer(socket.handshake.auth?.token);
    if (!player) return { characterIds: [] };
    return { characterIds: player.preview ? player.preview.characterIds : claimedCharacters(player.sessionId) };
  }
  /** What each player socket's last homebrew ping covered: the hash of the homebrew its reader receives, and the
   *  number it was last sent. */
  const homebrewSeen = new WeakMap<
    Socket<ClientToServerEvents, ServerToClientEvents>,
    { fingerprint: string; sent: number }
  >();
  /**
   * Pings a player socket when the homebrew its reader receives changed since the last check, and starts counting for
   * a socket seen for the first time. The number grows for that socket alone, so it says nothing about any other
   * reader's changes, and a reconnect never reuses one.
   */
  function followHomebrewReader(socket: Socket<ClientToServerEvents, ServerToClientEvents>) {
    const fingerprint = homebrewStore.fingerprintFor(homebrewReaderOf(socket));
    const seen = homebrewSeen.get(socket);
    if (!seen) {
      homebrewSeen.set(socket, { fingerprint, sent: Date.now() });
      return;
    }
    if (seen.fingerprint === fingerprint) return;
    const sent = Math.max(seen.sent + 1, Date.now());
    homebrewSeen.set(socket, { fingerprint, sent });
    socket.emit("homebrew:changed", { revision: sent });
  }
  /** The players' homebrew check waiting to run, so writes in one tick share it. */
  let playerHomebrewCheck: NodeJS.Immediate | undefined;
  /**
   * Tells clients the homebrew library changed so each refetches its own catalog. Content-free (only a revision).
   * The GM's devices hear of every write. A player's device hears only of a change to what its reader receives, so a
   * hidden record, a reveal to another character or a pack nobody receives anything from pings no player.
   */
  function notifyHomebrewChanged() {
    for (const socket of io.sockets.sockets.values())
      if (auth.verify(socket.handshake.auth?.token))
        socket.emit("homebrew:changed", { revision: homebrewStore.revision });
    playerHomebrewCheck ??= setImmediate(() => {
      playerHomebrewCheck = undefined;
      for (const socket of io.sockets.sockets.values()) {
        if (auth.verify(socket.handshake.auth?.token)) continue;
        try {
          followHomebrewReader(socket);
        } catch (error) {
          // Best-effort (the write already committed), but logged. With no answer, the player is not pinged.
          console.error("checking a player's homebrew failed:", error instanceof Error ? error.message : error);
        }
      }
    });
    // Best-effort (the homebrew write already committed), but logged.
    void reconcileContentDerived().catch((error: unknown) =>
      console.error("re-deriving armor classes failed:", error instanceof Error ? error.message : error)
    );
  }
  /** The play catalog's homebrew as the built sheets last saw it; a change rebuilds every one of them. */
  let sheetsSawHomebrew: string | undefined;
  /** Characters a homebrew change reached while they were in a fight, rebuilt once it ends. */
  const sheetsAwaitingRefresh = new Set<string>();
  /** The reason the GM was last told a character's sheet couldn't take the current content, so it is told once. */
  const refreshRefusalsTold = new Map<string, string>();
  /** Re-derives stored ACs once the content behind them changed (a homebrew write, a content upgrade at start), and
   *  fills prose facts on definitions imported before those fields existed. Built characters are rebuilt from their
   *  ledgers with the current content (`sheet-refresh.ts`). Skipped while the GM has rewound the fight, so a content
   *  edit doesn't dirty the timeline; the next change or restart catches up. */
  async function reconcileContentDerived() {
    const current = committedState.read();
    if (current.combat.historyCursor !== null) return;
    const play = contentLibrary.forAudience("play");
    const catalog = equipmentCatalogOf(play);
    const homebrew = homebrewStore.fingerprintFor("play");
    const everyone = sheetsSawHomebrew !== undefined && sheetsSawHomebrew !== homebrew;
    sheetsSawHomebrew = homebrew;
    const definitionsIn = (state: GameState) => (definitionId: string) =>
      storedDefinition(state, definitionId) ?? contentLibrary.monsterForInstance(definitionId);
    let refresh: SheetRefresh | undefined;
    const reconcile = (state: GameState) => {
      refresh = refreshBuiltSheets(
        state,
        { library: play, policy: state.builderPolicy, catalog },
        { everyone, also: sheetsAwaitingRefresh }
      );
      const refreshed = refresh.rebuilt.length + refresh.stamped.length > 0;
      const filled = fillStoredProseFacts(state);
      const sped = fillMissingSpeeds(state, definitionsIn(state));
      const marked = reconcileMagicMarkers(state, catalog);
      return reconcileArmorClasses(state, definitionsIn(state), catalog) || refreshed || filled || sped || marked;
    };
    // A dry run first, so an unchanged campaign takes no revision.
    if (reconcile(structuredClone(current))) {
      const { state } = await store.execute({ id: randomUUID(), type: "content.reconcile" }, (draft) => {
        reconcile(draft);
      });
      await publishGameState(state);
    }
    if (refresh) tellRefresh(refresh);
  }
  /** Notes which characters wait on a fight, and tells the GM what was rebuilt and what the content refused. */
  function tellRefresh(refresh: SheetRefresh) {
    for (const actorId of [...refresh.rebuilt, ...refresh.stamped]) {
      sheetsAwaitingRefresh.delete(actorId);
      refreshRefusalsTold.delete(actorId);
    }
    for (const actorId of refresh.waiting) sheetsAwaitingRefresh.add(actorId);
    if (refresh.rebuilt.length > 0)
      appendLog({
        kind: "encounter",
        text: `Rebuilt with the current rules, keeping hit points, spent uses and gear: ${refresh.rebuilt
          .map((actorId) => committedState.read().actors.find((actor) => actor.id === actorId)?.name ?? "a character")
          .join(", ")}.`,
        actorIds: refresh.rebuilt,
        gmOnly: true
      });
    for (const failure of refresh.failed) {
      sheetsAwaitingRefresh.delete(failure.actorId);
      if (refreshRefusalsTold.get(failure.actorId) === failure.reason) continue;
      refreshRefusalsTold.set(failure.actorId, failure.reason);
      appendLog({
        kind: "encounter",
        text: `${failure.name}'s sheet keeps its earlier rules. The current rules refuse its build: ${failure.reason} Rebuild ${failure.name} in the Level flow to take them.`,
        actorIds: [failure.actorId],
        gmOnly: true
      });
    }
  }
  /** Whether a character the content refresh left for later is out of its fight now. */
  function refreshWaits(state: GameState): boolean {
    if (state.combat.historyCursor !== null) return false;
    return refreshIsDue(state, { also: sheetsAwaitingRefresh, skip: new Set(refreshRefusalsTold.keys()) });
  }
  // Homebrew usage lookup, memoised for one microtask: the library list asks per row and building the
  // index walks the whole campaign. Gone before the next request, so never stale.
  let usageIndex: ReturnType<typeof buildHomebrewUsageIndex> | undefined;
  const homebrewUsagesFor = (type: Parameters<ReturnType<typeof buildHomebrewUsageIndex>["of"]>[0], id: string) => {
    if (!usageIndex) {
      usageIndex = buildHomebrewUsageIndex(committedState.read());
      queueMicrotask(() => {
        usageIndex = undefined;
      });
    }
    return usageIndex.of(type, id);
  };
  /** Emits a transient toast. Players receive it only when it isn't GM-only and every referenced actor is
   *  public. Not stored; the viewer gets nothing. */
  function broadcastTableEvent(
    event: Readonly<{
      kind: TableEvent["kind"];
      text: string;
      actorIds?: readonly string[];
      gmOnly?: boolean;
      logged?: boolean;
      playersOnly?: boolean;
    }>
  ) {
    const actorIds = event.actorIds ?? [];
    // The shared check: GM-only, or out of every character's sight or under the fog (ADR-0023).
    const hidden = hiddenFrom(committedState.read(), sightContent());
    const publicToPlayers = !event.gmOnly && !actorIds.some(hidden);
    const payload: TableEvent = { id: randomUUID(), kind: event.kind, text: event.text, actorIds, at: Date.now() };
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (auth.verify(token)) {
        if (event.playersOnly !== true) socket.emit("table:event", payload);
      } else if (publicToPlayers && auth.verifyPlayer(token)) socket.emit("table:event", payload);
    }
    // Every toast is also a feed line, gated the same way, unless the caller writes a richer row itself
    // (`logged: false`). Call `appendLog` directly only for lines with no toast.
    if (event.logged !== false) appendLog({ kind: event.kind, text: event.text, actorIds, gmOnly: event.gmOnly });
  }
  /** Appends a feed line and pushes it live, gated like toasts. An actor no longer on the roster counts as hidden, so
   *  the gate fails closed. */
  function appendLog(
    entry: Readonly<{
      kind: CombatLogEntry["kind"];
      text: string;
      actorIds?: readonly string[];
      gmOnly?: boolean;
      actorId?: string | null;
      roll?: RollRecord | null;
    }>
  ) {
    const current = committedState.read();
    const actorIds = entry.actorIds ?? [];
    const gmOnly = entry.gmOnly === true || actorIds.some(hiddenFrom(current, sightContent()));
    const row = combatLog.append({
      kind: entry.kind,
      text: entry.text,
      gmOnly,
      revision: current.revision,
      actorId: entry.actorId ?? null,
      roll: entry.roll ?? null
    });
    // Per-recipient delivery: a `self-only` roll belongs to one player, unlocked by their session id.
    // `projectFeedRow` decides and strips the roller's session id. The public viewer has no game socket.
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (auth.verify(token)) {
        socket.emit("log:entry", row.entry);
        continue;
      }
      const player = auth.verifyPlayer(token);
      if (!player) continue;
      const projected = projectFeedRow(row, { gm: false, sessionId: player.sessionId });
      if (projected) socket.emit("log:entry", projected);
    }
  }
  /** "Round 3 · Borin's turn.", then what Borin carries into it (`turnReminder`). A hidden combatant's turn stays
   *  GM-only (its name would otherwise leak). */
  function logTurnBegin(state: GameState) {
    if (state.combat.turnActorId === null) return;
    const name = state.actors.find((actor) => actor.id === state.combat.turnActorId)?.name ?? "A combatant";
    appendLog({
      kind: "turn",
      text: `Round ${state.combat.round} · ${name}'s turn.`,
      actorIds: [state.combat.turnActorId]
    });
    const reminder = turnReminder(state, state.combat.turnActorId, hiddenFrom(state, sightContent()));
    if (reminder !== null) appendLog({ kind: "turn", text: reminder, actorIds: [state.combat.turnActorId] });
  }
  /** Turns a timeline navigation outcome into log lines: plain turns for forward play, GM-only notes for rewinds. */
  function logTimelineOutcome(outcome: TimelineOutcome, state: GameState) {
    switch (outcome.kind) {
      case "advanced":
      case "legacy":
        logTurnBegin(state);
        break;
      case "rewrote":
        appendLog({
          kind: "history",
          text: "The GM rewrote history from this turn, and every later turn was undone.",
          gmOnly: true
        });
        logTurnBegin(state);
        break;
      case "rewound":
        appendLog({ kind: "history", text: `The GM rewound to ${outcome.label}.`, gmOnly: true });
        break;
      case "stepped":
        appendLog({ kind: "history", text: `The GM moved to ${outcome.label}.`, gmOnly: true });
        break;
      case "discarded":
        appendLog({ kind: "history", text: `The GM discarded the changes at ${outcome.label}.`, gmOnly: true });
        break;
      case "resumed":
        appendLog({ kind: "history", text: "The GM resumed live play.", gmOnly: true });
        break;
    }
  }
  async function tokenGeometryFor(mapAssetId: string): Promise<TokenMapGeometry> {
    const [asset, entry] = await Promise.all([mapAssets.get(mapAssetId), Promise.resolve(mapCatalog.get(mapAssetId))]);
    if (!asset || !entry || entry.kind !== "battlemap")
      throw new CommandRejectedError("The active encounter battlemap is unavailable.");
    return {
      width: asset.width,
      height: asset.height,
      calibration: entry.calibration?.calibration ?? null,
      scale: entry.scale ?? null
    };
  }
  async function publishGameState(state: GameState) {
    try {
      await viewerCoordinator.synchronizeEncounter(
        state.revision,
        projectViewerEncounter(state, Date.now(), sightContent())
      );
    } catch {
      for (const socket of io.sockets.sockets.values())
        if (auth.verify(socket.handshake.auth?.token))
          socket.emit(
            "system:error",
            "The game state was saved, but the shared viewer could not synchronize the encounter. Retry the last viewer action or restart the host."
          );
    }
    broadcast();
    // A character the content refresh passed over during a fight is rebuilt once the fight ends.
    if (refreshWaits(state))
      void reconcileContentDerived().catch((error: unknown) =>
        console.error("rebuilding sheets failed:", error instanceof Error ? error.message : error)
      );
  }
  /** Presents a newly-live scene's map on the shared screen. Best-effort: a viewer failure must not undo the committed scene switch. */
  async function presentSceneMap(mapAssetId: string) {
    try {
      const geometry = await tokenGeometryFor(mapAssetId);
      const entry = mapCatalog.get(mapAssetId);
      await viewerCoordinator.presentMap(store.revision, {
        assetId: mapAssetId,
        altText: entry?.name ?? "Battle map",
        camera: { center: { x: geometry.width / 2, y: geometry.height / 2 }, zoom: 1 }
      });
    } catch {
      for (const socket of io.sockets.sockets.values())
        if (auth.verify(socket.handshake.auth?.token))
          socket.emit(
            "system:error",
            "The scene is live, but the shared screen could not switch to its map. Present it from the Viewer tab."
          );
    }
  }

  /**
   * After the GM password is reset (data/auth.json deleted), every player session from before is dead, so the
   * characters they claimed are let go and each player can claim again from a fresh seat.
   */
  async function releaseEveryClaim() {
    if (!committedState.read().actors.some((actor) => actor.ownerSessionId !== null)) return;
    const { state } = await store.execute({ id: randomUUID(), type: "host.release-claims" }, (draft) => {
      for (const actor of draft.actors) actor.ownerSessionId = null;
    });
    await publishGameState(state);
  }

  // The game commands and reads, served by both the Socket.IO handlers below and the HTTP API (ADR-0016).
  const game = createGameCommands({
    store,
    readState: committedState.read,
    combatLog,
    contentLibrary,
    mapCatalog,
    tokenCatalog,
    characterDrafts,
    tokenGeometryFor,
    publishGameState,
    presentSceneMap,
    broadcastTableEvent,
    appendLog,
    logTurnBegin,
    logTimelineOutcome,
    scheduleAnnotationExpiry,
    gmView: (state) => gmView(state),
    playerView: (state, sessionId) => projectPlayerView(state, sessionId, presenceFor, Date.now(), sightContent()),
    random: (sides) => randomInt(1, sides + 1),
    newId: randomUUID,
    // Archives live in the game store's own table; `replay.launch` reads one document through this hook.
    archiveDocument: (id) => store.getEncounterArchive(id),
    sound,
    onTimePassed: ({ fromHours, toHours }) => {
      // The game keeps the hour and the Codex calendar the day: each midnight crossed moves the date a day.
      const days = Math.floor(toHours / 24) - Math.floor(fromHours / 24);
      try {
        if (codexStore.advanceCampaignDate(days)) notifyCodexChanged();
      } catch (error) {
        // Best-effort (the rest already committed), but logged.
        console.error("moving the codex date failed:", error instanceof Error ? error.message : error);
      }
    },
    claimReleased: (sessionId, event) => {
      for (const socket of io.sockets.sockets.values())
        if (auth.verifyPlayer(socket.handshake.auth?.token)?.sessionId === sessionId)
          socket.emit("claim:released", event);
    },
    onEncounterArchived: ({ sceneId, turnCount }) => {
      // Log the fight to the codex timeline, pinned to the location marker that links this scene, if any.
      try {
        const latest = store.listEncounterArchives()[0];
        if (!latest) return;
        const marker = sceneId ? codexStore.markerForScene(sceneId) : null;
        const turns = turnCount > 0 ? ` (${turnCount} ${turnCount === 1 ? "turn" : "turns"})` : "";
        codexStore.appendCombatEntry({
          sourceEncounterId: latest.id,
          attachMarkerId: marker?.id ?? null,
          attachPageId: marker?.pageIds[0] ?? null,
          playerText: `A battle was fought here${turns}.`
        });
        notifyCodexChanged();
      } catch (error) {
        // Best-effort (a codex failure must not affect ending a fight), but logged.
        console.error(
          "codex combat-history bridge failed to log the encounter:",
          error instanceof Error ? error.message : error
        );
      }
    }
  });

  // Open CORS for /api/v1: credentials there are bearer headers (or SameSite=Strict cookies), so a
  // wildcard origin grants nothing a token doesn't, and browser integrations can call it. The host's GM
  // account routes (password setup and sign-in) stay same-origin so web pages can't relay password guesses.
  // Mounted above the body parsers so preflights skip body buffering and parser errors carry CORS headers
  // and the request id. Every /api/v1 router relies on this one request-id stamp.
  app.use((req, res, next) => {
    if (!isApiV1(req.path)) return next();
    if (!isHostRoute(req.path)) {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "authorization, content-type, x-request-id, if-none-match");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("access-control-expose-headers", "x-request-id, etag, retry-after, x-idempotent-replay");
      if (req.method === "OPTIONS") return res.status(204).end();
    }
    requestConventions(req, res, next);
  });
  // Homebrew packs exceed the global body limit. body-parser skips already-parsed requests, so a
  // route-scoped limit must be mounted before the global parser.
  app.use(HOMEBREW_PACK_IMPORT_PATH, homebrewPackBodyParser());
  // Codex backups reach tens of megabytes; mounted first for the same reason. Authorized before parsing,
  // so an unauthenticated client cannot make the event loop block on a 64 MB JSON.parse. The guard uses
  // the same callbacks as the router and memoizes its answer on `res.locals`.
  app.use(CODEX_PATHS.import, createCodexImportGuard(codexAuth), express.json({ limit: "64mb" }));
  // Above the express default so canonical ActorDefinition imports (capped at 256kb) fit.
  app.use(express.json({ limit: "512kb" }));
  // Give /api/v1 callers the stable error envelope for malformed/oversized JSON. Express would answer with HTML.
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!error || res.headersSent || !isApiV1(req.path)) return next(error as Error);
    return (error as { type?: string }).type === "entity.too.large"
      ? sendFailure(res, 413, "bad_request", "The request body is too large.")
      : sendFailure(res, 400, "validation_failed", "The request body is not valid JSON.");
  });
  app.use(
    createHostRouter({
      auth,
      verifiers,
      loginLimiter: gmLoginRateLimiter,
      isLoopback,
      broadcast,
      onBootstrapped: releaseEveryClaim,
      viewerBaseUrls: options.viewerBaseUrls,
      ...(options.gmSetupHint !== undefined ? { gmSetupHint: options.gmSetupHint } : {}),
      ...(options.passwordChangeGraceMs !== undefined ? { passwordChangeGraceMs: options.passwordChangeGraceMs } : {})
    })
  );
  app.use(
    createViewerRouter({
      access: viewerAccess,
      presentation: viewerPresentation,
      coordinator: viewerCoordinator,
      verifiers
    })
  );

  /** Whether an asset is the map of a replay the GM shared. Gated on the shared flag, and maps come from
   *  the player projection so a prepared scene's map can't leak. Memoised per archive (documents are
   *  immutable); visibility is re-read on every call. */
  const replayMapCache = new Map<number, ReadonlySet<string>>();
  const sharedReplayMap = (assetId: string): boolean => {
    for (const summary of store.listEncounterArchives()) {
      if (!summary.playerVisible) continue;
      let maps = replayMapCache.get(summary.id);
      if (maps === undefined) {
        const stored = store.getEncounterArchive(summary.id);
        if (stored === null) continue;
        try {
          maps = playerReplayMapAssetIds(summary.id, JSON.parse(stored) as EncounterArchiveDocument);
        } catch {
          maps = new Set<string>();
        } // An unreadable archive grants nothing, like a missing one.
        replayMapCache.set(summary.id, maps);
      }
      if (maps.has(assetId)) return true;
    }
    return false;
  };

  app.use(
    createMapRouter({
      assets: mapAssets,
      catalog: mapCatalog,
      verifiers,
      playerMayLoad: (assetId) => {
        const { combat } = committedState.read();
        // A player may load the live battle map (before its fight too, as their projection names it), any revealed
        // atlas map, or the map of a replay the GM shared.
        return (
          combat.mapAssetId === assetId || codexStore.isAssetRevealedToPlayers(assetId) || sharedReplayMap(assetId)
        );
      },
      viewerMayLoad: (assetId) => {
        const presentation = viewerPresentation.project();
        return presentation.enabled && presentation.activeMap?.assetId === assetId;
      }
    })
  );
  app.use(
    createTokenRouter({
      assets: tokenAssets,
      catalog: tokenCatalog,
      // A joined player may browse the GM's token library and upload their own token image.
      verifiers,
      // Only a creature the reader may know of: an image worn by one hidden by sight or the fog would answer
      // whether it is in play.
      playerMayLoad: (assetId, sessionId) => {
        const state = committedState.read();
        const hidden = hiddenFrom(state, sightContent(), sessionId);
        return state.actors.some((actor) => actor.tokenAssetId === assetId && !hidden(actor.id));
      },
      viewerMayLoad: (assetId) => {
        const state = committedState.read();
        const hidden = hiddenFrom(state, sightContent());
        return (
          viewerPresentation.project().enabled &&
          state.actors.some((actor) => actor.tokenAssetId === assetId && !hidden(actor.id))
        );
      }
    })
  );
  app.use(
    createSoundRouter({
      service: sound,
      assets: soundAssets,
      verifiers,
      // A table screen may load a sound only while it is playing; the GM's library stays the GM's.
      viewerMayLoad: (assetId) => sound.isOnAir(assetId)
    })
  );
  app.use(
    createCodexRouter({
      store: codexStore,
      assets: codexAssets,
      ...codexAuth,
      notifyChanged: notifyCodexChanged,
      issuePreviewSession: (characterIds) => auth.issuePreviewPlayerSession(characterIds),
      playerCharacters: claimedCharacters,
      partyCharacters
    })
  );
  // GM-only end to end: any other valid credential gets 403.
  app.use(
    createHomebrewRouter({
      store: homebrewStore,
      verifiers,
      notifyChanged: notifyHomebrewChanged,
      // The table with every pack on: a dependency in a pack that is off publishes, with a warning.
      validate: createHomebrewValidator({
        forAudience: (audience) => contentLibrary.forAudience(audience),
        forScenario: scenarioCatalogs(contentLibrary, homebrewStore),
        publishedSpellLists: (audience = "play") => homebrewStore.publishedFor(audience).spellLists,
        // Drafts included, only here: the gate asks whether a record exists, so a class and its subclass can
        // publish in either order.
        authoredIndex: () => homebrewStore.authoredIndex(),
        offPackRecords: () => homebrewStore.offPackRecords()
      }),
      usagesOf: homebrewUsagesFor,
      catalogRecord: (id) => findCatalogRecord(contentLibrary.forAudience("play"), id),
      contentLibrary,
      partyCharacters
    })
  );
  const gameApiRouter = createGameApiRouter({
    game,
    verifiers,
    archives: {
      list: () => store.listEncounterArchives(),
      get: (id) => store.getEncounterArchive(id),
      remove: (id) => store.deleteEncounterArchive(id),
      setVisibility: (id, playerVisible) => store.setEncounterArchiveVisibility(id, playerVisible),
      rename: (id, name) => store.renameEncounterArchive(id, name)
    },
    sessions: {
      // The HTTP mirror of the socket's LAN-trust join: anyone who can reach the host may take a player seat
      // once GM setup is complete.
      issuePlayer: () => {
        if (!auth.isBootstrapped) return null;
        const token = auth.issuePlayerSession();
        return { token, sessionId: auth.verifyPlayer(token)!.sessionId };
      }
    },
    revision: () => store.revision,
    newId: randomUUID,
    sightContent: () => sightContent()
  });
  const apiV1Router = createApiV1Router({
    applicationVersion: options.applicationVersion ?? "0.1.0",
    actorDefinitionVersion: ACTOR_DEFINITION_SCHEMA_VERSION,
    verifiers,
    credentialStore: credentials,
    gameRouter: gameApiRouter
  });
  // Its API-only 404 envelope answers inside /api/v1 alone, so it cannot swallow the SPA or the viewer.
  app.use(apiV1Router);
  app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));
  if (!options.useDevelopmentClient) {
    app.get("/viewer", (_req, res) => res.redirect(307, "/viewer.html"));
    // For install paths containing a dot-segment (e.g. OneDrive's `.DesktopOneDrive`): `send` ignores
    // dotfiles by default and 404s such absolute paths, so allow dotfiles and pass the SPA fallback a
    // root plus relative filename.
    app.use(express.static(options.webDist, { dotfiles: "allow" }));
    app.get("/{*path}", (_req, res) => res.sendFile("index.html", { root: options.webDist, dotfiles: "allow" }));
  } else {
    app.get("/viewer", (req, res) =>
      res.redirect(307, developmentClientUrl(req.hostname, "/viewer.html", options.developmentClientPort))
    );
    app.get("/{*path}", (req, res) =>
      res.redirect(307, developmentClientUrl(req.hostname, req.originalUrl, options.developmentClientPort))
    );
  }

  io.on("connection", (socket) => {
    let joinedSession: { sessionId: string; role: ClientRole } | null = null;
    socket.on("session:join", (payload, ack) => {
      // Client input: a join without a payload or an acknowledgement must not throw out of the handler.
      const token = typeof payload?.token === "string" && payload.token !== "" ? payload.token : undefined;
      const acknowledge: typeof ack = (result) => {
        if (typeof ack === "function") ack(result);
      };
      // The handshake reads the caller like every HTTP route (ADR-0027). A token that no longer verifies is refused,
      // never swapped for a fresh player seat: a GM whose session ended must hear so, and a player's client drops
      // the dead token and joins again without one.
      const caller = callerOfToken(token, verifiers);
      if (caller.kind === "invalid")
        return acknowledge({ ok: false, code: "unauthenticated", message: "Your session ended. Sign in again." });
      if (caller.kind !== "none" && caller.kind !== "gm" && caller.kind !== "player")
        return acknowledge({ ok: false, code: "forbidden", message: "That credential does not join the table." });
      socket.handshake.auth.token = token;
      const gm = auth.verify(token);
      if (gm) {
        joinedSession = { sessionId: gm.sessionId, role: "gm" };
        presence.connect(gm.sessionId, "gm");
        acknowledge({ ok: true, role: "gm", sessionId: gm.sessionId });
        broadcast();
        // The board too, so a GM device that (re)joins never waits for the next change to see it.
        socket.emit("sound:changed", sound.view());
        return;
      }
      const existingPlayer = auth.verifyPlayer(token);
      if (existingPlayer) {
        joinedSession = { sessionId: existingPlayer.sessionId, role: "player" };
        presence.connect(existingPlayer.sessionId, "player");
        acknowledge({ ok: true, role: "player", sessionId: existingPlayer.sessionId, token });
        broadcast();
        return;
      }
      if (!auth.isBootstrapped)
        return acknowledge({ ok: false, message: "The host must complete GM setup before players join." });
      const playerToken = auth.issuePlayerSession();
      socket.handshake.auth.token = playerToken;
      const player = auth.verifyPlayer(playerToken)!;
      joinedSession = { sessionId: player.sessionId, role: "player" };
      presence.connect(player.sessionId, "player");
      acknowledge({ ok: true, role: "player", sessionId: player.sessionId, token: playerToken });
      broadcast();
    });
    socket.on("disconnect", () => {
      if (!joinedSession) return;
      const token = socket.handshake.auth?.token;
      const stillValid = joinedSession.role === "gm" ? auth.verify(token) : auth.verifyPlayer(token);
      presence.disconnect(joinedSession.sessionId, !stillValid);
      broadcast();
    });
    /** The caller's identity, re-verified per command from the signed token (never cached across commands). */
    const principalOf = (): GamePrincipal | null => {
      const token = socket.handshake.auth?.token;
      const gm = auth.verify(token);
      if (gm) return { kind: "gm", sessionId: gm.sessionId };
      const player = auth.verifyPlayer(token);
      if (!player) return null;
      return player.preview
        ? { kind: "player", sessionId: player.sessionId, preview: { characterIds: player.preview.characterIds } }
        : { kind: "player", sessionId: player.sessionId };
    };
    /** Whether this socket joined with a token that has since been revoked or run out. */
    const sessionEnded = () => {
      const token = socket.handshake.auth?.token;
      return typeof token === "string" && !auth.verify(token) && !auth.verifyPlayer(token);
    };
    /** Socket adapter: resolve the principal, run the work, and answer through the same failure mapping as
     *  HTTP. A timeline confirmation bounce is an ok:true ack, and an emit without an acknowledgement still
     *  runs. */
    const respond = async (
      acknowledge: unknown,
      work: (principal: GamePrincipal) => Promise<Record<string, unknown>> | Record<string, unknown>
    ) => {
      const reply = (result: Record<string, unknown>) => {
        if (typeof acknowledge === "function") acknowledge(result);
      };
      const principal = principalOf();
      if (!principal && sessionEnded()) {
        reply(SESSION_ENDED_REPLY);
        endSession(socket);
        return;
      }
      if (!principal) return reply(NOT_JOINED_REPLY);
      let outcome: Record<string, unknown>;
      try {
        outcome = { ok: true, ...(await work(principal)) };
      } catch (error) {
        outcome = failureReply(error);
      }
      reply(outcome);
    };
    // Every command and read is registered from its table entry; the event names are typed against the
    // domain's `ClientToServerEvents` in `commands/index.ts`.
    const on = socket.on.bind(socket) as unknown as (
      event: string,
      listener: (payload: unknown, acknowledge?: unknown) => void
    ) => void;
    for (const command of game.commands)
      on(socketEventOf(command.type), (payload, acknowledge) =>
        respond(acknowledge, (principal) => game.dispatch(command.type, principal, payload))
      );
    for (const read of game.reads)
      on(read.event, (payload, acknowledge) =>
        respond(acknowledge, (principal) => game.read(read, principal, payload))
      );
    socket.emit(
      "state:updated",
      projectPlayerView(
        committedState.read(),
        auth.verifyPlayer(socket.handshake.auth.token)?.sessionId,
        presenceFor,
        Date.now(),
        sightContent()
      )
    );
  });

  async function initialize() {
    await Promise.all([
      auth.initialize(),
      store.initialize(),
      combatLog.initialize(),
      credentials.initialize(),
      mapAssets.initialize(),
      mapCatalog.initialize(),
      tokenAssets.initialize(),
      tokenCatalog.initialize(),
      viewerAccess.initialize(),
      viewerPresentation.initialize(),
      characterDrafts.initialize(),
      codexStore.initialize(),
      codexAssets.initialize(),
      homebrewStore.initialize(),
      soundAssets.initialize(),
      soundCatalog.initialize(),
      soundStore.initialize()
    ]);
    // The players' view as it stands at start, so the first write a player cannot see pings no player.
    playerCodexChanges = new PlayerCodexChanges(codexStore);
    await sound.initialize();
    // The store's startup seeds may change the state without a revision bump.
    committedState.reset();
    await reconcileContentDerived();
    await viewerCoordinator.synchronizeEncounter(
      store.revision,
      projectViewerEncounter(committedState.read(), Date.now(), sightContent())
    );
  }
  function close() {
    clearInterval(sessionSweep);
    if (playerCodexCheck) clearImmediate(playerCodexCheck);
    if (playerHomebrewCheck) clearImmediate(playerHomebrewCheck);
    presence.dispose();
    viewerCoordinator.dispose();
    sound.dispose();
    for (const timer of annotationExpiryTimers) clearTimeout(timer);
    annotationExpiryTimers.clear();
    io.close();
    store.close();
    combatLog.close();
    credentials.close();
    mapCatalog.close();
    tokenCatalog.close();
    viewerAccess.close();
    viewerPresentation.close();
    characterDrafts.close();
    homebrewStore.close();
    soundCatalog.close();
    soundStore.close();
  }

  return {
    app,
    httpServer,
    io,
    auth,
    store,
    credentials,
    presence,
    mapAssets,
    mapCatalog,
    viewerAccess,
    viewerPresentation,
    viewerCoordinator,
    sound,
    initialize,
    close
  };
}
