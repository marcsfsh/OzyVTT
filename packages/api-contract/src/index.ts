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
export const INTEGRATION_CREDENTIAL_PATHS = {
  collection: `${API_NAMESPACE}/gm/integration-credentials`,
  rotate: `${API_NAMESPACE}/gm/integration-credentials/{id}/rotate`,
  revoke: `${API_NAMESPACE}/gm/integration-credentials/{id}/revoke`,
  audit: `${API_NAMESPACE}/gm/integration-credentials/{id}/audit`
} as const;

/**
 * Documentation-only path constants for `map-http.ts`'s already-shipped router (mounted
 * separately from `api-v1.ts`). Kept here so the served OpenAPI document matches the real,
 * running routes; the router itself keeps its own literal path strings rather than importing
 * these, since the two use different templating (`:id` vs `{id}`).
 */
export const MAP_ASSET_PATHS = {
  collection: `${API_NAMESPACE}/map-assets`,
  byId: `${API_NAMESPACE}/map-assets/{id}`,
  content: `${API_NAMESPACE}/map-assets/{id}/content`,
  scale: `${API_NAMESPACE}/map-assets/{id}/scale`,
  calibrationWizards: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards`,
  calibrationWizardActions: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/actions`,
  calibrationWizardComplete: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/complete`
} as const;

/** Documentation-only path constants for `viewer-http.ts`'s already-shipped router. See the note on MAP_ASSET_PATHS. */
export const VIEWER_PATHS = {
  pairings: `${API_NAMESPACE}/viewer/pairings`,
  pairingsExchange: `${API_NAMESPACE}/viewer/pairings/exchange`,
  access: `${API_NAMESPACE}/viewer/access`,
  accessById: `${API_NAMESPACE}/viewer/access/{id}`,
  presentation: `${API_NAMESPACE}/viewer/presentation`,
  presentationCommands: `${API_NAMESPACE}/viewer/presentation/commands`,
  events: `${API_NAMESPACE}/viewer/events`
} as const;

/**
 * The live-game integration surface (`game-http.ts`): reads project per principal, writes dispatch
 * through the exact same operations the built-in UI's Socket.IO commands use (ADR-0016 - adapters,
 * never forks). `{param}` is OpenAPI-style; the Express router substitutes `:param`.
 */
export const GAME_PATHS = {
  snapshot: `${API_NAMESPACE}/game`,
  log: `${API_NAMESPACE}/game/log`,
  commands: `${API_NAMESPACE}/game/commands`,
  encounterStart: `${API_NAMESPACE}/game/encounter/start`,
  encounterEnd: `${API_NAMESPACE}/game/encounter/end`,
  encounterCombatants: `${API_NAMESPACE}/game/encounter/combatants`,
  initiativeSet: `${API_NAMESPACE}/game/initiative/set`,
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
  rolls: `${API_NAMESPACE}/game/rolls`,
  actionResolve: `${API_NAMESPACE}/game/actions/resolve`,
  saveAnswer: `${API_NAMESPACE}/game/saves/{saveId}/answer`,
  saveDismiss: `${API_NAMESPACE}/game/saves/{saveId}/dismiss`,
  reactionAnswer: `${API_NAMESPACE}/game/reactions/{reactionId}/answer`,
  reactionDismiss: `${API_NAMESPACE}/game/reactions/{reactionId}/dismiss`,
  actorAvailableActions: `${API_NAMESPACE}/game/actors/{actorId}/available-actions`,
  effects: `${API_NAMESPACE}/game/actors/{actorId}/effects`,
  effectEnd: `${API_NAMESPACE}/game/actors/{actorId}/effects/{effectId}/end`,
  deathSaveRoll: `${API_NAMESPACE}/game/actors/{actorId}/death-save`,
  rulesMode: `${API_NAMESPACE}/game/encounter/rules-mode`,
  rollMode: `${API_NAMESPACE}/game/encounter/roll-mode`,
  healthDisplay: `${API_NAMESPACE}/game/encounter/health-display`,
  environment: `${API_NAMESPACE}/game/encounter/environment`,
  actorRest: `${API_NAMESPACE}/game/actors/{actorId}/rest`,
  actorSpendHitDice: `${API_NAMESPACE}/game/actors/{actorId}/spend-hit-dice`,
  characterSetSlot: `${API_NAMESPACE}/game/actors/{actorId}/spell-slot`,
  characterSetPrepared: `${API_NAMESPACE}/game/actors/{actorId}/prepared-spell`,
  characterSetInventory: `${API_NAMESPACE}/game/actors/{actorId}/inventory`,
  characterSetCurrency: `${API_NAMESPACE}/game/actors/{actorId}/currency`,
  characterSetIdentity: `${API_NAMESPACE}/game/actors/{actorId}/identity`,
  characterSetProficiencies: `${API_NAMESPACE}/game/actors/{actorId}/proficiencies`,
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
  actorHealthDisplay: `${API_NAMESPACE}/game/actors/{actorId}/health-display`,
  actorSpeed: `${API_NAMESPACE}/game/actors/{actorId}/speed`,
  scenes: `${API_NAMESPACE}/game/scenes`,
  sceneById: `${API_NAMESPACE}/game/scenes/{sceneId}`,
  sceneRename: `${API_NAMESPACE}/game/scenes/{sceneId}/rename`,
  sceneActivate: `${API_NAMESPACE}/game/scenes/{sceneId}/activate`,
  sceneCombatants: `${API_NAMESPACE}/game/scenes/{sceneId}/combatants`,
  sceneDuplicate: `${API_NAMESPACE}/game/scenes/{sceneId}/duplicate`,
  sceneReorder: `${API_NAMESPACE}/game/scenes/reorder`,
  fogEnabled: `${API_NAMESPACE}/game/fog/enabled`,
  fogPaint: `${API_NAMESPACE}/game/fog/paint`,
  fogReset: `${API_NAMESPACE}/game/fog/reset`
} as const;

/** Session issuance for headless/alternate player clients: the HTTP mirror of the socket's open join. */
export const SESSION_PATHS = {
  player: `${API_NAMESPACE}/sessions/player`
} as const;

/** Bundled SRD reference content (read-only; GM-grade except conditions, which any session may read). */
export const CONTENT_PATHS = {
  monsters: `${API_NAMESPACE}/content/monsters`,
  monsterById: `${API_NAMESPACE}/content/monsters/{definitionId}`,
  monsterActions: `${API_NAMESPACE}/content/monsters/{definitionId}/actions`,
  conditions: `${API_NAMESPACE}/content/conditions`
} as const;

/** Permanent Time Machine records of ended encounters (archiveSchemaVersion 3). GM-grade only: documents hold full state. */
export const ENCOUNTER_ARCHIVE_PATHS = {
  collection: `${API_NAMESPACE}/encounters`,
  byId: `${API_NAMESPACE}/encounters/{id}`
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
  "events:read",
  "webhooks:manage",
  "admin"
]);

const ApiVersionSchema = z.literal(API_VERSION);
const RealtimeProtocolVersionSchema = z.literal(REALTIME_PROTOCOL_VERSION);
const TimestampSchema = z.string().datetime({ offset: true });

export function successEnvelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ ok: z.literal(true), apiVersion: ApiVersionSchema, data }).strict();
}

export const ApiErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  apiVersion: ApiVersionSchema,
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: z.string().uuid(),
    details: z.record(z.unknown()).optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
    currentRevision: z.number().int().nonnegative().optional()
  }).strict()
}).strict();

export const SystemHealthSchema = z.object({
  status: z.literal("ok"),
  serverTime: TimestampSchema
}).strict();

export const SystemVersionSchema = z.object({
  applicationVersion: z.string().min(1),
  apiVersion: ApiVersionSchema,
  realtimeProtocolVersion: RealtimeProtocolVersionSchema,
  schemaVersions: z.object({ actorDefinition: z.number().int().positive() }).strict()
}).strict();

export const SystemCapabilitiesSchema = z.object({
  api: z.object({ version: ApiVersionSchema, namespace: z.literal(API_NAMESPACE) }).strict(),
  realtime: z.object({ protocolVersion: RealtimeProtocolVersionSchema, transport: z.literal("socket.io") }).strict(),
  supportedScopes: z.array(IntegrationScopeSchema),
  features: z.object({
    webhooks: z.boolean(),
    viewer: z.boolean(),
    battlemapGridCalibration: z.boolean(),
    /** The live-game REST surface under /game plus /content and /encounters. */
    gameApi: z.boolean(),
    /** The generic POST /game/commands tunnel + its GET catalog. */
    commandTunnel: z.boolean(),
    /** Permanent archives of ended encounters (Time Machine v2 documents). */
    encounterArchives: z.boolean()
  , rulesEngine: z.boolean() }).strict()
}).strict();

export const SystemHealthResponseSchema = successEnvelopeSchema(SystemHealthSchema);
export const SystemVersionResponseSchema = successEnvelopeSchema(SystemVersionSchema);
export const SystemCapabilitiesResponseSchema = successEnvelopeSchema(SystemCapabilitiesSchema);

export const IntegrationCredentialMetadataSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  scopes: z.array(IntegrationScopeSchema).min(1),
  gameId: z.string().uuid().nullable(),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  lastUsedAt: TimestampSchema.nullable(),
  revokedAt: TimestampSchema.nullable()
}).strict();

export const CreateIntegrationCredentialRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(IntegrationScopeSchema).min(1),
  gameId: z.string().uuid().nullable().optional(),
  expiresAt: TimestampSchema.nullable().optional()
}).strict();

/** Present only in the single create/rotate response that issues it; never returned by list, audit, or any later read. */
export const IntegrationCredentialIssuedSchema = z.object({
  credential: IntegrationCredentialMetadataSchema,
  token: z.string().min(1)
}).strict();

export const RotateIntegrationCredentialRequestSchema = z.object({
  /** Omit to keep the current expiration; pass null to clear it; pass a timestamp to set a new one. */
  expiresAt: TimestampSchema.nullable().optional()
}).strict();

export const CredentialAuditEventTypeSchema = z.enum(["created", "used", "verification_failed", "rotated", "revoked"]);
export const CredentialAuditEventSchema = z.object({
  id: z.number().int().positive(),
  type: CredentialAuditEventTypeSchema,
  occurredAt: TimestampSchema,
  detail: z.record(z.unknown())
}).strict();

export const IntegrationCredentialListSchema = z.object({ credentials: z.array(IntegrationCredentialMetadataSchema) }).strict();
export const IntegrationCredentialAuditSchema = z.object({ events: z.array(CredentialAuditEventSchema) }).strict();

export const IntegrationCredentialResponseSchema = successEnvelopeSchema(IntegrationCredentialMetadataSchema);
export const IntegrationCredentialIssuedResponseSchema = successEnvelopeSchema(IntegrationCredentialIssuedSchema);
export const IntegrationCredentialListResponseSchema = successEnvelopeSchema(IntegrationCredentialListSchema);
export const IntegrationCredentialAuditResponseSchema = successEnvelopeSchema(IntegrationCredentialAuditSchema);

export const CommandEnvelopeSchema = z.object({
  protocolVersion: RealtimeProtocolVersionSchema,
  commandId: z.string().uuid(),
  type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  expectedRevision: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).max(200),
  payload: z.record(z.unknown())
}).strict();

export const EventEnvelopeSchema = z.object({
  protocolVersion: RealtimeProtocolVersionSchema,
  eventId: z.string().uuid(),
  type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  sequence: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  occurredAt: TimestampSchema,
  data: z.record(z.unknown())
}).strict();

// ---------- Live-game surface (GAME_PATHS / CONTENT_PATHS / ENCOUNTER_ARCHIVE_PATHS) ----------

export const GameCommandTypeSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/).max(200);

/**
 * The single source of each game command's required integration-credential scope - part of the
 * public contract. The server's command registry (tunnel + typed routes) enforces exactly these at
 * runtime, the OpenAPI operations above declare them per route, and tests on both sides pin the
 * three views together. Command types use the store's dot-separated receipt form.
 */
export const GAME_COMMAND_SCOPES = {
  "encounter.start": "combat:write",
  "encounter.end": "combat:write",
  "encounter.add-combatant": "combat:write",
  "initiative.set": "combat:write",
  "initiative.next": "combat:write",
  "initiative.previous": "combat:write",
  "turn.end": "combat:write",
  "turn.use": "combat:write",
  "turn.use-reaction": "combat:write",
  "turn.use-legendary": "combat:write",
  "token.move": "combat:write",
  "actor.add-from-definition": "actor:write",
  "actor.import-definition": "actor:write",
  "actor.remove": "actor:write",
  "actor.apply-damage": "actor:write",
  "actor.heal": "actor:write",
  "actor.set-temp-hp": "actor:write",
  "actor.set-hp": "actor:write",
  "actor.set-condition": "actor:write",
  "dice.roll": "roll:create",
  "action.resolve": "combat:write",
  "save.answer": "combat:write",
  "save.dismiss": "combat:write",
  "reaction.answer": "combat:write",
  "reaction.dismiss": "combat:write",
  "effect.add": "combat:write",
  "effect.end": "combat:write",
  "death-save.roll": "combat:write",
  "encounter.set-rules-mode": "combat:write",
  "encounter.set-roll-mode": "combat:write",
  "encounter.set-health-display": "combat:write",
  "encounter.set-environment": "combat:write",
  "actor.rest": "actor:write",
  "actor.spend-hit-dice": "actor:write",
  "character.set-slot": "actor:write",
  "character.set-prepared": "actor:write",
  "character.set-inventory": "actor:write",
  "character.set-currency": "actor:write",
  "character.set-identity": "actor:write",
  "character.set-proficiencies": "actor:write",
  "annotation.add": "combat:write",
  "annotation.ping": "combat:write",
  "annotation.move": "combat:write",
  "annotation.remove": "combat:write",
  "annotation.set-color": "combat:write",
  "annotation.set-visibility": "combat:write",
  "annotation.set-movable": "combat:write",
  "annotation.clear": "combat:write",
  "character.claim": "actor:write",
  "character.release": "actor:write",
  "character.force-release": "actor:write",
  "actor.set-token-image": "actor:write",
  "actor.set-size": "actor:write",
  "actor.set-health-display": "actor:write",
  "actor.set-visibility": "actor:write",
  "actor.set-archived": "actor:write",
  "actor.set-speed": "actor:write",
  "scene.create": "scene:write",
  "scene.rename": "scene:write",
  "scene.remove": "scene:write",
  "scene.activate": "scene:write",
  "scene.set-combatants": "scene:write",
  "scene.duplicate": "scene:write",
  "scene.reorder": "scene:write",
  "fog.set-enabled": "scene:write",
  "fog.paint": "scene:write",
  "fog.reset": "scene:write"
} as const satisfies Record<string, z.infer<typeof IntegrationScopeSchema>>;
export type GameCommandType = keyof typeof GAME_COMMAND_SCOPES;

/**
 * The generic command tunnel's request: the same dot-separated command types the realtime protocol
 * and the store's receipts use. `commandId` is the idempotency identity - resend the same one to
 * retry safely; omit it and the server mints one (returned in the response).
 */
export const GameCommandEnvelopeSchema = z.object({
  type: GameCommandTypeSchema,
  commandId: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  payload: z.record(z.unknown()).default({})
}).strict();

/** Every accepted mutation resolves to at least this; individual commands append extras (rollId, actorId, resolution, ...). */
export const GameMutationAcceptedSchema = z.object({
  commandId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  duplicate: z.boolean()
}).catchall(z.unknown());

export const GameViewKindSchema = z.enum(["gm", "player"]);
/** The projection envelope for GET /game. `game` is the full GM view or the player-safe view - shapes owned by @vtt/domain and deliberately not duplicated here. */
export const GameSnapshotSchema = z.object({
  view: GameViewKindSchema,
  revision: z.number().int().nonnegative(),
  game: z.record(z.unknown())
}).strict();

/** `kind` stays an open string so new log kinds are additive, not breaking. */
export const GameLogEntrySchema = z.object({
  id: z.number().int().positive(),
  at: TimestampSchema,
  kind: z.string().min(1).max(40),
  text: z.string(),
  gmOnly: z.boolean(),
  revision: z.number().int().nonnegative()
}).strict();
export const GameLogSchema = z.object({ entries: z.array(GameLogEntrySchema) }).strict();

export const GameCommandDescriptorSchema = z.object({
  type: GameCommandTypeSchema,
  scope: IntegrationScopeSchema,
  summary: z.string().min(1).max(300)
}).strict();
export const GameCommandCatalogSchema = z.object({ commands: z.array(GameCommandDescriptorSchema) }).strict();

export const EncounterArchiveSummarySchema = z.object({
  id: z.number().int().positive(),
  archivedAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  endedAt: TimestampSchema,
  turnCount: z.number().int().nonnegative()
}).strict();
export const EncounterArchiveListSchema = z.object({ encounters: z.array(EncounterArchiveSummarySchema) }).strict();
/** `document` is the stored archive JSON verbatim (archiveSchemaVersion 3); its full shape is documented in apps/server/src/encounter-archive.ts. */
export const EncounterArchiveDocumentSchema = z.object({ id: z.number().int().positive(), document: z.record(z.unknown()) }).strict();
export const EncounterArchiveDeletedSchema = z.object({ id: z.number().int().positive(), deleted: z.literal(true) }).strict();

/** Issued by POST /sessions/player - the same open, LAN-trust join the socket performs. */
export const PlayerSessionIssuedSchema = z.object({ token: z.string().min(1), sessionId: z.string().uuid() }).strict();

export const GameMutationAcceptedResponseSchema = successEnvelopeSchema(GameMutationAcceptedSchema);
export const GameSnapshotResponseSchema = successEnvelopeSchema(GameSnapshotSchema);
export const GameLogResponseSchema = successEnvelopeSchema(GameLogSchema);
export const GameCommandCatalogResponseSchema = successEnvelopeSchema(GameCommandCatalogSchema);
export const EncounterArchiveListResponseSchema = successEnvelopeSchema(EncounterArchiveListSchema);
export const EncounterArchiveDocumentResponseSchema = successEnvelopeSchema(EncounterArchiveDocumentSchema);
export const EncounterArchiveDeletedResponseSchema = successEnvelopeSchema(EncounterArchiveDeletedSchema);
export const PlayerSessionIssuedResponseSchema = successEnvelopeSchema(PlayerSessionIssuedSchema);

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

const envelopeSchema = (dataRef: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["ok", "apiVersion", "data"],
  properties: {
    ok: { const: true },
    apiVersion: { const: API_VERSION },
    data: { $ref: dataRef }
  }
});

// Builders for the live-game operations, which all share one response/security shape. Used inside
// openApiDocument below, so the served document stays a single self-contained literal.
const apiError = { $ref: "#/components/responses/ApiError" } as const;
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const jsonBody = (schemaRef: string, required = true) => ({ required, content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaRef}` } } } });
/** Accepted principals: an integration credential with the given scope, or a GM session - as HTTP bearer tokens. */
const gameSecurity = (scope: IntegrationScope) => [{ bearerAuth: [scope] }, { gmAuth: [] }];
/** Operations a player session can genuinely use (within its own-character limits) additionally list playerAuth. */
const gameSecurityWithPlayer = (scope: IntegrationScope) => [{ bearerAuth: [scope] }, { gmAuth: [] }, { playerAuth: [] }];
const mutationResponses = {
  "200": { description: "Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed", content: { "application/json": { schema: { $ref: "#/components/schemas/GameMutationAcceptedResponse" } } } },
  "400": apiError,
  "401": apiError,
  "403": apiError,
  "409": { description: "Rejected by the game rules, a stale expectedRevision (`error.currentRevision` set), or a timeline navigation needing GM confirmation (`error.details.needsConfirm`)", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } } }
} as const;
const gameCommandOperation = (operationId: string, scope: IntegrationScope, description: string, requestRef?: string, parameters?: readonly unknown[], requiredBody = true, playerAllowed = false) => ({
  operationId,
  description,
  security: playerAllowed ? gameSecurityWithPlayer(scope) : gameSecurity(scope),
  ...(parameters ? { parameters } : {}),
  ...(requestRef ? { requestBody: jsonBody(requestRef, requiredBody) } : {}),
  responses: mutationResponses
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Combat-First VTT Integration API",
    version: API_VERSION,
    description: "Versioned, recipient-safe integration contract for a self-hosted VTT. Every write accepts an optional `commandId` (UUID): supply your own and resend it to retry safely - the server executes a commandId exactly once and replays the stored outcome with `duplicate: true`. Omitting it mints one server-side (echoed in the response), which is convenient but gives a lost response no safe retry. `expectedRevision` rejects stale writes with 409 + `error.currentRevision`."
  },
  servers: [{ url: API_NAMESPACE }],
  paths: {
    [SYSTEM_PATHS.health]: { get: { operationId: "getSystemHealth", security: [], responses: { "200": { description: "Server is live", content: { "application/json": { schema: { $ref: "#/components/schemas/SystemHealthResponse" } } } } } } },
    [SYSTEM_PATHS.version]: { get: { operationId: "getSystemVersion", security: [], responses: { "200": { description: "Public protocol versions", content: { "application/json": { schema: { $ref: "#/components/schemas/SystemVersionResponse" } } } } } } },
    [SYSTEM_PATHS.capabilities]: { get: { operationId: "getSystemCapabilities", security: [{ bearerAuth: ["system:read"] }], responses: { "200": { description: "Authorized server capabilities", content: { "application/json": { schema: { $ref: "#/components/schemas/SystemCapabilitiesResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" } } } },
    [OPENAPI_DOCUMENT_PATH]: { get: { operationId: "getOpenApiDocument", security: [], responses: { "200": { description: "This exact OpenAPI 3.1 document, served from the running instance", content: { "application/json": { schema: { type: "object" } } } } } } },
    [INTEGRATION_CREDENTIAL_PATHS.collection]: {
      post: { operationId: "createIntegrationCredential", security: [{ gmAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateIntegrationCredentialRequest" } } } }, responses: { "201": { description: "Credential created; the token is shown exactly once", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialIssuedResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" } } },
      get: { operationId: "listIntegrationCredentials", security: [{ gmAuth: [] }], responses: { "200": { description: "Safe metadata for every credential; never includes a secret", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialListResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" } } }
    },
    [INTEGRATION_CREDENTIAL_PATHS.rotate]: { post: { operationId: "rotateIntegrationCredential", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/RotateIntegrationCredentialRequest" } } } }, responses: { "200": { description: "Credential rotated; the new token is shown exactly once", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialIssuedResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } } } },
    [INTEGRATION_CREDENTIAL_PATHS.revoke]: { post: { operationId: "revokeIntegrationCredential", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Credential revoked; access denied immediately", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [INTEGRATION_CREDENTIAL_PATHS.audit]: { get: { operationId: "getIntegrationCredentialAudit", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Safe audit history: no secrets, only usage/lifecycle metadata", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialAuditResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.collection]: {
      post: { operationId: "uploadMapAsset", security: [{ gmAuth: [] }], description: "Uploads raw image bytes as the request body. `filename`, `name`, and `kind` (battlemap/regional/world) are query parameters, not a JSON body. Content-addressed: uploading identical bytes again returns the existing asset with `duplicate: true` instead of creating a copy.", parameters: [{ name: "filename", in: "query", schema: { type: "string" } }, { name: "name", in: "query", schema: { type: "string" } }, { name: "kind", in: "query", schema: { type: "string", enum: ["battlemap", "regional", "world"] } }], requestBody: { required: true, content: { "image/*": { schema: { type: "string", format: "binary" } } } }, responses: { "201": { description: "New map asset stored", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetUploadResponse" } } } }, "200": { description: "Identical bytes already stored; the existing asset is returned", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetUploadResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "413": { $ref: "#/components/responses/ApiError" } } },
      get: { operationId: "listMapAssets", security: [{ gmAuth: [] }], responses: { "200": { description: "Safe metadata for every stored map asset", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetListResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" } } }
    },
    [MAP_ASSET_PATHS.byId]: {
      get: { operationId: "getMapAsset", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Safe metadata for one map asset", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } },
      patch: { operationId: "updateMapAssetDetails", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, kind: { type: "string", enum: ["battlemap", "regional", "world"] } } } } } }, responses: { "200": { description: "Updated map catalog entry", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" } } }
    },
    [MAP_ASSET_PATHS.content]: { get: { operationId: "getMapAssetContent", description: "Renderer-safe original image bytes. Authorized for the GM, a player in the active encounter on this map, or a paired viewer session (cookie) - any one is sufficient. Supports ETag/If-None-Match (304), byte-range requests (206/416), and is always sent with `Cache-Control: private, no-store` since access can be revoked at any time.", security: [{ gmAuth: [] }, { viewerCookieAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Full image bytes" }, "206": { description: "Partial content for a byte-range request" }, "304": { description: "Not modified" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "416": { description: "Range not satisfiable" } } } },
    [MAP_ASSET_PATHS.scale]: { put: { operationId: "setMapAssetScale", security: [{ gmAuth: [] }], description: "Gridless real-world scale, derived from two image points and a known distance.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["start", "end", "knownDistance", "unit"], properties: { start: { $ref: "#/components/schemas/ImagePoint" }, end: { $ref: "#/components/schemas/ImagePoint" }, knownDistance: { type: "number", exclusiveMinimum: 0 }, unit: { type: "string" } } } } } }, responses: { "200": { description: "Updated map catalog entry with the new scale", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.calibrationWizards]: { post: { operationId: "startMapCalibrationWizard", security: [{ gmAuth: [] }], description: "Starts a server-held, TTL-bounded calibration wizard session from either a fixed 3x3 area drag or a known-axis segment measurement, and returns its ID plus a viewport-clipped grid overlay preview.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "201": { description: "Wizard session started", content: { "application/json": { schema: { $ref: "#/components/schemas/MapCalibrationWizardResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.calibrationWizardActions]: { post: { operationId: "actOnMapCalibrationWizard", security: [{ gmAuth: [] }], description: "Applies one adjust/undo/redo/verify action to an in-progress wizard session, owned by the same GM bearer token that started it.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "wizardId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Updated wizard state and overlay", content: { "application/json": { schema: { $ref: "#/components/schemas/MapCalibrationWizardResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.calibrationWizardComplete]: { post: { operationId: "completeMapCalibrationWizard", security: [{ gmAuth: [] }], description: "Saves the wizard's current calibration to the map catalog and discards the wizard session. Verification is optional reassurance, not a requirement.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "wizardId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Saved calibration", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.pairings]: { post: { operationId: "createViewerPairing", security: [{ gmAuth: [] }], description: "Issues a short-lived, one-time pairing code for a second-screen display to exchange for a session.", responses: { "201": { description: "Pairing code issued" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.pairingsExchange]: { post: { operationId: "exchangeViewerPairing", security: [], description: "Exchanges a pairing code for an HttpOnly, SameSite=Strict `vtt_viewer_session` cookie. No request auth: the code itself is the credential.", responses: { "201": { description: "Paired; session cookie set" }, "400": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.access]: { get: { operationId: "listViewerAccess", security: [{ gmAuth: [] }], responses: { "200": { description: "Every paired viewer plus which are currently connected" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.accessById]: { delete: { operationId: "revokeViewerAccess", security: [{ gmAuth: [] }], description: "Revokes one paired display and immediately disconnects its live event stream.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Revoked" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.presentation]: { get: { operationId: "getViewerPresentation", security: [{ gmAuth: [] }, { viewerCookieAuth: [] }], responses: { "200": { description: "Current player-safe presentation state (map, camera, measurement, pings, initiative, encounter)" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.presentationCommands]: { post: { operationId: "sendViewerPresentationCommand", security: [{ gmAuth: [] }], description: "GM-only optimistic-concurrency command (present/pause map, set camera, ping, set/clear measurement). `expectedRevision` mismatches return 409.", responses: { "200": { description: "Command applied" }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.events]: { get: { operationId: "streamViewerPresentation", security: [{ viewerCookieAuth: [] }], description: "Server-Sent Events stream of presentation updates for a paired viewer session; not a normal JSON response.", responses: { "200": { description: "text/event-stream of `presentation` events" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [GAME_PATHS.snapshot]: { get: { operationId: "getGameSnapshot", security: gameSecurityWithPlayer("game:read"), description: "The authoritative game state, projected for the caller: GM sessions and integration credentials get the full GM view (hidden combatants, notes, turn-history metadata) unless `view=player` asks for the player-safe projection; player session tokens always get the player-safe view. Sends a weak ETag derived from the revision - poll with If-None-Match for cheap 304s (presence and timed-annotation expiry do not bump the revision, so re-fetch when you need those fresh).", parameters: [{ name: "view", in: "query", required: false, schema: { type: "string", enum: ["gm", "player"] } }], responses: { "200": { description: "The projected game state, with `revision` for optimistic concurrency and polling", headers: { ETag: { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/GameSnapshotResponse" } } } }, "304": { description: "Unchanged since the revision in If-None-Match" }, "401": apiError, "403": apiError } } },
    [GAME_PATHS.log]: { get: { operationId: "getCombatLog", security: gameSecurityWithPlayer("combat:read"), description: "The persistent combat log, oldest first. GM sessions and integration credentials receive GM-only lines; player sessions only public ones.", parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000, default: 250 } }], responses: { "200": { description: "Chronological log entries", content: { "application/json": { schema: { $ref: "#/components/schemas/GameLogResponse" } } } }, "400": apiError, "401": apiError, "403": apiError } } },
    [GAME_PATHS.commands]: {
      get: { operationId: "listGameCommands", security: gameSecurityWithPlayer("system:read"), description: "The full catalog of command types accepted by the tunnel, each with the credential scope it requires.", responses: { "200": { description: "Supported command types", content: { "application/json": { schema: { $ref: "#/components/schemas/GameCommandCatalogResponse" } } } }, "401": apiError, "403": apiError } },
      post: { operationId: "submitGameCommand", security: [{ bearerAuth: [] }, { gmAuth: [] }, { playerAuth: [] }], description: "Generic command tunnel: submits any cataloged command type with its Socket.IO payload shape, dispatched through the exact same validation/authorization/execution path as the built-in UI. The required credential scope depends on the type (see the GET catalog). Omit `commandId` to have one minted; resend the same `commandId` to retry idempotently.", requestBody: jsonBody("GameCommandEnvelope"), responses: { ...mutationResponses, "404": apiError } }
    },
    [GAME_PATHS.encounterStart]: { post: gameCommandOperation("startEncounter", "combat:write", "Starts an encounter on a calibrated battlemap with initial combatants (GM-grade only). Missing initiative scores are rolled server-side.", "EncounterStartRequest") },
    [GAME_PATHS.encounterEnd]: { post: gameCommandOperation("endEncounter", "combat:write", "Ends the encounter (GM-grade only). The whole fight auto-archives permanently (see /encounters) in the same transaction.", "CommandControlRequest", undefined, false) },
    [GAME_PATHS.encounterCombatants]: { post: gameCommandOperation("addEncounterCombatant", "combat:write", "Adds a rostered actor to the running encounter (GM-grade only); rolls initiative when no score is given.", "AddCombatantRequest") },
    [GAME_PATHS.initiativeSet]: { post: gameCommandOperation("setInitiativeScore", "combat:write", "Sets a combatant's initiative score (GM-grade only).", "InitiativeSetRequest") },
    [GAME_PATHS.initiativeNext]: { post: gameCommandOperation("nextTurn", "combat:write", "Advances the turn (GM-grade only). While the table is rewound this steps forward through recorded history; a 409 with `needsConfirm: \"rewrite-history\"` asks for `confirmRewrite: true` to truncate the undone future.", "InitiativeNextRequest", undefined, false) },
    [GAME_PATHS.initiativePrevious]: { post: gameCommandOperation("previousTurn", "combat:write", "Rewinds the whole table to the previous turn boundary (GM-grade only). A 409 with `needsConfirm: \"discard-changes\"` asks for `confirmDiscard: true` to drop changes made while rewound.", "InitiativePreviousRequest", undefined, false) },
    [GAME_PATHS.turnEnd]: { post: gameCommandOperation("endTurn", "combat:write", "Ends the current turn and advances. The GM (or an integration) may end anyone's turn; a player session only their own claimed character's.", "CommandControlRequest", undefined, false, true) },
    [GAME_PATHS.turnUse]: { post: gameCommandOperation("useTurnSlot", "combat:write", "Marks the current turn's action or bonus action used/unused. A free manual toggle (never blocks); structured action resolution validates against this state per the encounter's rules mode, and un-marking the action slot also clears any open compound-action instance.", "TurnUseRequest", undefined, true, true) },
    [GAME_PATHS.turnReaction]: { post: gameCommandOperation("useReaction", "combat:write", "Marks a combatant's reaction used/unused; reactions refresh at the start of their own turn.", "TurnReactionRequest", undefined, true, true) },
    [GAME_PATHS.turnLegendary]: { post: gameCommandOperation("useLegendaryActions", "combat:write", "Sets a legendary creature's spent legendary actions this round (GM-grade only; 0 clears). Structured legendary action resolves spend the pool automatically; it refills at the creature's own turn start.", "TurnLegendaryRequest") },
    [GAME_PATHS.tokenMove]: { post: gameCommandOperation("moveToken", "combat:write", "Moves a combatant's token; the server snaps to the calibrated grid. `position: null` returns the token to the tray. Player sessions may move only their claimed character. `sceneId` targets a prepared (GM-private) scene instead of the live table.", "TokenMoveRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.actors]: { post: gameCommandOperation("addActorFromDefinition", "actor:write", "Instantiates a bundled SRD monster onto the roster (GM-grade only). The response's `actorId` equals the commandId.", "ActorAddRequest") },
    [GAME_PATHS.actorById]: { delete: gameCommandOperation("removeActor", "actor:write", "Removes an actor from the roster (GM-grade only); rejected for claimed characters and, while rewound, for combatants in the fight.", "CommandControlRequest", [uuidParam("actorId")], false) },
    [GAME_PATHS.actorDamage]: { post: gameCommandOperation("applyDamage", "actor:write", "Applies damage (temporary hit points absorb first). Optional typed `parts` run the defense pipeline - immunity, then resistance (half, rounded down), then vulnerability (double) - from the target's definition and active effects, with the per-part breakdown returned in `applied`; the bare `amount` is the manual path (no defense math). Dropping a player character to 0 starts the dying state (Unconscious + Prone + death saves; `critical: true` while dying adds two failures). Player sessions may target only their claimed character.", "DamageRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.actorHeal]: { post: gameCommandOperation("healActor", "actor:write", "Heals hit points up to the maximum. Player sessions may target only their claimed character.", "HpAmountRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.actorTempHp]: { post: gameCommandOperation("setTemporaryHp", "actor:write", "Sets temporary hit points (replaces, 5e-style). Player sessions may target only their claimed character.", "TempHpRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.actorHp]: { post: gameCommandOperation("setCurrentHp", "actor:write", "Sets current hit points directly (GM-grade only).", "SetHpRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.actorConditions]: { post: gameCommandOperation("setCondition", "actor:write", "Applies or clears a bundled SRD condition (exhaustion carries a level). Player sessions may target only their claimed character.", "ConditionRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.definitionsImport]: { post: gameCommandOperation("importActorDefinition", "actor:write", "Imports a canonical ActorDefinition JSON as a claimable actor with a full sheet (GM-grade only). The response's `actorId` equals the commandId.", "ActorImportRequest") },
    [GAME_PATHS.rolls]: { post: gameCommandOperation("rollDice", "roll:create", "Rolls dice into the shared, auditable roll history; the response carries `rollId`. Player sessions cannot roll gm-only, and rolling for an actor requires owning it.", "DiceRollRequest", undefined, true, true) },
    [GAME_PATHS.actionResolve]: { post: gameCommandOperation("resolveAction", "combat:write", "Runs a stat-block action (GM-grade only): attack vs target AC with 2024 crit doubling, or save-DC surfacing with proposed damage. Targets are explicit ids or an area template (never both); rolls are recorded in the shared history and the response carries the `resolution`.", "ActionResolveRequest") },
    [GAME_PATHS.saveAnswer]: { post: gameCommandOperation("answerSave", "combat:write", "Answers a pending saving throw by server roll or manual total; on commit the outcome auto-applies damage/conditions. Player sessions may answer only their claimed character's saves. The response carries the `outcome`.", "SaveAnswerRequest", [uuidParam("saveId")], true, true) },
    [GAME_PATHS.saveDismiss]: { post: gameCommandOperation("dismissSave", "combat:write", "Dismisses a pending saving throw without resolving it (GM-grade, or the owing player).", "CommandControlRequest", [uuidParam("saveId")], false, true) },
    [GAME_PATHS.reactionAnswer]: { post: gameCommandOperation("answerReaction", "combat:write", "Answers a pending reaction prompt (Uncanny Dodge). The triggering attack's damage was parked on the prompt, so both answers apply it here: `use: true` spends the reaction and halves each typed part first; `use: false` applies it in full. Player sessions may answer only their claimed character's prompts. The response carries the `outcome`.", "ReactionAnswerRequest", [uuidParam("reactionId")], true, true) },
    [GAME_PATHS.reactionDismiss]: { post: gameCommandOperation("dismissReaction", "combat:write", "Dismisses a pending reaction prompt WITHOUT applying its parked damage (GM-grade only) - for when the damage was already applied manually.", "CommandControlRequest", [uuidParam("reactionId")], false) },
    [GAME_PATHS.actorAvailableActions]: { get: { operationId: "getActorAvailableActions", security: gameSecurityWithPlayer("combat:read"), description: "Server-computed action availability for one combatant: per stat-block action, whether strict mode would allow resolving it right now, every violated rule (machine-readable rule ids + messages), and the remaining limited uses / open compound-action rolls. Runs the exact evaluation `action.resolve` enforces, so this report can never drift from enforcement. GM-grade any combatant; a player session only their claimed character. Target-specific rules (e.g. grapple targeting) need a target and are not pre-checked here.", parameters: [uuidParam("actorId")], responses: { "200": { description: "Per-action availability with explanations", content: { "application/json": { schema: { $ref: "#/components/schemas/ActorAvailableActionsResponse" } } } }, "401": apiError, "403": apiError, "404": apiError } } },
    [GAME_PATHS.effects]: { post: gameCommandOperation("addEffect", "combat:write", "Adds a rules-engine effect to a combatant (GM-grade only): a named, tagged state with an optional duration and typed modifiers (damage bonus, damage resistance, advantage). Structured actions create richer effects via their own declarations; this is the house-rule/manual path. The response's `effectId` equals the commandId.", "EffectAddRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.effectEnd]: { post: gameCommandOperation("endEffect", "combat:write", "Ends an effect: linked conditions clear (a released grapple removes Grappled/Restrained) and its on-end grants fire (a Frenzied Rage ending adds Exhaustion). GM-grade anyone; a player session only their claimed character.", "CommandControlRequest", [uuidParam("actorId"), { name: "effectId", in: "path", required: true, schema: { type: "string", maxLength: 120 } }], false, true) },
    [GAME_PATHS.deathSaveRoll]: { post: gameCommandOperation("rollDeathSave", "combat:write", "Rolls a death saving throw for a dying character (at 0 HP): natural 20 regains 1 HP, natural 1 counts two failures, 10+ succeeds (three stabilize), otherwise a failure (three kill). Default applies in one step; pass `commit: false` to preview the projected pips first (honoring `rollMode` adv/disadv), then confirm with `commit: true` and the shown `naturalRoll`. The roll is recorded in the shared history and the response carries `deathSave`. GM-grade anyone; a player session only their claimed character.", "DeathSaveRollRequest", [uuidParam("actorId")], false, true) },
    [GAME_PATHS.rulesMode]: { post: gameCommandOperation("setRulesMode", "combat:write", "Sets the rules-engine enforcement mode (GM-grade only): `strict` rejects invalid structured actions with an overridable `error.details.blocked`, `assisted` allows them with logged warnings, `freeform` skips validation. Also settable at encounter start.", "RulesModeRequest") },
    [GAME_PATHS.rollMode]: { post: gameCommandOperation("setRollMode", "combat:write", "Sets the table's roll preference (GM-grade only): `auto` rolls each encounter roll for you (with a typed override and adv/disadv after a d20), `manual` waits for a typed physical-dice result (with a Roll button to auto-roll instead).", "RollModeRequest") },
    [GAME_PATHS.healthDisplay]: { post: gameCommandOperation("setHealthDisplay", "combat:write", "Sets the table-wide default for how token health shows on the map (GM-grade only): `band` a coarse status badge, `bar` a thin HP bar, or `ring` a green-to-red ring; `audience` `gm` keeps a bar/ring on the GM map only, `all` shows it to players and the shared screen. Exact hit points never leave the GM - non-owners see only a coarse band-fraction. A single token can override this via the actor health-display command.", "HealthDisplayRequest") },
    [GAME_PATHS.environment]: { post: gameCommandOperation("setEnvironment", "combat:write", "Toggles the underwater environment on the live encounter (GM-grade only; SRD Underwater Combat): melee attacks take Disadvantage unless they deal piercing damage, ranged attacks automatically miss beyond normal range, and every combatant resists fire damage.", "EnvironmentRequest") },
    [GAME_PATHS.actorRest]: { post: gameCommandOperation("restActor", "actor:write", "Applies a rest to a rostered actor outside combat; a player session may rest only their claimed character, the GM anyone. Long: remaining effects end (their on-end grants fire first), hit points restore to maximum, temporary HP clears, the dying state resets, limited-use pools refresh, all spent Hit Point Dice restore, spell slots and prepared spells reset to the sheet defaults, and Exhaustion drops one level. Short: per-short-rest and recharge pools re-arm; healing is the separate spend-hit-dice call.", "ActorRestRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.actorSpendHitDice]: { post: gameCommandOperation("spendHitDice", "actor:write", "Spends Hit Point Dice to heal (SRD Short Rest: each die heals its roll + Con modifier, minimum 1). Rejected while the actor is in an active encounter. Player sessions may target only their claimed character; the dice land in the shared roll history.", "ActorSpendHitDiceRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.characterSetSlot]: { post: gameCommandOperation("setSpellSlot", "actor:write", "Sets a character's remaining spell slots for one level (clamped to the sheet maximum) - spend or restore a slot during play. Player sessions may target only their claimed character.", "CharacterSetSlotRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.characterSetPrepared]: { post: gameCommandOperation("setPreparedSpell", "actor:write", "Prepares or un-prepares one of a character's known spells (cantrips and always-prepared spells can't be toggled). Player sessions may target only their claimed character.", "CharacterSetPreparedRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.characterSetInventory]: { post: gameCommandOperation("setInventory", "actor:write", "Adds, updates, or removes (quantity 0) one of a character's inventory items and toggles equipped/attuned. Player sessions may target only their claimed character.", "CharacterSetInventoryRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.characterSetCurrency]: { post: gameCommandOperation("setCurrency", "actor:write", "Sets a character's coin purse (cp/sp/ep/gp/pp). Player sessions may target only their claimed character.", "CharacterSetCurrencyRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.characterSetIdentity]: { post: gameCommandOperation("setIdentity", "actor:write", "Sets a character's identity (class/level/race/background/feats) on its editable imported sheet - a light hand-edit, not a guided builder. Player sessions may target only their claimed character.", "CharacterSetIdentityRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.characterSetProficiencies]: { post: gameCommandOperation("setProficiencies", "actor:write", "Sets a character's save and skill proficiency selections on its editable imported sheet. Player sessions may target only their claimed character.", "CharacterSetProficienciesRequest", [uuidParam("actorId")], true, true) },
    [GAME_PATHS.annotations]: { post: gameCommandOperation("addAnnotation", "combat:write", "Draws a measurement or area shape on the encounter map; the server snaps geometry to the grid. The response's `annotationId` equals the commandId.", "AnnotationAddRequest", undefined, true, true) },
    [GAME_PATHS.annotationsPing]: { post: gameCommandOperation("pingMap", "combat:write", "Pings a point on the encounter map (ephemeral, labeled with the sender).", "AnnotationPingRequest", undefined, true, true) },
    [GAME_PATHS.annotationsClear]: { post: gameCommandOperation("clearAnnotations", "combat:write", "Clears drawn shapes: your own, all player shapes (GM-grade), or everything (GM-grade).", "AnnotationClearRequest", undefined, true, true) },
    [GAME_PATHS.annotationById]: { delete: gameCommandOperation("removeAnnotation", "combat:write", "Removes one annotation (owners, the GM, and GM-grade integrations).", "CommandControlRequest", [uuidParam("id")], false, true) },
    [GAME_PATHS.annotationMove]: { post: gameCommandOperation("moveAnnotation", "combat:write", "Moves/resizes an annotation; the server re-snaps geometry.", "AnnotationMoveRequest", [uuidParam("id")], true, true) },
    [GAME_PATHS.annotationColor]: { post: gameCommandOperation("setAnnotationColor", "combat:write", "Changes an annotation's color.", "AnnotationColorRequest", [uuidParam("id")], true, true) },
    [GAME_PATHS.annotationVisibility]: { post: gameCommandOperation("setAnnotationVisibility", "combat:write", "Changes who can see an annotation (public, gm-only, owner-only, owner-gm, gm-actor).", "AnnotationVisibilityRequest", [uuidParam("id")], true, true) },
    [GAME_PATHS.annotationMovable]: { post: gameCommandOperation("setAnnotationMovable", "combat:write", "Allows or disallows other players moving a shape.", "AnnotationMovableRequest", [uuidParam("id")], true, true) },
    [GAME_PATHS.claims]: { post: gameCommandOperation("claimCharacter", "actor:write", "Claims an unclaimed player character for the calling session. Player sessions only - GM sessions and integration credentials are refused (an integration wanting a seat at the table should hold a player session from POST /sessions/player).", "ClaimRequest", undefined, true, true) },
    [GAME_PATHS.claimsRelease]: { post: gameCommandOperation("releaseCharacters", "actor:write", "Releases every character claimed by the calling player session.", "CommandControlRequest", undefined, false, true) },
    [GAME_PATHS.claimForceRelease]: { post: gameCommandOperation("forceReleaseCharacter", "actor:write", "Force-releases a claimed character (GM-grade only) - the recovery path for a lost player device.", "CommandControlRequest", [uuidParam("actorId")], false) },
    [GAME_PATHS.actorTokenImage]: { post: gameCommandOperation("setActorTokenImage", "actor:write", "Sets or clears (null) a combatant's token image from the uploaded token library (GM-grade only).", "TokenImageRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.actorSize]: { post: gameCommandOperation("setActorSize", "actor:write", "Sets a combatant's creature size; large+ tokens size to their grid footprint and re-snap (GM-grade only).", "ActorSizeRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.actorVisibility]: { post: gameCommandOperation("setActorVisibility", "actor:write", "Moves a combatant between the shared layer (public) and the GM-only layer (GM-grade only).", "ActorVisibilityRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.actorArchived]: { post: gameCommandOperation("setActorArchived", "actor:write", "Archives or restores a character (GM-grade only). Archived characters are hidden from players and excluded from the encounter builder; a character in the running encounter must be removed first.", "ActorArchivedRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.actorHealthDisplay]: { post: gameCommandOperation("setActorHealthDisplay", "actor:write", "Overrides how one combatant's token health shows on the map (GM-grade only), or clears the override (`display: null`) so the token follows the table-wide default. Same style/audience choices as the table-wide health-display command.", "ActorHealthDisplayRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.actorSpeed]: { post: gameCommandOperation("setActorSpeed", "actor:write", "Sets a combatant's walking speed in feet (GM-grade only); null clears it to unknown, which skips the movement rules for that combatant. Speed seeds from the imported definition automatically.", "ActorSpeedRequest", [uuidParam("actorId")]) },
    [GAME_PATHS.scenes]: { post: gameCommandOperation("createScene", "scene:write", "Prepares a staged scene on a battlemap, privately, without touching the live table (GM-grade only). The response's `sceneId` equals the commandId.", "SceneCreateRequest") },
    [GAME_PATHS.sceneById]: { delete: gameCommandOperation("removeScene", "scene:write", "Removes a prepared scene (GM-grade only); the active scene cannot be removed.", "CommandControlRequest", [uuidParam("sceneId")], false) },
    [GAME_PATHS.sceneRename]: { post: gameCommandOperation("renameScene", "scene:write", "Renames a prepared scene (GM-grade only).", "SceneRenameRequest", [uuidParam("sceneId")]) },
    [GAME_PATHS.sceneActivate]: { post: gameCommandOperation("activateScene", "scene:write", "Switches the live table to a prepared scene, parking the current one non-destructively (GM-grade only). Rejected while the timeline is rewound; the turn-snapshot timeline restarts for the newly live scene.", "CommandControlRequest", [uuidParam("sceneId")], false) },
    [GAME_PATHS.sceneCombatants]: { post: gameCommandOperation("setSceneCombatants", "scene:write", "Replaces a prepared scene's combatant list (GM-grade only).", "SceneCombatantsRequest", [uuidParam("sceneId")]) },
    [GAME_PATHS.sceneDuplicate]: { post: gameCommandOperation("duplicateScene", "scene:write", "Duplicates a prepared scene as a new staged copy carrying the same map and staged combatants/tokens (GM-grade only). Duplicating the live scene snapshots its current combat into the copy; the copy is always parked, next to the original. The response's `sceneId` equals the commandId.", "CommandControlRequest", [uuidParam("sceneId")], false) },
    [GAME_PATHS.sceneReorder]: { post: gameCommandOperation("reorderScenes", "scene:write", "Reorders the prepared-scene list to the given permutation of every scene id (GM-grade only). Does not change which scene is live.", "SceneReorderRequest") },
    [GAME_PATHS.fogEnabled]: { post: gameCommandOperation("setFogEnabled", "scene:write", "Turns manual fog of war on/off (GM-grade only). Enabled fog with no reveal strokes hides the whole map from players and the shared screen; `sceneId` targets a prepared scene's private prep instead of the live table.", "FogEnabledRequest") },
    [GAME_PATHS.fogPaint]: { post: gameCommandOperation("paintFog", "scene:write", "Paints one reveal/hide fog rect (GM-grade only). The server snaps to whole grid cells on calibrated unrotated maps and clamps to the map bounds; a stroke covering the whole map replaces all prior strokes. `sceneId` targets a prepared scene.", "FogPaintRequest") },
    [GAME_PATHS.fogReset]: { post: gameCommandOperation("resetFog", "scene:write", "Clears every fog stroke - with fog enabled the whole map is hidden again (GM-grade only). `sceneId` targets a prepared scene.", "FogResetRequest") },
    [SESSION_PATHS.player]: { post: { operationId: "issuePlayerSession", security: [], description: "Issues a player session token - the HTTP mirror of the socket's open join, for headless or custom player clients. LAN-trust by design: no credentials required, but the host must have completed GM setup. The token then authenticates player-limited calls across this API.", responses: { "201": { description: "Player session issued", content: { "application/json": { schema: { $ref: "#/components/schemas/PlayerSessionIssuedResponse" } } } }, "409": apiError } } },
    [CONTENT_PATHS.monsters]: { get: { operationId: "listContentMonsters", security: gameSecurity("game:read"), description: "Browse the bundled SRD bestiary (GM-grade only). Includes the CC BY 4.0 attribution line.", responses: { "200": { description: "Monster summaries + attribution", content: { "application/json": { schema: { $ref: "#/components/schemas/ContentMonstersResponse" } } } }, "401": apiError, "403": apiError } } },
    [CONTENT_PATHS.monsterById]: { get: { operationId: "getContentMonster", security: gameSecurity("game:read"), description: "One full stat block (GM-grade only). Imported definitions shadow bundled ids, matching the live server's resolution.", parameters: [{ name: "definitionId", in: "path", required: true, schema: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 200 } }], responses: { "200": { description: "The full ActorDefinition", content: { "application/json": { schema: { $ref: "#/components/schemas/ContentMonsterSheetResponse" } } } }, "401": apiError, "403": apiError, "404": apiError } } },
    [CONTENT_PATHS.monsterActions]: { get: { operationId: "getContentMonsterActions", security: gameSecurity("game:read"), description: "A stat block's actions flattened for running them (GM-grade only): attack bonus, reach/range, save DC, damage formulas, parsed area.", parameters: [{ name: "definitionId", in: "path", required: true, schema: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 200 } }], responses: { "200": { description: "Runnable action summaries", content: { "application/json": { schema: { $ref: "#/components/schemas/ContentMonsterActionsResponse" } } } }, "401": apiError, "403": apiError, "404": apiError } } },
    [CONTENT_PATHS.conditions]: { get: { operationId: "listContentConditions", security: gameSecurityWithPlayer("game:read"), description: "The bundled SRD condition reference (public information - any GM, player, or integration session).", responses: { "200": { description: "Condition reference entries", content: { "application/json": { schema: { $ref: "#/components/schemas/ContentConditionsResponse" } } } }, "401": apiError, "403": apiError } } },
    [ENCOUNTER_ARCHIVE_PATHS.collection]: { get: { operationId: "listEncounterArchives", security: gameSecurity("combat:read"), description: "Permanent records of ended encounters, newest first (GM sessions and integration credentials only - never player sessions).", responses: { "200": { description: "Archive summaries", content: { "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveListResponse" } } } }, "401": apiError, "403": apiError } } },
    [ENCOUNTER_ARCHIVE_PATHS.byId]: {
      get: { operationId: "getEncounterArchive", security: gameSecurity("combat:read"), description: "One archive's full machine-readable document (archiveSchemaVersion 3): per-turn full states, combat log, complete per-command journal, final state, the post-encounter aftermath state, all dice rolls, and the stat blocks used. GM-grade data - hidden combatants included; never reaches player sessions.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }], responses: { "200": { description: "The stored document, verbatim", content: { "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveDocumentResponse" } } } }, "400": apiError, "401": apiError, "403": apiError, "404": apiError } },
      delete: { operationId: "deleteEncounterArchive", security: gameSecurity("admin"), description: "Permanently deletes one archived encounter (GM session or an admin-scoped credential).", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }], responses: { "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/EncounterArchiveDeletedResponse" } } } }, "400": apiError, "401": apiError, "403": apiError, "404": apiError } }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT integration token" },
      gmAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT GM session token" },
      playerAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT player session token", description: "Player sessions keep exactly the table's player limits: player-safe projections only, own claimed character only." },
      viewerCookieAuth: { type: "apiKey", in: "cookie", name: "vtt_viewer_session", description: "Also accepted as a Bearer token; the cookie is what the paired second-screen browser actually sends." }
    },
    responses: { ApiError: { description: "Stable API error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } } } },
    schemas: {
      SystemHealth: { type: "object", additionalProperties: false, required: ["status", "serverTime"], properties: { status: { const: "ok" }, serverTime: { type: "string", format: "date-time" } } },
      SystemVersion: { type: "object", additionalProperties: false, required: ["applicationVersion", "apiVersion", "realtimeProtocolVersion", "schemaVersions"], properties: { applicationVersion: { type: "string" }, apiVersion: { const: API_VERSION }, realtimeProtocolVersion: { const: REALTIME_PROTOCOL_VERSION }, schemaVersions: { type: "object", additionalProperties: false, required: ["actorDefinition"], properties: { actorDefinition: { type: "integer", minimum: 1 } } } } },
      SystemCapabilities: { type: "object", additionalProperties: false, required: ["api", "realtime", "supportedScopes", "features"], properties: { api: { type: "object", additionalProperties: false, required: ["version", "namespace"], properties: { version: { const: API_VERSION }, namespace: { const: API_NAMESPACE } } }, realtime: { type: "object", additionalProperties: false, required: ["protocolVersion", "transport"], properties: { protocolVersion: { const: REALTIME_PROTOCOL_VERSION }, transport: { const: "socket.io" } } }, supportedScopes: { type: "array", items: { type: "string", enum: IntegrationScopeSchema.options } }, features: { type: "object", additionalProperties: false, required: ["webhooks", "viewer", "battlemapGridCalibration", "gameApi", "commandTunnel", "encounterArchives", "rulesEngine"], properties: { webhooks: { type: "boolean" }, viewer: { type: "boolean" }, battlemapGridCalibration: { type: "boolean" }, gameApi: { type: "boolean" }, commandTunnel: { type: "boolean" }, encounterArchives: { type: "boolean" }, rulesEngine: { type: "boolean" } } } } },
      SystemHealthResponse: envelopeSchema("#/components/schemas/SystemHealth"),
      SystemVersionResponse: envelopeSchema("#/components/schemas/SystemVersion"),
      SystemCapabilitiesResponse: envelopeSchema("#/components/schemas/SystemCapabilities"),
      IntegrationCredentialMetadata: { type: "object", additionalProperties: false, required: ["id", "name", "scopes", "gameId", "createdAt", "expiresAt", "lastUsedAt", "revokedAt"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string", minLength: 1, maxLength: 100 }, scopes: { type: "array", minItems: 1, items: { type: "string", enum: IntegrationScopeSchema.options } }, gameId: { type: ["string", "null"], format: "uuid" }, createdAt: { type: "string", format: "date-time" }, expiresAt: { type: ["string", "null"], format: "date-time" }, lastUsedAt: { type: ["string", "null"], format: "date-time" }, revokedAt: { type: ["string", "null"], format: "date-time" } } },
      CreateIntegrationCredentialRequest: { type: "object", additionalProperties: false, required: ["name", "scopes"], properties: { name: { type: "string", minLength: 1, maxLength: 100 }, scopes: { type: "array", minItems: 1, items: { type: "string", enum: IntegrationScopeSchema.options } }, gameId: { type: ["string", "null"], format: "uuid" }, expiresAt: { type: ["string", "null"], format: "date-time" } } },
      IntegrationCredentialIssued: { type: "object", additionalProperties: false, required: ["credential", "token"], properties: { credential: { $ref: "#/components/schemas/IntegrationCredentialMetadata" }, token: { type: "string", minLength: 1, description: "Shown exactly once; the server stores only a salted hash and cannot redisplay it." } } },
      RotateIntegrationCredentialRequest: { type: "object", additionalProperties: false, properties: { expiresAt: { type: ["string", "null"], format: "date-time", description: "Omit to keep the current expiration; null clears it." } } },
      CredentialAuditEvent: { type: "object", additionalProperties: false, required: ["id", "type", "occurredAt", "detail"], properties: { id: { type: "integer", minimum: 1 }, type: { type: "string", enum: ["created", "used", "verification_failed", "rotated", "revoked"] }, occurredAt: { type: "string", format: "date-time" }, detail: { type: "object", additionalProperties: true } } },
      IntegrationCredentialList: { type: "object", additionalProperties: false, required: ["credentials"], properties: { credentials: { type: "array", items: { $ref: "#/components/schemas/IntegrationCredentialMetadata" } } } },
      IntegrationCredentialAudit: { type: "object", additionalProperties: false, required: ["events"], properties: { events: { type: "array", items: { $ref: "#/components/schemas/CredentialAuditEvent" } } } },
      IntegrationCredentialResponse: envelopeSchema("#/components/schemas/IntegrationCredentialMetadata"),
      IntegrationCredentialIssuedResponse: envelopeSchema("#/components/schemas/IntegrationCredentialIssued"),
      IntegrationCredentialListResponse: envelopeSchema("#/components/schemas/IntegrationCredentialList"),
      IntegrationCredentialAuditResponse: envelopeSchema("#/components/schemas/IntegrationCredentialAudit"),
      ApiErrorEnvelope: { type: "object", additionalProperties: false, required: ["ok", "apiVersion", "error"], properties: { ok: { const: false }, apiVersion: { const: API_VERSION }, error: { type: "object", additionalProperties: false, required: ["code", "message", "requestId"], properties: { code: { type: "string", enum: ApiErrorCodeSchema.options }, message: { type: "string" }, requestId: { type: "string", format: "uuid" }, details: { type: "object", additionalProperties: true }, retryAfterSeconds: { type: "integer", minimum: 1 }, currentRevision: { type: "integer", minimum: 0 } } } } },
      ImagePoint: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } },
      /** Calibration/scale/wizard-state internals are intentionally left as flexible objects rather than fully typed here - the geometry lives in apps/server/src/grid-calibration*.ts and is out of scope for this documentation pass. */
      MapAssetMetadata: { type: "object", additionalProperties: false, required: ["id", "name", "kind", "originalName", "format", "mediaType", "width", "height", "byteLength", "importedAt", "calibration", "scale", "updatedAt"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, kind: { type: "string", enum: ["battlemap", "regional", "world"] }, originalName: { type: "string" }, format: { type: "string" }, mediaType: { type: "string" }, width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 }, byteLength: { type: "integer", minimum: 1 }, importedAt: { type: "string", format: "date-time" }, calibration: { type: ["object", "null"], additionalProperties: true }, scale: { type: ["object", "null"], additionalProperties: true }, updatedAt: { type: "string", format: "date-time" } } },
      MapCatalogEntry: { type: "object", additionalProperties: false, required: ["assetId", "name", "kind", "calibration", "scale", "createdAt", "updatedAt"], properties: { assetId: { type: "string", format: "uuid" }, name: { type: "string" }, kind: { type: "string", enum: ["battlemap", "regional", "world"] }, calibration: { type: ["object", "null"], additionalProperties: true }, scale: { type: ["object", "null"], additionalProperties: true }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
      MapAssetUploadResponse: envelopeSchema("#/components/schemas/MapAssetUploadData"),
      MapAssetUploadData: { type: "object", additionalProperties: false, required: ["asset", "duplicate"], properties: { asset: { $ref: "#/components/schemas/MapAssetMetadata" }, duplicate: { type: "boolean" } } },
      MapAssetListResponse: envelopeSchema("#/components/schemas/MapAssetListData"),
      MapAssetListData: { type: "object", additionalProperties: false, required: ["assets"], properties: { assets: { type: "array", items: { $ref: "#/components/schemas/MapAssetMetadata" } } } },
      MapAssetResponse: envelopeSchema("#/components/schemas/MapAssetData"),
      MapAssetData: { type: "object", oneOf: [{ type: "object", additionalProperties: false, required: ["asset"], properties: { asset: { $ref: "#/components/schemas/MapAssetMetadata" } } }, { type: "object", additionalProperties: false, required: ["map"], properties: { map: { $ref: "#/components/schemas/MapCatalogEntry" } } }], description: "GET responses use `asset` (full asset metadata); PATCH/scale/calibration-complete responses use `map` (catalog entry only)." },
      MapCalibrationWizardResponse: envelopeSchema("#/components/schemas/MapCalibrationWizardData"),
      MapCalibrationWizardData: { type: "object", additionalProperties: false, required: ["wizardId", "state", "overlay", "overlayWarning"], properties: { wizardId: { type: "string", format: "uuid" }, state: { type: "object", additionalProperties: true }, overlay: { type: "array", items: { type: "object", additionalProperties: true } }, overlayWarning: { type: ["string", "null"] } } },
      /** Shared control fields of every game command: omit commandId to have one minted; resend the same commandId to retry idempotently; expectedRevision rejects stale writes with 409. */
      CommandControlRequest: { type: "object", additionalProperties: false, properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 } } },
      GameMutationAccepted: { type: "object", additionalProperties: true, required: ["commandId", "revision", "duplicate"], properties: { commandId: { type: "string", format: "uuid" }, revision: { type: "integer", minimum: 0 }, duplicate: { type: "boolean", description: "True when this commandId was already processed; the stored outcome's revision is returned and nothing re-executed." } }, description: "Commands append extras: rollId/hiddenFromRoller (dice), actorId (adds/imports), annotationId, resolution (action.resolve), outcome (save.answer), type (tunnel)." },
      GameMutationAcceptedResponse: envelopeSchema("#/components/schemas/GameMutationAccepted"),
      /** The deep game shapes are owned by @vtt/domain and evolve additively; the API contract pins the envelope, not every field. */
      GameSnapshotData: { type: "object", additionalProperties: false, required: ["view", "revision", "game"], properties: { view: { type: "string", enum: ["gm", "player"] }, revision: { type: "integer", minimum: 0 }, game: { type: "object", additionalProperties: true, description: "GmView (full state + presence + turnHistory) or PlayerView (visibility-filtered actors with banded monster HP, filtered rolls/annotations/saves) - exactly what the same principal receives over Socket.IO." } } },
      GameSnapshotResponse: envelopeSchema("#/components/schemas/GameSnapshotData"),
      GameLogEntry: { type: "object", additionalProperties: false, required: ["id", "at", "kind", "text", "gmOnly", "revision"], properties: { id: { type: "integer", minimum: 1 }, at: { type: "string", format: "date-time" }, kind: { type: "string", description: "damage, heal, save, action, condition, reaction, turn, encounter, scene, history, roll - additive over time" }, text: { type: "string" }, gmOnly: { type: "boolean" }, revision: { type: "integer", minimum: 0 } } },
      GameLogData: { type: "object", additionalProperties: false, required: ["entries"], properties: { entries: { type: "array", items: { $ref: "#/components/schemas/GameLogEntry" } } } },
      GameLogResponse: envelopeSchema("#/components/schemas/GameLogData"),
      GameCommandDescriptor: { type: "object", additionalProperties: false, required: ["type", "scope", "summary"], properties: { type: { type: "string" }, scope: { type: "string", enum: IntegrationScopeSchema.options }, summary: { type: "string" } } },
      GameCommandCatalogData: { type: "object", additionalProperties: false, required: ["commands"], properties: { commands: { type: "array", items: { $ref: "#/components/schemas/GameCommandDescriptor" } } } },
      GameCommandCatalogResponse: envelopeSchema("#/components/schemas/GameCommandCatalogData"),
      GameCommandEnvelope: { type: "object", additionalProperties: false, required: ["type"], properties: { type: { type: "string", description: "A cataloged command type, e.g. encounter.start or actor.apply-damage" }, commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, payload: { type: "object", additionalProperties: true, description: "The command's Socket.IO payload shape, minus commandId/expectedRevision (carried at the envelope level)" } } },
      AnnotationGeometryInput: { type: "object", additionalProperties: false, required: ["origin", "target"], properties: { origin: { $ref: "#/components/schemas/ImagePoint" }, target: { $ref: "#/components/schemas/ImagePoint" } } },
      EncounterStartRequest: { type: "object", additionalProperties: false, required: ["mapAssetId", "entries"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, mapAssetId: { type: "string", format: "uuid" }, rulesMode: { type: "string", enum: ["strict", "assisted", "freeform"], description: "Rules-engine enforcement for this fight; omitted keeps the table's current mode" }, entries: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", additionalProperties: false, required: ["actorId"], properties: { actorId: { type: "string", format: "uuid" }, score: { type: "integer", minimum: -1000, maximum: 1000, description: "Omit to roll initiative server-side" }, surprised: { type: "boolean", description: "2024 surprise: the server rolls this combatant's initiative with disadvantage" } } } } } },
      AddCombatantRequest: { type: "object", additionalProperties: false, required: ["actorId"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, actorId: { type: "string", format: "uuid" }, score: { type: "integer", minimum: -1000, maximum: 1000 } } },
      InitiativeSetRequest: { type: "object", additionalProperties: false, required: ["actorId", "score"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, actorId: { type: "string", format: "uuid" }, score: { type: "integer", minimum: -1000, maximum: 1000 } } },
      InitiativeNextRequest: { type: "object", additionalProperties: false, properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, confirmRewrite: { type: "boolean", description: "Confirm rewriting history from the reviewed turn (truncates the undone future)" } } },
      InitiativePreviousRequest: { type: "object", additionalProperties: false, properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, confirmDiscard: { type: "boolean", description: "Confirm discarding changes made while rewound (re-restores the viewed turn in place)" } } },
      TurnUseRequest: { type: "object", additionalProperties: false, required: ["slot", "used"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, slot: { type: "string", enum: ["action", "bonus-action"] }, used: { type: "boolean" } } },
      TurnReactionRequest: { type: "object", additionalProperties: false, required: ["actorId", "used"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, actorId: { type: "string", format: "uuid" }, used: { type: "boolean" } } },
      TurnLegendaryRequest: { type: "object", additionalProperties: false, required: ["actorId", "spent"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, actorId: { type: "string", format: "uuid" }, spent: { type: "integer", minimum: 0, maximum: 10 } } },
      TokenMoveRequest: { type: "object", additionalProperties: false, required: ["position"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, position: { oneOf: [{ $ref: "#/components/schemas/ImagePoint" }, { type: "null" }], description: "Image-space coordinates (server snaps to the grid); null returns the token to the tray" }, sceneId: { type: "string", format: "uuid", description: "Target a prepared GM-private scene instead of the live encounter" }, override: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", minLength: 1, maxLength: 300 } }, description: "GM-grade bypass of a movement-budget rejection; audited in the combat log" } } },
      HpAmountRequest: { type: "object", additionalProperties: false, required: ["amount"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, amount: { type: "integer", minimum: 1, maximum: 1000 } } },
      DamageRequest: { type: "object", additionalProperties: false, required: ["amount"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, amount: { type: "integer", minimum: 1, maximum: 1000, description: "Untyped total - used when `parts` is absent; kept for compatibility either way" }, parts: { type: "array", minItems: 1, maxItems: 9, items: { type: "object", additionalProperties: false, required: ["amount", "type"], properties: { amount: { type: "integer", minimum: 0, maximum: 1000 }, type: { type: "string", minLength: 1, maxLength: 40 } } }, description: "Typed components; the server applies the target's defenses and returns the breakdown" }, sourceActorId: { type: "string", format: "uuid" }, sourceActionId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 120 }, sourceName: { type: "string", minLength: 1, maxLength: 120 }, critical: { type: "boolean", description: "Adds two death-save failures instead of one when the target is already dying" }, nonlethal: { type: "boolean", description: "Knocking out a creature (SRD): a drop to 0 leaves the target Unconscious and stable instead of dying/defeated" } } },
      EffectAddRequest: { type: "object", additionalProperties: false, required: ["name"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, name: { type: "string", minLength: 1, maxLength: 120 }, tags: { type: "array", maxItems: 8, items: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 40 } }, duration: { type: "object", description: "rounds | until-source-next-turn | encounter | manual (default manual)", properties: { type: { type: "string", enum: ["rounds", "until-source-next-turn", "encounter", "manual"] }, rounds: { type: "integer", minimum: 1, maximum: 100 } }, required: ["type"], additionalProperties: false }, modifiers: { type: "array", maxItems: 8, items: { type: "object", description: "damage-bonus {amount, appliesTo} | damage-resistance {damageTypes} | attack-advantage | incoming-attack-advantage | attack-disadvantage | incoming-attack-disadvantage | save-advantage {ability?} | save-disadvantage {ability?}" } }, concentration: { type: "boolean", description: "the bearer concentrates to sustain this effect: one at a time, damage prompts a CON save, incapacitation breaks it" } } },
      RulesModeRequest: { type: "object", additionalProperties: false, required: ["mode"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, mode: { type: "string", enum: ["strict", "assisted", "freeform"] } } },
      RollModeRequest: { type: "object", additionalProperties: false, required: ["mode"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, mode: { type: "string", enum: ["auto", "manual"] } } },
      HealthDisplayRequest: { type: "object", additionalProperties: false, required: ["style", "audience"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, style: { type: "string", enum: ["band", "bar", "ring", "aura"] }, audience: { type: "string", enum: ["gm", "all"], description: "gm keeps a bar/ring on the GM map only; all shows it to players and the shared screen (coarse band-fraction for non-owners)" } } },
      ActorHealthDisplayRequest: { type: "object", additionalProperties: false, required: ["display"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, display: { description: "The per-token override, or null to clear it and follow the table default", oneOf: [{ type: "object", additionalProperties: false, required: ["style", "audience"], properties: { style: { type: "string", enum: ["band", "bar", "ring", "aura"] }, audience: { type: "string", enum: ["gm", "all"] } } }, { type: "null" }] } } },
      EnvironmentRequest: { type: "object", additionalProperties: false, required: ["underwater"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, underwater: { type: "boolean" } } },
      ActorRestRequest: { type: "object", additionalProperties: false, required: ["kind"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, kind: { type: "string", enum: ["long", "short"], description: "short re-arms per-short-rest and recharge pools (heal by spending Hit Point Dice separately); long is the full reset" } } },
      ActorSpendHitDiceRequest: { type: "object", additionalProperties: false, required: ["count"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, count: { type: "integer", minimum: 1, maximum: 40, description: "How many Hit Point Dice to spend; each heals its roll + Con modifier (minimum 1)" } } },
      CharacterSetSlotRequest: { type: "object", additionalProperties: false, required: ["level", "remaining"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, level: { type: "integer", minimum: 1, maximum: 9 }, remaining: { type: "integer", minimum: 0, maximum: 9, description: "New remaining slots for this level; clamped to the sheet's maximum" } } },
      CharacterSetPreparedRequest: { type: "object", additionalProperties: false, required: ["spellId", "prepared"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, spellId: { type: "string", minLength: 1, maxLength: 80 }, prepared: { type: "boolean" } } },
      CharacterSetInventoryRequest: { type: "object", additionalProperties: false, required: ["item"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, item: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 80 }, name: { type: "string", minLength: 1, maxLength: 120 }, quantity: { type: "integer", minimum: 0, maximum: 9999, description: "0 removes the item" }, equipped: { type: "boolean" }, attuned: { type: "boolean" }, weightEach: { type: "number", minimum: 0 }, description: { type: "string", maxLength: 4000 } } } } },
      CharacterSetCurrencyRequest: { type: "object", additionalProperties: false, required: ["currency"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, currency: { type: "object", additionalProperties: false, properties: { cp: { type: "integer", minimum: 0, maximum: 1000000 }, sp: { type: "integer", minimum: 0, maximum: 1000000 }, ep: { type: "integer", minimum: 0, maximum: 1000000 }, gp: { type: "integer", minimum: 0, maximum: 1000000 }, pp: { type: "integer", minimum: 0, maximum: 1000000 } } } } },
      CharacterSetIdentityRequest: { type: "object", additionalProperties: false, required: ["character"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, character: { type: "object", additionalProperties: false, properties: { classes: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["id", "name", "level"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 60 }, subclass: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 60 } } }, level: { type: "integer", minimum: 1, maximum: 20 } } } }, race: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 60 }, subrace: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 60 } } } } }, background: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 60 } } }, feats: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, name: { type: "string", minLength: 1, maxLength: 80 }, description: { type: "string", maxLength: 4000 } } } } } } } },
      CharacterSetProficienciesRequest: { type: "object", additionalProperties: false, required: ["proficiencies"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, proficiencies: { type: "object", additionalProperties: false, properties: { saves: { type: "array", maxItems: 6, items: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] } }, skills: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["id", "proficiency"], properties: { id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, proficiency: { type: "string", enum: ["proficient", "expertise"] } } } }, saveOverrides: { type: "object", additionalProperties: { type: "integer", minimum: -20, maximum: 30 } }, skillOverrides: { type: "object", additionalProperties: { type: "integer", minimum: -20, maximum: 30 } } } } } },
      TempHpRequest: { type: "object", additionalProperties: false, required: ["amount"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, amount: { type: "integer", minimum: 0, maximum: 1000 } } },
      SetHpRequest: { type: "object", additionalProperties: false, required: ["current"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, current: { type: "integer", minimum: 0, maximum: 10000 } } },
      ConditionRequest: { type: "object", additionalProperties: false, required: ["conditionId", "active"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, conditionId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, active: { type: "boolean" }, level: { type: "integer", minimum: 1, maximum: 6, description: "Exhaustion level" }, override: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", minLength: 1, maxLength: 300 } }, description: "GM-grade bypass of the stand-up movement cost rejection; audited" } } },
      ActorAddRequest: { type: "object", additionalProperties: false, required: ["definitionId"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, definitionId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 200 }, visibility: { type: "string", enum: ["public", "gm-only"], default: "public" } } },
      ActorImportRequest: { type: "object", additionalProperties: false, required: ["definition"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, definition: { type: "object", additionalProperties: true, description: "A canonical ActorDefinition JSON (schema version discoverable via /system/version)" }, visibility: { type: "string", enum: ["public", "gm-only"], default: "public" } } },
      DiceRollRequest: { type: "object", additionalProperties: false, required: ["formula", "purpose", "visibility"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, formula: { type: "string", minLength: 1, maxLength: 160, description: "e.g. 2d6+3, 4d6kh3, 2d20kl1" }, purpose: { type: "string", enum: ["attack", "save", "check", "damage", "manual"] }, visibility: { type: "string", enum: ["public", "gm-only", "blind", "self-only"] }, actorId: { type: "string", format: "uuid" } } },
      ActionResolveRequest: { type: "object", additionalProperties: false, required: ["actorId", "actionId"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, actorId: { type: "string", format: "uuid" }, actionId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 120 }, targetIds: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", format: "uuid" } }, template: { type: "object", additionalProperties: false, required: ["shape", "origin", "target"], properties: { shape: { type: "string", enum: ["circle", "cone", "line", "square"] }, origin: { $ref: "#/components/schemas/ImagePoint" }, target: { $ref: "#/components/schemas/ImagePoint" } }, description: "Area targeting: the server snaps the template and finds who is under it. Provide targetIds or template, never both." }, conditionId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 }, rollMode: { type: "string", enum: ["advantage", "disadvantage", "normal"], description: "Explicit GM choice; wins over the engine's advantage/disadvantage aggregation" }, override: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", minLength: 1, maxLength: 300 } }, description: "Bypasses a rules-mode rejection; audited in the combat log and journal" }, effectId: { type: "string", maxLength: 120, description: "For the escape-grapple builtin: which escapable effect to break (defaults to the first with an escape DC)" }, note: { type: "string", minLength: 1, maxLength: 100, description: "Free-text annotation (the Ready builtin's trigger), shown in the granted effect's name" }, cover: { type: "string", enum: ["half", "three-quarters", "total"], description: "GM-adjudicated cover for the target: +2/+5 to AC and Dex saves; total blocks targeting (overridable)" }, commit: { type: "boolean", default: true, description: "false previews a single-target attack's d20 only (no damage/riders/prompts/economy) so the answerer can re-roll adv/disadv or confirm; confirm with commit=true and the shown attackNatural. Non-attack actions ignore it." }, attackNatural: { type: "integer", minimum: 1, maximum: 20, description: "Apply this exact d20 face for the attack instead of rolling - confirming a preview, or a hand-rolled die" } } },
      SaveAnswerRequest: { type: "object", additionalProperties: false, required: ["method"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, method: { type: "string", enum: ["roll", "manual"] }, total: { type: "integer", minimum: -20, maximum: 60, description: "Required for method=manual" }, rollMode: { type: "string", enum: ["advantage", "disadvantage", "normal"], description: "For method=roll: the answerer's explicit advantage/disadvantage choice; wins over the engine's aggregated sources (2d20kh1 / 2d20kl1)" }, commit: { type: "boolean", default: true, description: "false previews the outcome without applying damage/conditions" }, legendaryResistance: { type: "boolean", default: false, description: "GM only, commit only: spend a Legendary Resistance use to turn a failed save into a success (a natural success spends nothing)" } } },
      DeathSaveRollRequest: { type: "object", additionalProperties: false, properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, commit: { type: "boolean", default: true, description: "false previews the projected pips without changing them; confirm with commit=true and the shown naturalRoll" }, rollMode: { type: "string", enum: ["advantage", "disadvantage", "normal"], description: "Roll two d20s keeping the higher/lower (2d20kh1 / 2d20kl1); the kept face is the natural roll" }, naturalRoll: { type: "integer", minimum: 1, maximum: 20, description: "Apply this exact d20 value with no fresh roll - confirming a preview, or an off-screen physical die" } } },
      ReactionAnswerRequest: { type: "object", additionalProperties: false, required: ["use"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, use: { type: "boolean", description: "true spends the reaction and applies half the parked damage; false applies it in full" }, actionId: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 120, description: "Opportunity attacks: which melee action to swing with (defaults to the reactor's first melee, else Unarmed Strike)" }, commit: { type: "boolean", default: true, description: "Opportunity attacks: false previews the swing (roll only, reaction unspent, nothing applied) so the answerer can re-roll adv/disadv or confirm; confirm with commit=true and the shown attackNatural" }, rollMode: { type: "string", enum: ["advantage", "disadvantage", "normal"], description: "Opportunity attacks: the answerer's advantage/disadvantage choice for the swing's d20" }, attackNatural: { type: "integer", minimum: 1, maximum: 20, description: "Opportunity attacks: apply this exact d20 for the swing instead of rolling - confirming a preview, or a hand-rolled die" } } },
      ActorAvailableActionsData: { type: "object", additionalProperties: false, required: ["rulesMode", "actions"], properties: { rulesMode: { type: "string", enum: ["strict", "assisted", "freeform"] }, actions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name", "activation", "available", "violations", "usesRemaining", "componentsRemaining"], properties: { id: { type: "string" }, name: { type: "string" }, activation: { type: "string", enum: ["action", "bonus-action", "reaction", "other"] }, available: { type: "boolean", description: "Whether strict mode would allow resolving this action right now" }, violations: { type: "array", items: { type: "object", additionalProperties: false, required: ["rule", "message"], properties: { rule: { type: "string", description: "Machine-readable rule id, e.g. economy.action-used, feature.requires-effect, condition.incapacitated" }, message: { type: "string" } } } }, usesRemaining: { type: ["integer", "null"], minimum: 0, description: "Limited-use spending left; null when the action has no use limit" }, componentsRemaining: { type: ["integer", "null"], minimum: 0, description: "Rolls left in the open compound-action instance; null when no instance applies" }, builtin: { type: "boolean", description: "True for the SRD generic actions (Dodge, Dash, Help, Unarmed Strike, ...) every combatant can take" } } } } } },
      ActorAvailableActionsResponse: envelopeSchema("#/components/schemas/ActorAvailableActionsData"),
      AnnotationAddRequest: { type: "object", additionalProperties: false, required: ["kind", "geometry"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, kind: { type: "string", enum: ["measurement", "shape"] }, shape: { type: "string", enum: ["circle", "cone", "line", "square"] }, geometry: { $ref: "#/components/schemas/AnnotationGeometryInput" }, visibility: { type: "string", enum: ["public", "gm-only", "owner-only", "owner-gm", "gm-actor"] }, visibleToActorId: { type: ["string", "null"], format: "uuid" }, movableByOthers: { type: "boolean" }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } } },
      AnnotationPingRequest: { type: "object", additionalProperties: false, required: ["point"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, point: { $ref: "#/components/schemas/ImagePoint" }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } } },
      AnnotationMoveRequest: { type: "object", additionalProperties: false, required: ["geometry"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, geometry: { $ref: "#/components/schemas/AnnotationGeometryInput" } } },
      AnnotationColorRequest: { type: "object", additionalProperties: false, required: ["color"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } } },
      AnnotationVisibilityRequest: { type: "object", additionalProperties: false, required: ["visibility"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, visibility: { type: "string", enum: ["public", "gm-only", "owner-only", "owner-gm", "gm-actor"] }, visibleToActorId: { type: ["string", "null"], format: "uuid" } } },
      AnnotationMovableRequest: { type: "object", additionalProperties: false, required: ["movableByOthers"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, movableByOthers: { type: "boolean" } } },
      AnnotationClearRequest: { type: "object", additionalProperties: false, required: ["scope"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, scope: { type: "string", enum: ["mine", "players", "all"] } } },
      ContentMonstersData: { type: "object", additionalProperties: false, required: ["monsters", "attribution"], properties: { monsters: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name", "challengeRating", "type", "size", "armorClass", "hitPoints"], properties: { id: { type: "string" }, name: { type: "string" }, challengeRating: { type: "number" }, type: { type: "string" }, size: { type: "string" }, armorClass: { type: "integer" }, hitPoints: { type: "integer" } } } }, attribution: { type: "string" } } },
      ContentMonstersResponse: envelopeSchema("#/components/schemas/ContentMonstersData"),
      ContentMonsterSheetData: { type: "object", additionalProperties: false, required: ["definition"], properties: { definition: { type: "object", additionalProperties: true, description: "The full canonical ActorDefinition" } } },
      ContentMonsterSheetResponse: envelopeSchema("#/components/schemas/ContentMonsterSheetData"),
      ContentMonsterActionsData: { type: "object", additionalProperties: false, required: ["actions"], properties: { actions: { type: "array", items: { type: "object", additionalProperties: true, description: "id, name, activation, description, attackBonus, reachFeet, rangeFeet, saveAbility, saveDc, damage[], area" } } } },
      ContentMonsterActionsResponse: envelopeSchema("#/components/schemas/ContentMonsterActionsData"),
      ContentConditionsData: { type: "object", additionalProperties: false, required: ["conditions"], properties: { conditions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name", "description"], properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" } } } } } },
      ContentConditionsResponse: envelopeSchema("#/components/schemas/ContentConditionsData"),
      EncounterArchiveSummary: { type: "object", additionalProperties: false, required: ["id", "archivedAt", "startedAt", "endedAt", "turnCount"], properties: { id: { type: "integer", minimum: 1 }, archivedAt: { type: "string", format: "date-time" }, startedAt: { type: ["string", "null"], format: "date-time" }, endedAt: { type: "string", format: "date-time" }, turnCount: { type: "integer", minimum: 0 } } },
      EncounterArchiveListData: { type: "object", additionalProperties: false, required: ["encounters"], properties: { encounters: { type: "array", items: { $ref: "#/components/schemas/EncounterArchiveSummary" } } } },
      EncounterArchiveListResponse: envelopeSchema("#/components/schemas/EncounterArchiveListData"),
      EncounterArchiveDocumentData: { type: "object", additionalProperties: false, required: ["id", "document"], properties: { id: { type: "integer", minimum: 1 }, document: { type: "object", additionalProperties: true, description: "archiveSchemaVersion 3 (additive over 1 and 2): { archiveSchemaVersion, startedAt, endedAt, turnCount, turns[{index,kind,label,revision,at,state}], log[], journal[{seq,commandId,type,actorId,principal,payload,revision,at}], finalState, postEncounterState, rolls[], definitions[{id,source,definition}], attribution }" } } },
      EncounterArchiveDocumentResponse: envelopeSchema("#/components/schemas/EncounterArchiveDocumentData"),
      EncounterArchiveDeletedData: { type: "object", additionalProperties: false, required: ["id", "deleted"], properties: { id: { type: "integer", minimum: 1 }, deleted: { const: true } } },
      EncounterArchiveDeletedResponse: envelopeSchema("#/components/schemas/EncounterArchiveDeletedData"),
      ClaimRequest: { type: "object", additionalProperties: false, required: ["actorId"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, actorId: { type: "string", format: "uuid" } } },
      TokenImageRequest: { type: "object", additionalProperties: false, required: ["tokenAssetId"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, tokenAssetId: { type: ["string", "null"], format: "uuid", description: "A token-library asset id, or null to clear the image" } } },
      ActorSizeRequest: { type: "object", additionalProperties: false, required: ["size"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, size: { type: "string", enum: ["tiny", "small", "medium", "large", "huge", "gargantuan"] } } },
      ActorVisibilityRequest: { type: "object", additionalProperties: false, required: ["visibility"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, visibility: { type: "string", enum: ["public", "gm-only"] } } },
      ActorArchivedRequest: { type: "object", additionalProperties: false, required: ["archived"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, archived: { type: "boolean", description: "true archives (hides from players + encounter builder); false restores" } } },
      ActorSpeedRequest: { type: "object", additionalProperties: false, required: ["speedFeet"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, speedFeet: { type: ["integer", "null"], minimum: 0, maximum: 500, description: "Walking speed in feet; null clears to unknown (movement rules skip)" } } },
      SceneCreateRequest: { type: "object", additionalProperties: false, required: ["name", "mapAssetId", "combatantIds"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, name: { type: "string", minLength: 1, maxLength: 120 }, mapAssetId: { type: "string", format: "uuid" }, combatantIds: { type: "array", maxItems: 200, items: { type: "string", format: "uuid" } } } },
      SceneRenameRequest: { type: "object", additionalProperties: false, required: ["name"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, name: { type: "string", minLength: 1, maxLength: 120 } } },
      SceneCombatantsRequest: { type: "object", additionalProperties: false, required: ["combatantIds"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, combatantIds: { type: "array", maxItems: 200, items: { type: "string", format: "uuid" } } } },
      SceneReorderRequest: { type: "object", additionalProperties: false, required: ["order"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, order: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", format: "uuid" }, description: "Every prepared scene's id, in the new order" } } },
      FogEnabledRequest: { type: "object", additionalProperties: false, required: ["enabled"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, enabled: { type: "boolean" }, sceneId: { type: "string", format: "uuid", description: "Target a prepared (parked) scene's private prep instead of the live table" } } },
      FogPaintRequest: { type: "object", additionalProperties: false, required: ["op", "rect"], properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, op: { type: "string", enum: ["reveal", "hide"] }, rect: { type: "object", additionalProperties: false, required: ["x", "y", "width", "height"], properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 } }, description: "Image-pixel rect; snapped to whole grid cells on calibrated unrotated maps and clamped to the map" }, sceneId: { type: "string", format: "uuid" } } },
      FogResetRequest: { type: "object", additionalProperties: false, properties: { commandId: { type: "string", format: "uuid" }, expectedRevision: { type: "integer", minimum: 0 }, sceneId: { type: "string", format: "uuid" } } },
      PlayerSessionIssuedData: { type: "object", additionalProperties: false, required: ["token", "sessionId"], properties: { token: { type: "string", minLength: 1, description: "Bearer token for player-limited calls; long-lived, not individually revocable (LAN trust)." }, sessionId: { type: "string", format: "uuid" } } },
      PlayerSessionIssuedResponse: envelopeSchema("#/components/schemas/PlayerSessionIssuedData")
    }
  }
} as const;
