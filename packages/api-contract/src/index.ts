import { z } from "zod";

export const API_VERSION = "1" as const;
export const API_NAMESPACE = `/api/v${API_VERSION}` as const;
export const REALTIME_PROTOCOL_VERSION = "1" as const;

export const SYSTEM_PATHS = {
  health: `${API_NAMESPACE}/system/health`,
  version: `${API_NAMESPACE}/system/version`,
  capabilities: `${API_NAMESPACE}/system/capabilities`
} as const;

/** Served separately from SYSTEM_PATHS: it documents the whole contract rather than being one system operation among others. */
export const OPENAPI_DOCUMENT_PATH = `${API_NAMESPACE}/openapi.json` as const;

/** GM-authorized credential management, not integration-token authorized. `{id}` is OpenAPI-style; the Express router substitutes `:id`. */
/** The host's own GM account: first-run password setup (from the host machine only), sign-in and sign-out.
 *  Same-origin only: open CORS here would let any web page relay password guesses. */
export const HOST_NAMESPACE = `${API_NAMESPACE}/host` as const;
export const HOST_PATHS = {
  setup: `${HOST_NAMESPACE}/setup`,
  gmSignIn: `${HOST_NAMESPACE}/gm/sign-in`,
  gmSignOut: `${HOST_NAMESPACE}/gm/sign-out`,
  gmRevokeAll: `${HOST_NAMESPACE}/gm/revoke-all`,
  viewerUrls: `${HOST_NAMESPACE}/gm/viewer-urls`
} as const;

export const INTEGRATION_CREDENTIAL_PATHS = {
  collection: `${API_NAMESPACE}/gm/integration-credentials`,
  rotate: `${API_NAMESPACE}/gm/integration-credentials/{id}/rotate`,
  revoke: `${API_NAMESPACE}/gm/integration-credentials/{id}/revoke`,
  audit: `${API_NAMESPACE}/gm/integration-credentials/{id}/audit`
} as const;

/** Documentation-only paths for `map-http.ts`, kept so the OpenAPI document matches the running routes. The router
 * keeps its own literal paths because it templates `:id` rather than `{id}`. */
export const MAP_ASSET_PATHS = {
  collection: `${API_NAMESPACE}/map-assets`,
  byId: `${API_NAMESPACE}/map-assets/{id}`,
  content: `${API_NAMESPACE}/map-assets/{id}/content`,
  scale: `${API_NAMESPACE}/map-assets/{id}/scale`,
  calibrationWizards: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards`,
  calibrationWizardActions: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/actions`,
  calibrationWizardComplete: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/complete`
} as const;

/** The HttpOnly cookie a paired table viewer (or the GM's preview of it) authenticates with. */
export const VIEWER_SESSION_COOKIE = "vtt_viewer_session";

/** Documentation-only path constants for `viewer-http.ts`'s router. See the note on MAP_ASSET_PATHS. */
export const VIEWER_PATHS = {
  pairings: `${API_NAMESPACE}/viewer/pairings`,
  pairingsExchange: `${API_NAMESPACE}/viewer/pairings/exchange`,
  access: `${API_NAMESPACE}/viewer/access`,
  accessById: `${API_NAMESPACE}/viewer/access/{id}`,
  presentation: `${API_NAMESPACE}/viewer/presentation`,
  presentationCommands: `${API_NAMESPACE}/viewer/presentation/commands`,
  previewSession: `${API_NAMESPACE}/viewer/preview-session`,
  events: `${API_NAMESPACE}/viewer/events`
} as const;

/**
 * The worldbuilding Codex surface (`codex-http.ts`). Reads accept a GM or player session (players get the
 * revealed-only projection with `gmBody`, GM fields and unrevealed pages/maps/markers/entries stripped
 * server-side); every write is GM-grade. A `codex:read` / `codex:write` credential acts at GM grade, except
 * `POST /codex/preview-session`, which mints a player token and stays GM-session-only.
 * `{id}` is OpenAPI-style; the Express router substitutes `:id`.
 */
export const CODEX_PATHS = {
  pages: `${API_NAMESPACE}/codex/pages`,
  pageById: `${API_NAMESPACE}/codex/pages/{id}`,
  pageReveal: `${API_NAMESPACE}/codex/pages/{id}/reveal`,
  pageConnections: `${API_NAMESPACE}/codex/pages/{id}/connections`,
  pageMarkers: `${API_NAMESPACE}/codex/pages/{id}/markers`,
  pageRevisions: `${API_NAMESPACE}/codex/pages/{id}/revisions`,
  pageRevisionRestore: `${API_NAMESPACE}/codex/pages/{id}/revisions/{revisionId}/restore`,
  search: `${API_NAMESPACE}/codex/search`,
  previewSession: `${API_NAMESPACE}/codex/preview-session`,
  folders: `${API_NAMESPACE}/codex/folders`,
  foldersMove: `${API_NAMESPACE}/codex/folders/move`,
  foldersDelete: `${API_NAMESPACE}/codex/folders/delete`,
  connections: `${API_NAMESPACE}/codex/connections`,
  connectionById: `${API_NAMESPACE}/codex/connections/{id}`,
  maps: `${API_NAMESPACE}/codex/maps`,
  mapById: `${API_NAMESPACE}/codex/maps/{id}`,
  mapParent: `${API_NAMESPACE}/codex/maps/{id}/parent`,
  mapReveal: `${API_NAMESPACE}/codex/maps/{id}/reveal`,
  mapMarkers: `${API_NAMESPACE}/codex/maps/{id}/markers`,
  markerById: `${API_NAMESPACE}/codex/markers/{id}`,
  markerMove: `${API_NAMESPACE}/codex/markers/{id}/move`,
  markerReveal: `${API_NAMESPACE}/codex/markers/{id}/reveal`,
  // The party pin is an ordinary marker with a flag; it is moved, revealed and deleted through the marker routes.
  markerParty: `${API_NAMESPACE}/codex/markers/{id}/party`,
  party: `${API_NAMESPACE}/codex/party`,
  timeline: `${API_NAMESPACE}/codex/timeline`,
  journal: `${API_NAMESPACE}/codex/journal`,
  // Literal segments, declared before the `{id}` family so `POST /codex/journal/{id}` cannot swallow them.
  journalDeadline: `${API_NAMESPACE}/codex/journal/deadline`,
  journalDowntime: `${API_NAMESPACE}/codex/journal/downtime`,
  journalMilestone: `${API_NAMESPACE}/codex/journal/milestone`,
  journalById: `${API_NAMESPACE}/codex/journal/{id}`,
  journalReveal: `${API_NAMESPACE}/codex/journal/{id}/reveal`,
  journalApplyDowntime: `${API_NAMESPACE}/codex/journal/{id}/apply-downtime`,
  sessions: `${API_NAMESPACE}/codex/sessions`,
  sessionById: `${API_NAMESPACE}/codex/sessions/{id}`,
  sessionReveal: `${API_NAMESPACE}/codex/sessions/{id}/reveal`,
  sessionActivate: `${API_NAMESPACE}/codex/sessions/{id}/activate`,
  quests: `${API_NAMESPACE}/codex/quests`,
  questById: `${API_NAMESPACE}/codex/quests/{id}`,
  questReveal: `${API_NAMESPACE}/codex/quests/{id}/reveal`,
  // A standing is addressed by its faction page id, which is unique.
  standing: `${API_NAMESPACE}/codex/standing`,
  standingByFaction: `${API_NAMESPACE}/codex/standing/{factionPageId}`,
  standingReveal: `${API_NAMESPACE}/codex/standing/{factionPageId}/reveal`,
  // GM-only, read-only aggregation of reveal state; each row carries the id its own reveal route takes.
  revealAudit: `${API_NAMESPACE}/codex/reveal-audit`,
  calendar: `${API_NAMESPACE}/codex/calendar`,
  calendarPublish: `${API_NAMESPACE}/codex/calendar/publish`,
  calendarUnpublish: `${API_NAMESPACE}/codex/calendar/unpublish`,
  calendarCheck: `${API_NAMESPACE}/codex/calendar/check`,
  // Codex-wide settings, a singleton (`codex_meta` is one row). GM-only for reads and writes.
  settings: `${API_NAMESPACE}/codex/settings`,
  // Deletes the whole `codex_page_revisions` table to reclaim space, hence a top-level collection;
  // `pageRevisions` above stays the per-page read.
  pageRevisionsCollection: `${API_NAMESPACE}/codex/page-revisions`,
  export: `${API_NAMESPACE}/codex/export`,
  import: `${API_NAMESPACE}/codex/import`
} as const;

/** Codex page media (banners + inline images), content-addressed, separate from map/token assets. See CODEX_PATHS. */
export const CODEX_ASSET_PATHS = {
  collection: `${API_NAMESPACE}/codex-assets`,
  content: `${API_NAMESPACE}/codex-assets/{id}/content`
} as const;

/**
 * The GM homebrew authoring surface (`homebrew-http.ts`). Every operation is GM-only; players see homebrew
 * only through the merged `CONTENT_PATHS` catalogs, and only records that are published, `visibleToPlayers`
 * and not deleted. One polymorphic collection serves all content types via `type`. `{id}` is OpenAPI-style;
 * ids are content slugs (`hb-<slug>-<6 hex>`, <=60 chars), not UUIDs.
 */
export const HOMEBREW_PATHS = {
  content: `${API_NAMESPACE}/homebrew/content`,
  contentById: `${API_NAMESPACE}/homebrew/content/{id}`,
  contentRestore: `${API_NAMESPACE}/homebrew/content/{id}/restore`,
  contentDuplicate: `${API_NAMESPACE}/homebrew/content/{id}/duplicate`,
  contentPublish: `${API_NAMESPACE}/homebrew/content/{id}/publish`,
  contentUnpublish: `${API_NAMESPACE}/homebrew/content/{id}/unpublish`,
  contentDiscard: `${API_NAMESPACE}/homebrew/content/{id}/discard`,
  contentVisibility: `${API_NAMESPACE}/homebrew/content/{id}/visibility`,
  contentUsages: `${API_NAMESPACE}/homebrew/content/{id}/usages`,
  packsExport: `${API_NAMESPACE}/homebrew/packs/export`,
  packsImport: `${API_NAMESPACE}/homebrew/packs/import`
} as const;

/** The live-game integration surface (`game-http.ts`): reads project per principal; writes dispatch through the
 * same operations as the UI's Socket.IO commands (ADR-0016). `{param}` is OpenAPI-style. */
export const GAME_PATHS = {
  snapshot: `${API_NAMESPACE}/game`,
  log: `${API_NAMESPACE}/game/log`,
  commands: `${API_NAMESPACE}/game/commands`,
  encounterStart: `${API_NAMESPACE}/game/encounter/start`,
  encounterEnd: `${API_NAMESPACE}/game/encounter/end`,
  encounterCombatants: `${API_NAMESPACE}/game/encounter/combatants`,
  initiativeSet: `${API_NAMESPACE}/game/initiative/set`,
  initiativeSwap: `${API_NAMESPACE}/game/initiative/swap`,
  initiativeRollSelf: `${API_NAMESPACE}/game/initiative/roll-self`,
  initiativeRollRemaining: `${API_NAMESPACE}/game/initiative/roll-remaining`,
  initiativeNext: `${API_NAMESPACE}/game/initiative/next`,
  initiativePrevious: `${API_NAMESPACE}/game/initiative/previous`,
  turnEnd: `${API_NAMESPACE}/game/turn/end`,
  turnUse: `${API_NAMESPACE}/game/turn/use`,
  turnReaction: `${API_NAMESPACE}/game/turn/reaction`,
  turnLegendary: `${API_NAMESPACE}/game/turn/legendary`,
  tokenMove: `${API_NAMESPACE}/game/tokens/{actorId}/move`,
  actors: `${API_NAMESPACE}/game/actors`,
  actorById: `${API_NAMESPACE}/game/actors/{actorId}`,
  actorDamage: `${API_NAMESPACE}/game/actors/{actorId}/damage`,
  actorHeal: `${API_NAMESPACE}/game/actors/{actorId}/heal`,
  actorTempHp: `${API_NAMESPACE}/game/actors/{actorId}/temp-hp`,
  actorHp: `${API_NAMESPACE}/game/actors/{actorId}/hp`,
  actorConditions: `${API_NAMESPACE}/game/actors/{actorId}/conditions`,
  definitionsImport: `${API_NAMESPACE}/game/definitions/import`,
  characterImports: `${API_NAMESPACE}/game/character-imports`,
  characterImportResolve: `${API_NAMESPACE}/game/character-imports/{importId}/resolve`,
  rolls: `${API_NAMESPACE}/game/rolls`,
  actionResolve: `${API_NAMESPACE}/game/actions/resolve`,
  saveAnswer: `${API_NAMESPACE}/game/saves/{saveId}/answer`,
  saveDismiss: `${API_NAMESPACE}/game/saves/{saveId}/dismiss`,
  reactionAnswer: `${API_NAMESPACE}/game/reactions/{reactionId}/answer`,
  reactionDismiss: `${API_NAMESPACE}/game/reactions/{reactionId}/dismiss`,
  damageResolve: `${API_NAMESPACE}/game/damage/resolve`,
  actorAvailableActions: `${API_NAMESPACE}/game/actors/{actorId}/available-actions`,
  actorMovement: `${API_NAMESPACE}/game/actors/{actorId}/movement`,
  effects: `${API_NAMESPACE}/game/actors/{actorId}/effects`,
  effectEnd: `${API_NAMESPACE}/game/actors/{actorId}/effects/{effectId}/end`,
  deathSaveRoll: `${API_NAMESPACE}/game/actors/{actorId}/death-save`,
  rulesMode: `${API_NAMESPACE}/game/encounter/rules-mode`,
  playerDamageMode: `${API_NAMESPACE}/game/encounter/player-damage-mode`,
  playerInitiativeMode: `${API_NAMESPACE}/game/encounter/player-initiative-mode`,
  healthDisplay: `${API_NAMESPACE}/game/encounter/health-display`,
  environment: `${API_NAMESPACE}/game/encounter/environment`,
  actorRest: `${API_NAMESPACE}/game/actors/{actorId}/rest`,
  actorRechoose: `${API_NAMESPACE}/game/actors/{actorId}/rechoose`,
  actorSpendHitDice: `${API_NAMESPACE}/game/actors/{actorId}/spend-hit-dice`,
  characterSetSlot: `${API_NAMESPACE}/game/actors/{actorId}/spell-slot`,
  characterSetPrepared: `${API_NAMESPACE}/game/actors/{actorId}/prepared-spell`,
  characterFinishPreparing: `${API_NAMESPACE}/game/actors/{actorId}/finish-preparing`,
  characterSetInventory: `${API_NAMESPACE}/game/actors/{actorId}/inventory`,
  characterGiveItem: `${API_NAMESPACE}/game/actors/{actorId}/inventory/give`,
  characterSetCurrency: `${API_NAMESPACE}/game/actors/{actorId}/currency`,
  characterSetIdentity: `${API_NAMESPACE}/game/actors/{actorId}/identity`,
  characterSetProficiencies: `${API_NAMESPACE}/game/actors/{actorId}/proficiencies`,
  characters: `${API_NAMESPACE}/game/characters`,
  characterDraft: `${API_NAMESPACE}/game/characters/draft`,
  characterDraftSave: `${API_NAMESPACE}/game/characters/draft/save`,
  characterDraftDiscard: `${API_NAMESPACE}/game/characters/draft/discard`,
  charactersRandom: `${API_NAMESPACE}/game/characters/random`,
  characterRebuild: `${API_NAMESPACE}/game/actors/{actorId}/rebuild`,
  builderOffers: `${API_NAMESPACE}/game/builder/offers`,
  builderRollAbilities: `${API_NAMESPACE}/game/builder/ability-rolls`,
  builderPolicy: `${API_NAMESPACE}/game/builder/policy`,
  rulesPolicy: `${API_NAMESPACE}/game/rules/policy`,
  actionUse: `${API_NAMESPACE}/game/actions/use`,
  saveRoll: `${API_NAMESPACE}/game/saves/roll`,
  actorHeroicInspiration: `${API_NAMESPACE}/game/actors/{actorId}/heroic-inspiration`,
  rulesAsk: `${API_NAMESPACE}/game/rules/ask`,
  rulesAnswer: `${API_NAMESPACE}/game/rules/answer`,
  stagingDefaults: `${API_NAMESPACE}/game/table/staging-defaults`,
  partyVisibility: `${API_NAMESPACE}/game/table/party-visibility`,
  annotations: `${API_NAMESPACE}/game/annotations`,
  annotationsPing: `${API_NAMESPACE}/game/annotations/ping`,
  annotationsClear: `${API_NAMESPACE}/game/annotations/clear`,
  annotationById: `${API_NAMESPACE}/game/annotations/{id}`,
  annotationMove: `${API_NAMESPACE}/game/annotations/{id}/move`,
  annotationColor: `${API_NAMESPACE}/game/annotations/{id}/color`,
  annotationVisibility: `${API_NAMESPACE}/game/annotations/{id}/visibility`,
  annotationMovable: `${API_NAMESPACE}/game/annotations/{id}/movable`,
  claims: `${API_NAMESPACE}/game/claims`,
  claimsRelease: `${API_NAMESPACE}/game/claims/release`,
  claimForceRelease: `${API_NAMESPACE}/game/claims/{actorId}/force-release`,
  actorTokenImage: `${API_NAMESPACE}/game/actors/{actorId}/token-image`,
  actorSize: `${API_NAMESPACE}/game/actors/{actorId}/size`,
  actorVisibility: `${API_NAMESPACE}/game/actors/{actorId}/visibility`,
  actorArchived: `${API_NAMESPACE}/game/actors/{actorId}/archived`,
  actorSheetPreview: `${API_NAMESPACE}/game/actors/{actorId}/sheet-preview`,
  actorHealthDisplay: `${API_NAMESPACE}/game/actors/{actorId}/health-display`,
  actorSpeed: `${API_NAMESPACE}/game/actors/{actorId}/speed`,
  actorArmorClass: `${API_NAMESPACE}/game/actors/{actorId}/armor-class`,
  scenes: `${API_NAMESPACE}/game/scenes`,
  sceneById: `${API_NAMESPACE}/game/scenes/{sceneId}`,
  sceneRename: `${API_NAMESPACE}/game/scenes/{sceneId}/rename`,
  sceneActivate: `${API_NAMESPACE}/game/scenes/{sceneId}/activate`,
  sceneCombatants: `${API_NAMESPACE}/game/scenes/{sceneId}/combatants`,
  sceneDuplicate: `${API_NAMESPACE}/game/scenes/{sceneId}/duplicate`,
  sceneReorder: `${API_NAMESPACE}/game/scenes/reorder`,
  fogEnabled: `${API_NAMESPACE}/game/fog/enabled`,
  fogPaint: `${API_NAMESPACE}/game/fog/paint`,
  fogReset: `${API_NAMESPACE}/game/fog/reset`,
  terrainPaint: `${API_NAMESPACE}/game/terrain/paint`,
  terrainReset: `${API_NAMESPACE}/game/terrain/reset`
} as const;

/** Session issuance for headless/alternate player clients: the HTTP mirror of the socket's open join. */
export const SESSION_PATHS = {
  player: `${API_NAMESPACE}/sessions/player`
} as const;

/** Bundled SRD reference content (read-only). The bestiary is GM-grade; every rules catalog (conditions, spells,
 * equipment, character-builder catalogs) is readable by any joined session. Catalogs with SRD prose carry the
 * CC BY 4.0 `attribution` line the displaying surface must show (ADR-0015). */
export const CONTENT_PATHS = {
  monsters: `${API_NAMESPACE}/content/monsters`,
  monsterById: `${API_NAMESPACE}/content/monsters/{definitionId}`,
  monsterActions: `${API_NAMESPACE}/content/monsters/{definitionId}/actions`,
  conditions: `${API_NAMESPACE}/content/conditions`,
  glossary: `${API_NAMESPACE}/content/glossary`,
  skills: `${API_NAMESPACE}/content/skills`,
  languages: `${API_NAMESPACE}/content/languages`,
  spells: `${API_NAMESPACE}/content/spells`,
  equipment: `${API_NAMESPACE}/content/equipment`,
  classes: `${API_NAMESPACE}/content/classes`,
  subclasses: `${API_NAMESPACE}/content/subclasses`,
  species: `${API_NAMESPACE}/content/species`,
  backgrounds: `${API_NAMESPACE}/content/backgrounds`,
  feats: `${API_NAMESPACE}/content/feats`,
  names: `${API_NAMESPACE}/content/names`
} as const;

/** The archive document's schema version; the generated reference interpolates it. */
export const ENCOUNTER_ARCHIVE_SCHEMA_VERSION = 3 as const;

/** Permanent Time Machine records of ended encounters (archiveSchemaVersion 3). GM-grade only: documents hold full state. */
export const ENCOUNTER_ARCHIVE_PATHS = {
  collection: `${API_NAMESPACE}/encounters`,
  byId: `${API_NAMESPACE}/encounters/{id}`,
  visibility: `${API_NAMESPACE}/encounters/{id}/visibility`,
  /** Make one recorded moment live on the table. */
  launch: `${API_NAMESPACE}/encounters/{id}/launch`
} as const;

export const ApiErrorCodeSchema = z.enum([
  "bad_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "unsupported_version",
  "validation_failed",
  "internal_error"
]);

export const IntegrationScopeSchema = z.enum([
  "system:read",
  "game:read",
  "actor:read",
  "actor:write",
  "scene:read",
  "scene:write",
  "combat:read",
  "combat:write",
  "roll:create",
  // Codex scopes. A codex credential acts at GM grade (the GM's own automation), so there is no player-grade
  // scope; a player-grade bot uses a player session.
  "codex:read",
  "codex:write",
  "events:read",
  "webhooks:manage",
  "admin"
]);

const ApiVersionSchema = z.literal(API_VERSION);
const RealtimeProtocolVersionSchema = z.literal(REALTIME_PROTOCOL_VERSION);
const TimestampSchema = z.iso.datetime({ offset: true });

export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ ok: z.literal(true), apiVersion: ApiVersionSchema, data }).strict();
}

export const ApiErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    apiVersion: ApiVersionSchema,
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().min(1).max(500),
        requestId: z.uuid(),
        details: z.record(z.string(), z.unknown()).optional(),
        retryAfterSeconds: z.number().int().positive().optional(),
        currentRevision: z.number().int().nonnegative().optional()
      })
      .strict()
  })
  .strict();

export const SystemHealthSchema = z
  .object({
    status: z.literal("ok"),
    serverTime: TimestampSchema
  })
  .strict();

export const SystemVersionSchema = z
  .object({
    applicationVersion: z.string().min(1),
    apiVersion: ApiVersionSchema,
    realtimeProtocolVersion: RealtimeProtocolVersionSchema,
    schemaVersions: z.object({ actorDefinition: z.number().int().positive() }).strict()
  })
  .strict();

export const SystemCapabilitiesSchema = z
  .object({
    api: z.object({ version: ApiVersionSchema, namespace: z.literal(API_NAMESPACE) }).strict(),
    realtime: z.object({ protocolVersion: RealtimeProtocolVersionSchema, transport: z.literal("socket.io") }).strict(),
    supportedScopes: z.array(IntegrationScopeSchema),
    features: z
      .object({
        webhooks: z.boolean(),
        viewer: z.boolean(),
        battlemapGridCalibration: z.boolean(),
        /** The live-game REST surface under /game plus /content and /encounters. */
        gameApi: z.boolean(),
        /** The generic POST /game/commands tunnel + its GET catalog. */
        commandTunnel: z.boolean(),
        /** Permanent archives of ended encounters (Time Machine v2 documents). */
        encounterArchives: z.boolean(),
        rulesEngine: z.boolean(),
        /** The worldbuilding Codex under /codex, reachable with a `codex:read` / `codex:write` credential. */
        codex: z.boolean()
      })
      .strict()
  })
  .strict();

export const SystemHealthResponseSchema = successEnvelopeSchema(SystemHealthSchema);
export const SystemVersionResponseSchema = successEnvelopeSchema(SystemVersionSchema);
export const SystemCapabilitiesResponseSchema = successEnvelopeSchema(SystemCapabilitiesSchema);

export const IntegrationCredentialMetadataSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(100),
    scopes: z.array(IntegrationScopeSchema).min(1),
    gameId: z.uuid().nullable(),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema.nullable(),
    lastUsedAt: TimestampSchema.nullable(),
    revokedAt: TimestampSchema.nullable()
  })
  .strict();

export const CreateIntegrationCredentialRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(IntegrationScopeSchema).min(1),
    gameId: z.uuid().nullable().optional(),
    expiresAt: TimestampSchema.nullable().optional()
  })
  .strict();

/** Present only in the single create/rotate response that issues it; never returned by list, audit, or any later read. */
export const IntegrationCredentialIssuedSchema = z
  .object({
    credential: IntegrationCredentialMetadataSchema,
    token: z.string().min(1)
  })
  .strict();

export const RotateIntegrationCredentialRequestSchema = z
  .object({
    /** Omit to keep the current expiration; pass null to clear it; pass a timestamp to set a new one. */
    expiresAt: TimestampSchema.nullable().optional()
  })
  .strict();

export const CredentialAuditEventTypeSchema = z.enum(["created", "used", "verification_failed", "rotated", "revoked"]);
export const CredentialAuditEventSchema = z
  .object({
    id: z.number().int().positive(),
    type: CredentialAuditEventTypeSchema,
    occurredAt: TimestampSchema,
    detail: z.record(z.string(), z.unknown())
  })
  .strict();

export const IntegrationCredentialListSchema = z
  .object({ credentials: z.array(IntegrationCredentialMetadataSchema) })
  .strict();
export const IntegrationCredentialAuditSchema = z.object({ events: z.array(CredentialAuditEventSchema) }).strict();

export const IntegrationCredentialResponseSchema = successEnvelopeSchema(IntegrationCredentialMetadataSchema);
export const IntegrationCredentialIssuedResponseSchema = successEnvelopeSchema(IntegrationCredentialIssuedSchema);
export const IntegrationCredentialListResponseSchema = successEnvelopeSchema(IntegrationCredentialListSchema);
export const IntegrationCredentialAuditResponseSchema = successEnvelopeSchema(IntegrationCredentialAuditSchema);

export const CommandEnvelopeSchema = z
  .object({
    protocolVersion: RealtimeProtocolVersionSchema,
    commandId: z.uuid(),
    type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
    expectedRevision: z.number().int().nonnegative().optional(),
    idempotencyKey: z.string().min(1).max(200),
    payload: z.record(z.string(), z.unknown())
  })
  .strict();

export const EventEnvelopeSchema = z
  .object({
    protocolVersion: RealtimeProtocolVersionSchema,
    eventId: z.uuid(),
    type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
    sequence: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    occurredAt: TimestampSchema,
    data: z.record(z.string(), z.unknown())
  })
  .strict();

// ---------- Live-game surface (GAME_PATHS / CONTENT_PATHS / ENCOUNTER_ARCHIVE_PATHS) ----------

export const GameCommandTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/)
  .max(200);

/** Each game command's typed HTTP route and the integration-credential scope it requires: the one source the
 * server's command table, its typed routes and the OpenAPI operations read. Types use the dot-separated form; the
 * Socket.IO event is the same name with its first `.` as `:`. */
export const GAME_COMMANDS = {
  "encounter.start": { scope: "combat:write", method: "post", path: GAME_PATHS.encounterStart },
  "encounter.end": { scope: "combat:write", method: "post", path: GAME_PATHS.encounterEnd },
  "encounter.add-combatant": { scope: "combat:write", method: "post", path: GAME_PATHS.encounterCombatants },
  "initiative.set": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeSet },
  "initiative.swap": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeSwap },
  "initiative.next": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeNext },
  "initiative.previous": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativePrevious },
  "initiative.roll-self": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeRollSelf },
  "initiative.roll-remaining": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeRollRemaining },
  "turn.end": { scope: "combat:write", method: "post", path: GAME_PATHS.turnEnd },
  "turn.use": { scope: "combat:write", method: "post", path: GAME_PATHS.turnUse },
  "turn.use-reaction": { scope: "combat:write", method: "post", path: GAME_PATHS.turnReaction },
  "turn.use-legendary": { scope: "combat:write", method: "post", path: GAME_PATHS.turnLegendary },
  "token.move": { scope: "combat:write", method: "post", path: GAME_PATHS.tokenMove },
  "actor.add-from-definition": { scope: "actor:write", method: "post", path: GAME_PATHS.actors },
  "actor.import-definition": { scope: "actor:write", method: "post", path: GAME_PATHS.definitionsImport },
  "character.submit-import": { scope: "actor:write", method: "post", path: GAME_PATHS.characterImports },
  "character.resolve-import": { scope: "actor:write", method: "post", path: GAME_PATHS.characterImportResolve },
  "actor.remove": { scope: "actor:write", method: "delete", path: GAME_PATHS.actorById },
  "actor.apply-damage": { scope: "actor:write", method: "post", path: GAME_PATHS.actorDamage },
  "actor.heal": { scope: "actor:write", method: "post", path: GAME_PATHS.actorHeal },
  "actor.set-temp-hp": { scope: "actor:write", method: "post", path: GAME_PATHS.actorTempHp },
  "actor.set-hp": { scope: "actor:write", method: "post", path: GAME_PATHS.actorHp },
  "actor.set-condition": { scope: "actor:write", method: "post", path: GAME_PATHS.actorConditions },
  "dice.roll": { scope: "roll:create", method: "post", path: GAME_PATHS.rolls },
  "action.resolve": { scope: "combat:write", method: "post", path: GAME_PATHS.actionResolve },
  "save.answer": { scope: "combat:write", method: "post", path: GAME_PATHS.saveAnswer },
  "save.dismiss": { scope: "combat:write", method: "post", path: GAME_PATHS.saveDismiss },
  "reaction.answer": { scope: "combat:write", method: "post", path: GAME_PATHS.reactionAnswer },
  "reaction.dismiss": { scope: "combat:write", method: "post", path: GAME_PATHS.reactionDismiss },
  "damage.resolve": { scope: "combat:write", method: "post", path: GAME_PATHS.damageResolve },
  "effect.add": { scope: "combat:write", method: "post", path: GAME_PATHS.effects },
  "effect.end": { scope: "combat:write", method: "post", path: GAME_PATHS.effectEnd },
  "death-save.roll": { scope: "combat:write", method: "post", path: GAME_PATHS.deathSaveRoll },
  "encounter.set-rules-mode": { scope: "combat:write", method: "post", path: GAME_PATHS.rulesMode },
  "rules.set-policy": { scope: "combat:write", method: "post", path: GAME_PATHS.rulesPolicy },
  "action.use": { scope: "combat:write", method: "post", path: GAME_PATHS.actionUse },
  "save.roll": { scope: "combat:write", method: "post", path: GAME_PATHS.saveRoll },
  "actor.set-heroic-inspiration": {
    scope: "actor:write",
    method: "post",
    path: GAME_PATHS.actorHeroicInspiration
  },
  "rules.ask": { scope: "combat:write", method: "post", path: GAME_PATHS.rulesAsk },
  "rules.answer": { scope: "combat:write", method: "post", path: GAME_PATHS.rulesAnswer },
  "table.set-staging-defaults": { scope: "combat:write", method: "post", path: GAME_PATHS.stagingDefaults },
  "table.set-party-visibility": { scope: "combat:write", method: "post", path: GAME_PATHS.partyVisibility },
  "encounter.set-player-damage-mode": { scope: "combat:write", method: "post", path: GAME_PATHS.playerDamageMode },
  "encounter.set-player-initiative-mode": {
    scope: "combat:write",
    method: "post",
    path: GAME_PATHS.playerInitiativeMode
  },
  "encounter.set-health-display": { scope: "combat:write", method: "post", path: GAME_PATHS.healthDisplay },
  "encounter.set-environment": { scope: "combat:write", method: "post", path: GAME_PATHS.environment },
  "actor.rest": { scope: "actor:write", method: "post", path: GAME_PATHS.actorRest },
  "actor.rechoose": { scope: "actor:write", method: "post", path: GAME_PATHS.actorRechoose },
  "actor.spend-hit-dice": { scope: "actor:write", method: "post", path: GAME_PATHS.actorSpendHitDice },
  "character.set-slot": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetSlot },
  "character.set-prepared": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetPrepared },
  "character.finish-preparing": {
    scope: "actor:write",
    method: "post",
    path: GAME_PATHS.characterFinishPreparing
  },
  "character.set-inventory": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetInventory },
  "character.give-item": { scope: "actor:write", method: "post", path: GAME_PATHS.characterGiveItem },
  "character.set-currency": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetCurrency },
  "character.set-identity": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetIdentity },
  "character.set-proficiencies": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetProficiencies },
  "character.create": { scope: "actor:write", method: "post", path: GAME_PATHS.characters },
  "character.save-draft": { scope: "actor:write", method: "post", path: GAME_PATHS.characterDraftSave },
  "character.discard-draft": { scope: "actor:write", method: "post", path: GAME_PATHS.characterDraftDiscard },
  "character.generate": { scope: "actor:write", method: "post", path: GAME_PATHS.charactersRandom },
  "builder.set-policy": { scope: "actor:write", method: "post", path: GAME_PATHS.builderPolicy },
  "annotation.add": { scope: "combat:write", method: "post", path: GAME_PATHS.annotations },
  "annotation.ping": { scope: "combat:write", method: "post", path: GAME_PATHS.annotationsPing },
  "annotation.move": { scope: "combat:write", method: "post", path: GAME_PATHS.annotationMove },
  "annotation.remove": { scope: "combat:write", method: "delete", path: GAME_PATHS.annotationById },
  "annotation.set-color": { scope: "combat:write", method: "post", path: GAME_PATHS.annotationColor },
  "annotation.set-visibility": { scope: "combat:write", method: "post", path: GAME_PATHS.annotationVisibility },
  "annotation.set-movable": { scope: "combat:write", method: "post", path: GAME_PATHS.annotationMovable },
  "annotation.clear": { scope: "combat:write", method: "post", path: GAME_PATHS.annotationsClear },
  "character.claim": { scope: "actor:write", method: "post", path: GAME_PATHS.claims },
  "character.release": { scope: "actor:write", method: "post", path: GAME_PATHS.claimsRelease },
  "character.force-release": { scope: "actor:write", method: "post", path: GAME_PATHS.claimForceRelease },
  "actor.set-token-image": { scope: "actor:write", method: "post", path: GAME_PATHS.actorTokenImage },
  "actor.set-size": { scope: "actor:write", method: "post", path: GAME_PATHS.actorSize },
  "actor.set-health-display": { scope: "actor:write", method: "post", path: GAME_PATHS.actorHealthDisplay },
  "actor.set-visibility": { scope: "actor:write", method: "post", path: GAME_PATHS.actorVisibility },
  "actor.set-archived": { scope: "actor:write", method: "post", path: GAME_PATHS.actorArchived },
  "actor.set-sheet-preview": { scope: "actor:write", method: "post", path: GAME_PATHS.actorSheetPreview },
  "actor.set-speed": { scope: "actor:write", method: "post", path: GAME_PATHS.actorSpeed },
  "actor.set-armor-class": { scope: "actor:write", method: "post", path: GAME_PATHS.actorArmorClass },
  "scene.create": { scope: "scene:write", method: "post", path: GAME_PATHS.scenes },
  "scene.rename": { scope: "scene:write", method: "post", path: GAME_PATHS.sceneRename },
  "scene.remove": { scope: "scene:write", method: "delete", path: GAME_PATHS.sceneById },
  "scene.activate": { scope: "scene:write", method: "post", path: GAME_PATHS.sceneActivate },
  "scene.set-combatants": { scope: "scene:write", method: "post", path: GAME_PATHS.sceneCombatants },
  "scene.duplicate": { scope: "scene:write", method: "post", path: GAME_PATHS.sceneDuplicate },
  "scene.reorder": { scope: "scene:write", method: "post", path: GAME_PATHS.sceneReorder },
  "replay.launch": { scope: "combat:write", method: "post", path: ENCOUNTER_ARCHIVE_PATHS.launch },
  "character.rebuild": { scope: "actor:write", method: "post", path: GAME_PATHS.characterRebuild },
  "builder.roll-abilities": { scope: "actor:write", method: "post", path: GAME_PATHS.builderRollAbilities },
  "fog.set-enabled": { scope: "scene:write", method: "post", path: GAME_PATHS.fogEnabled },
  "fog.paint": { scope: "scene:write", method: "post", path: GAME_PATHS.fogPaint },
  "fog.reset": { scope: "scene:write", method: "post", path: GAME_PATHS.fogReset },
  "terrain.paint": { scope: "scene:write", method: "post", path: GAME_PATHS.terrainPaint },
  "terrain.reset": { scope: "scene:write", method: "post", path: GAME_PATHS.terrainReset }
} as const satisfies Record<
  string,
  Readonly<{ scope: z.infer<typeof IntegrationScopeSchema>; method: "post" | "delete"; path: string }>
>;
export type GameCommandType = keyof typeof GAME_COMMANDS;

/** The generic command tunnel's request (dot-separated command types). `commandId` is the idempotency key: resend
 * it to retry safely; omit it and the server mints one. */
export const GameCommandEnvelopeSchema = z
  .object({
    type: GameCommandTypeSchema,
    commandId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    payload: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

/** Every accepted mutation resolves to at least this; individual commands append extras (rollId, actorId, resolution, ...). */
export const GameMutationAcceptedSchema = z
  .object({
    commandId: z.uuid(),
    revision: z.number().int().nonnegative(),
    duplicate: z.boolean()
  })
  .catchall(z.unknown());

export const GameViewKindSchema = z.enum(["gm", "player"]);
/** The projection envelope for GET /game. `game` is the full GM view or the player-safe view - shapes owned by @vtt/domain and not duplicated here. */
export const GameSnapshotSchema = z
  .object({
    view: GameViewKindSchema,
    revision: z.number().int().nonnegative(),
    game: z.record(z.string(), z.unknown())
  })
  .strict();

/** `kind` stays an open string so new log kinds are additive, not breaking. */
export const GameLogEntrySchema = z
  .object({
    id: z.number().int().positive(),
    at: TimestampSchema,
    kind: z.string().min(1).max(40),
    text: z.string(),
    gmOnly: z.boolean(),
    revision: z.number().int().nonnegative()
  })
  .strict();
export const GameLogSchema = z.object({ entries: z.array(GameLogEntrySchema) }).strict();

export const GameCommandDescriptorSchema = z
  .object({
    type: GameCommandTypeSchema,
    scope: IntegrationScopeSchema,
    summary: z.string().min(1).max(300)
  })
  .strict();
export const GameCommandCatalogSchema = z.object({ commands: z.array(GameCommandDescriptorSchema) }).strict();

export const EncounterArchiveSummarySchema = z
  .object({
    id: z.number().int().positive(),
    archivedAt: TimestampSchema,
    startedAt: TimestampSchema.nullable(),
    endedAt: TimestampSchema,
    turnCount: z.number().int().nonnegative(),
    /** Has the GM shared this record with players? False until the GM does. */
    playerVisible: z.boolean()
  })
  .strict();
export const EncounterArchiveListSchema = z.object({ encounters: z.array(EncounterArchiveSummarySchema) }).strict();
export const EncounterArchiveVisibilitySchema = z
  .object({ id: z.number().int().positive(), playerVisible: z.boolean() })
  .strict();
/** `document` is the stored archive JSON verbatim (archiveSchemaVersion 3); its full shape is documented in apps/server/src/encounter-archive.ts. */
export const EncounterArchiveDocumentSchema = z
  .object({ id: z.number().int().positive(), document: z.record(z.string(), z.unknown()) })
  .strict();
/** What `POST /encounters/{id}/launch` returns: the new live scene and the combatants it cloned. */
export const EncounterArchiveLaunchSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    duplicate: z.boolean(),
    sceneId: z.string(),
    actorIds: z.array(z.string())
  })
  .strict();
export const EncounterArchiveDeletedSchema = z
  .object({ id: z.number().int().positive(), deleted: z.literal(true) })
  .strict();

/** Issued by POST /sessions/player - the same open, LAN-trust join the socket performs. */
export const PlayerSessionIssuedSchema = z.object({ token: z.string().min(1), sessionId: z.uuid() }).strict();

export const GameMutationAcceptedResponseSchema = successEnvelopeSchema(GameMutationAcceptedSchema);
export const GameSnapshotResponseSchema = successEnvelopeSchema(GameSnapshotSchema);
export const GameLogResponseSchema = successEnvelopeSchema(GameLogSchema);
export const GameCommandCatalogResponseSchema = successEnvelopeSchema(GameCommandCatalogSchema);
export const EncounterArchiveListResponseSchema = successEnvelopeSchema(EncounterArchiveListSchema);
export const EncounterArchiveDocumentResponseSchema = successEnvelopeSchema(EncounterArchiveDocumentSchema);
export const EncounterArchiveDeletedResponseSchema = successEnvelopeSchema(EncounterArchiveDeletedSchema);
export const EncounterArchiveVisibilityResponseSchema = successEnvelopeSchema(EncounterArchiveVisibilitySchema);
export const EncounterArchiveLaunchResponseSchema = successEnvelopeSchema(EncounterArchiveLaunchSchema);
export const PlayerSessionIssuedResponseSchema = successEnvelopeSchema(PlayerSessionIssuedSchema);

// ---- Homebrew authoring wire shapes (HOMEBREW_PATHS / homebrew-http.ts). GM-only end to end.
// Each is mirrored by a hand-written OpenAPI component below; `test/contract-parity.test.ts` checks both directions.

/**
 * The authorable homebrew types. `class-feature` is absent because features are authored inside their class or
 * subclass. `spell-list` exists because a homebrew caster needs a list to draw from.
 */
export const HomebrewContentTypeSchema = z.enum([
  "class",
  "subclass",
  "species",
  "background",
  "feat",
  "spell",
  "equipment",
  "monster",
  "spell-list"
]);
/** Set only by `/publish` and `/unpublish`; orthogonal to `visibleToPlayers`, which only `/visibility` sets. */
export const HomebrewContentStateSchema = z.enum(["draft", "published"]);
/** A persisted homebrew id (`hb-<slug>-<6 hex>`). Capped at 60, not 80: persisted ActorDefinition ids cap at 60,
 * and a longer one would fail `GameStateSchema.parse` on the next boot. */
const HomebrewIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(60);
/** The offending field, machine-addressable, so a form editor can point at it instead of parsing prose. */
export const HomebrewValidationIssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number().int()])),
    message: z.string().min(1).max(500),
    recordId: HomebrewIdSchema.nullable()
  })
  .strict();
/** `warnings` never block publishing: an open slug the SRD does not know, which is legal but often a typo. */
export const HomebrewValiditySchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(HomebrewValidationIssueSchema),
    warnings: z.array(HomebrewValidationIssueSchema)
  })
  .strict();
/** The authored content body only - never row state. Opaque until each type's authored shape lands; see the HomebrewRecord component. */
export const HomebrewRecordSchema = z.record(z.string(), z.unknown());
export const HomebrewRecordDocumentSchema = z
  .object({
    id: HomebrewIdSchema,
    type: HomebrewContentTypeSchema,
    state: HomebrewContentStateSchema,
    visibleToPlayers: z.boolean(),
    deletedAt: TimestampSchema.nullable(),
    rev: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    validity: HomebrewValiditySchema,
    /** A published record has edits that are not live yet; `record` and `validity` describe them. */
    pendingChanges: z.boolean(),
    record: HomebrewRecordSchema
  })
  .strict();
/** The flat, NON-polymorphic list row: a name and a badge, so the union stays out of the library's hot path. */
export const HomebrewRecordSummarySchema = z
  .object({
    id: HomebrewIdSchema,
    type: HomebrewContentTypeSchema,
    name: z.string().min(1).max(120),
    source: z.literal("homebrew"),
    state: HomebrewContentStateSchema,
    visibleToPlayers: z.boolean(),
    deletedAt: TimestampSchema.nullable(),
    rev: z.number().int().nonnegative(),
    updatedAt: TimestampSchema,
    valid: z.boolean(),
    usageCount: z.number().int().nonnegative()
  })
  .strict();
export const HomebrewContentListSchema = z
  .object({
    records: z.array(HomebrewRecordSummarySchema),
    nextCursor: z.string().max(200).nullable(),
    total: z.number().int().nonnegative()
  })
  .strict();
export const HomebrewContentSchema = z.object({ record: HomebrewRecordDocumentSchema }).strict();
export const HomebrewDeletedSchema = z
  .object({ id: HomebrewIdSchema, deleted: z.literal(true), deletedAt: TimestampSchema })
  .strict();
export const HomebrewUsageSchema = z
  .object({
    actorId: z.uuid(),
    actorName: z.string().min(1).max(200),
    kind: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60),
    detail: z.string().max(300).nullable()
  })
  .strict();
/** A published record that is publishable now and would stop being so. */
export const HomebrewDependentSchema = z
  .object({ id: HomebrewIdSchema, type: HomebrewContentTypeSchema, name: z.string().min(1).max(120) })
  .strict();
export const HomebrewUsagesSchema = z
  .object({
    id: HomebrewIdSchema,
    usages: z.array(HomebrewUsageSchema),
    /** False when removing this record would break a published one; built characters never break. */
    safeToDelete: z.boolean(),
    dependents: z
      .object({
        /** Broken by removing or unpublishing this record. */
        ifRemoved: z.array(HomebrewDependentSchema),
        /** Broken by putting this record's pending edits live; empty when nothing is pending. */
        ifUpdated: z.array(HomebrewDependentSchema)
      })
      .strict()
  })
  .strict();
/** The GM-to-GM interchange format: authored bodies only, so an import can never inherit the exporter's visibility policy. */
export const HomebrewPackSchema = z
  .object({
    schemaId: z.literal("vtt.homebrew-pack"),
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(120),
    attribution: z.string().max(400).nullable(),
    exportedAt: TimestampSchema,
    records: z.array(HomebrewRecordSchema)
  })
  .strict();
export const HomebrewPackExportSchema = z.object({ pack: HomebrewPackSchema }).strict();
export const HomebrewPackImportSchema = z
  .object({
    imported: z.array(
      z
        .object({
          id: HomebrewIdSchema,
          type: HomebrewContentTypeSchema,
          name: z.string().min(1).max(120),
          originalId: HomebrewIdSchema
        })
        .strict()
    ),
    reminted: z.array(
      z
        .object({
          originalId: HomebrewIdSchema,
          id: HomebrewIdSchema,
          /** srd-collision: outside `hb-`, the bundle's namespace; homebrew-collision: an existing row or an
           *  earlier record in this pack holds it; foreign-shape: an `hb-` id not shaped as this table mints. */
          reason: z.enum(["srd-collision", "homebrew-collision", "foreign-shape"])
        })
        .strict()
    ),
    overwritten: z.array(
      z.object({ id: HomebrewIdSchema, type: HomebrewContentTypeSchema, name: z.string().min(1).max(120) }).strict()
    ),
    rejected: z.array(
      z.object({ originalId: HomebrewIdSchema, issues: z.array(HomebrewValidationIssueSchema) }).strict()
    ),
    dryRun: z.boolean()
  })
  .strict();
export const HomebrewCreateRequestSchema = z.object({ record: HomebrewRecordSchema }).strict();
export const HomebrewUpdateRequestSchema = z
  .object({ record: HomebrewRecordSchema, expectedRev: z.number().int().nonnegative().optional() })
  .strict();
export const HomebrewDuplicateRequestSchema = z.object({ name: z.string().min(1).max(120).optional() }).strict();
export const HomebrewStateChangeRequestSchema = z
  .object({ expectedRev: z.number().int().nonnegative().optional() })
  .strict();
export const HomebrewVisibilityRequestSchema = z
  .object({ visibleToPlayers: z.boolean(), expectedRev: z.number().int().nonnegative().optional() })
  .strict();
export const HomebrewPackImportRequestSchema = z
  .object({
    pack: HomebrewPackSchema,
    onIdCollision: z.enum(["remint", "overwrite"]).default("remint"),
    dryRun: z.boolean().default(false)
  })
  .strict();

export const HomebrewContentListResponseSchema = successEnvelopeSchema(HomebrewContentListSchema);
export const HomebrewContentResponseSchema = successEnvelopeSchema(HomebrewContentSchema);
export const HomebrewDeletedResponseSchema = successEnvelopeSchema(HomebrewDeletedSchema);
export const HomebrewUsagesResponseSchema = successEnvelopeSchema(HomebrewUsagesSchema);
export const HomebrewPackExportResponseSchema = successEnvelopeSchema(HomebrewPackExportSchema);
export const HomebrewPackImportResponseSchema = successEnvelopeSchema(HomebrewPackImportSchema);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type IntegrationScope = z.infer<typeof IntegrationScopeSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
export type SystemVersion = z.infer<typeof SystemVersionSchema>;
export type SystemCapabilities = z.infer<typeof SystemCapabilitiesSchema>;
export type IntegrationCredentialMetadata = z.infer<typeof IntegrationCredentialMetadataSchema>;
export type CreateIntegrationCredentialRequest = z.infer<typeof CreateIntegrationCredentialRequestSchema>;
export type IntegrationCredentialIssued = z.infer<typeof IntegrationCredentialIssuedSchema>;
export type RotateIntegrationCredentialRequest = z.infer<typeof RotateIntegrationCredentialRequestSchema>;
export type CredentialAuditEventType = z.infer<typeof CredentialAuditEventTypeSchema>;
export type CredentialAuditEvent = z.infer<typeof CredentialAuditEventSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type GameCommandEnvelope = z.infer<typeof GameCommandEnvelopeSchema>;
export type GameMutationAccepted = z.infer<typeof GameMutationAcceptedSchema>;
export type GameViewKind = z.infer<typeof GameViewKindSchema>;
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;
export type GameLogEntry = z.infer<typeof GameLogEntrySchema>;
export type GameCommandDescriptor = z.infer<typeof GameCommandDescriptorSchema>;
export type EncounterArchiveSummary = z.infer<typeof EncounterArchiveSummarySchema>;
export type HomebrewContentType = z.infer<typeof HomebrewContentTypeSchema>;
export type HomebrewContentState = z.infer<typeof HomebrewContentStateSchema>;
export type HomebrewValidationIssue = z.infer<typeof HomebrewValidationIssueSchema>;
export type HomebrewValidity = z.infer<typeof HomebrewValiditySchema>;
export type HomebrewRecordDocument = z.infer<typeof HomebrewRecordDocumentSchema>;
export type HomebrewRecordSummary = z.infer<typeof HomebrewRecordSummarySchema>;
export type HomebrewContentList = z.infer<typeof HomebrewContentListSchema>;
export type HomebrewUsages = z.infer<typeof HomebrewUsagesSchema>;
export type HomebrewPack = z.infer<typeof HomebrewPackSchema>;
export type HomebrewPackImport = z.infer<typeof HomebrewPackImportSchema>;
