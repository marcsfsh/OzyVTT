import { z } from "zod";

export const API_VERSION = "1" as const;
export const API_NAMESPACE = `/api/v${API_VERSION}` as const;
export const REALTIME_PROTOCOL_VERSION = "1" as const;

export const SYSTEM_PATHS = {
  health: `${API_NAMESPACE}/system/health`,
  version: `${API_NAMESPACE}/system/version`,
  capabilities: `${API_NAMESPACE}/system/capabilities`
} as const;

/** Served separately from SYSTEM_PATHS: it documents the whole contract and is no system operation of its own. */
export const OPENAPI_DOCUMENT_PATH = `${API_NAMESPACE}/openapi.json` as const;

/** The host's own GM account: first-run password setup (from the host machine only), sign-in and sign-out.
 *  Same-origin only: open CORS here would let any web page relay password guesses. */
export const HOST_NAMESPACE = `${API_NAMESPACE}/host` as const;
export const HOST_PATHS = {
  setup: `${HOST_NAMESPACE}/setup`,
  gmSignIn: `${HOST_NAMESPACE}/gm/sign-in`,
  gmSignOut: `${HOST_NAMESPACE}/gm/sign-out`,
  gmRevokeAll: `${HOST_NAMESPACE}/gm/revoke-all`,
  gmPassword: `${HOST_NAMESPACE}/gm/password`,
  viewerUrls: `${HOST_NAMESPACE}/gm/viewer-urls`,
  joinUrls: `${HOST_NAMESPACE}/gm/join-urls`
} as const;

/** GM-authorized credential management; an integration token can't reach it. `{id}` is OpenAPI-style; the Express router substitutes `:id`. */
export const INTEGRATION_CREDENTIAL_PATHS = {
  collection: `${API_NAMESPACE}/gm/integration-credentials`,
  rotate: `${API_NAMESPACE}/gm/integration-credentials/{id}/rotate`,
  revoke: `${API_NAMESPACE}/gm/integration-credentials/{id}/revoke`,
  audit: `${API_NAMESPACE}/gm/integration-credentials/{id}/audit`
} as const;

/** The map library (`map-http.ts`): images, their filing, and grid calibration. `{id}` is OpenAPI style; routers
 * mount it as Express's `:id` through `expressPath`. */
export const MAP_ASSET_PATHS = {
  collection: `${API_NAMESPACE}/map-assets`,
  foldersRename: `${API_NAMESPACE}/map-assets/folders/rename`,
  byId: `${API_NAMESPACE}/map-assets/{id}`,
  content: `${API_NAMESPACE}/map-assets/{id}/content`,
  grid: `${API_NAMESPACE}/map-assets/{id}/grid`,
  scale: `${API_NAMESPACE}/map-assets/{id}/scale`,
  calibrationWizards: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards`,
  calibrationWizardActions: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/actions`,
  calibrationWizardComplete: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/complete`
} as const;

/** Token images (`token-http.ts`). See the note on MAP_ASSET_PATHS. */
export const TOKEN_ASSET_PATHS = {
  collection: `${API_NAMESPACE}/token-assets`,
  foldersRename: `${API_NAMESPACE}/token-assets/folders/rename`,
  foldersVisibility: `${API_NAMESPACE}/token-assets/folders/visibility`,
  byId: `${API_NAMESPACE}/token-assets/{id}`,
  content: `${API_NAMESPACE}/token-assets/{id}/content`
} as const;

/** The GM's library of uploaded sound files (`sound-http.ts`, ADR-0024). See the note on MAP_ASSET_PATHS. */
export const SOUND_ASSET_PATHS = {
  collection: `${API_NAMESPACE}/sound-assets`,
  byId: `${API_NAMESPACE}/sound-assets/{id}`,
  content: `${API_NAMESPACE}/sound-assets/{id}/content`
} as const;

/** The HttpOnly cookie a paired table viewer (or the GM's preview of it) authenticates with. */
export const VIEWER_SESSION_COOKIE = "vtt_viewer_session";
/** Holds a table screen's open pairing request until the GM lets it in; scoped to the screen-pairing routes. */
export const VIEWER_PAIRING_COOKIE = "vtt_viewer_pairing";

/** The table screen (`viewer-http.ts`). See the note on MAP_ASSET_PATHS. */
export const VIEWER_PATHS = {
  pairings: `${API_NAMESPACE}/viewer/pairings`,
  pairingsExchange: `${API_NAMESPACE}/viewer/pairings/exchange`,
  access: `${API_NAMESPACE}/viewer/access`,
  accessById: `${API_NAMESPACE}/viewer/access/{id}`,
  presentation: `${API_NAMESPACE}/viewer/presentation`,
  presentationCommands: `${API_NAMESPACE}/viewer/presentation/commands`,
  previewSession: `${API_NAMESPACE}/viewer/preview-session`,
  events: `${API_NAMESPACE}/viewer/events`,
  soundStatus: `${API_NAMESPACE}/viewer/sound-status`,
  /** A table screen asks to pair and shows a short code; the GM types that code to let it in (ADR-0028). */
  screenPairings: `${API_NAMESPACE}/viewer/screen-pairings`,
  screenPairingsCurrent: `${API_NAMESPACE}/viewer/screen-pairings/current`,
  screenPairingsApprove: `${API_NAMESPACE}/viewer/screen-pairings/approve`
} as const;

/**
 * The worldbuilding Codex surface (`codex-http.ts`). Reads accept a GM or player session (players get the
 * revealed-only projection for their own characters, with hidden blocks, Hidden fields and unrevealed
 * pages/maps/markers/entries stripped server-side); every write is GM-grade. A `codex:read` / `codex:write` credential acts at GM grade, except
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
  // Hidden blocks in a page's text, and who sees each one and each field.
  pageBlocks: `${API_NAMESPACE}/codex/pages/{id}/blocks`,
  pageBlockById: `${API_NAMESPACE}/codex/pages/{id}/blocks/{blockId}`,
  pageBlockMove: `${API_NAMESPACE}/codex/pages/{id}/blocks/{blockId}/move`,
  pageBlockAudience: `${API_NAMESPACE}/codex/pages/{id}/blocks/{blockId}/audience`,
  pageFieldAudience: `${API_NAMESPACE}/codex/pages/{id}/fields/{key}/audience`,
  search: `${API_NAMESPACE}/codex/search`,
  // Role-projected: the GM's counts, latest changes and reveal check; a player's new since their last visit.
  home: `${API_NAMESPACE}/codex/home`,
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
  sessionApplyTemplate: `${API_NAMESPACE}/codex/sessions/{id}/apply-template`,
  sessionHappened: `${API_NAMESPACE}/codex/sessions/{id}/happened`,
  sessionLog: `${API_NAMESPACE}/codex/sessions/{id}/log`,
  sessionTick: `${API_NAMESPACE}/codex/sessions/{id}/tick`,
  sessionCurrentScene: `${API_NAMESPACE}/codex/sessions/{id}/current-scene`,
  // The active session's live board, GM-only.
  board: `${API_NAMESPACE}/codex/board`,
  // The GM's library of session prep templates. The built-in starting template is read-only.
  prepTemplates: `${API_NAMESPACE}/codex/prep-templates`,
  prepTemplateById: `${API_NAMESPACE}/codex/prep-templates/{id}`,
  prepTemplateDuplicate: `${API_NAMESPACE}/codex/prep-templates/{id}/duplicate`,
  prepTemplateDefault: `${API_NAMESPACE}/codex/prep-templates/{id}/default`,
  quests: `${API_NAMESPACE}/codex/quests`,
  questById: `${API_NAMESPACE}/codex/quests/{id}`,
  questReveal: `${API_NAMESPACE}/codex/quests/{id}/reveal`,
  questBlocks: `${API_NAMESPACE}/codex/quests/{id}/blocks`,
  questBlockById: `${API_NAMESPACE}/codex/quests/{id}/blocks/{blockId}`,
  questBlockMove: `${API_NAMESPACE}/codex/quests/{id}/blocks/{blockId}/move`,
  questBlockAudience: `${API_NAMESPACE}/codex/quests/{id}/blocks/{blockId}/audience`,
  questObjectiveAudience: `${API_NAMESPACE}/codex/quests/{id}/objectives/{objectiveId}/audience`,
  // A standing is addressed by its faction page id, which is unique.
  standing: `${API_NAMESPACE}/codex/standing`,
  standingByFaction: `${API_NAMESPACE}/codex/standing/{factionPageId}`,
  standingReveal: `${API_NAMESPACE}/codex/standing/{factionPageId}/reveal`,
  // GM-only, read-only aggregation of reveal state; each row carries the id its own reveal route takes.
  revealAudit: `${API_NAMESPACE}/codex/reveal-audit`,
  // GM-only: the sessions and pins that name each table scene.
  sceneLinks: `${API_NAMESPACE}/codex/scene-links`,
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
 * only through the merged `CONTENT_PATHS` catalogs, and only records that are published, not deleted, in a pack
 * that is on, and shown to everyone or to one of their characters. One polymorphic collection serves all content
 * types via `type`. `{id}` is OpenAPI-style; ids are content slugs (`hb-<slug>-<6 hex>`, <=60 chars).
 */
export const HOMEBREW_PATHS = {
  content: `${API_NAMESPACE}/homebrew/content`,
  contentById: `${API_NAMESPACE}/homebrew/content/{id}`,
  contentRestore: `${API_NAMESPACE}/homebrew/content/{id}/restore`,
  contentDuplicate: `${API_NAMESPACE}/homebrew/content/{id}/duplicate`,
  contentPublish: `${API_NAMESPACE}/homebrew/content/{id}/publish`,
  contentUnpublish: `${API_NAMESPACE}/homebrew/content/{id}/unpublish`,
  contentDiscard: `${API_NAMESPACE}/homebrew/content/{id}/discard`,
  contentUsages: `${API_NAMESPACE}/homebrew/content/{id}/usages`,
  contentAudience: `${API_NAMESPACE}/homebrew/content/{id}/audience`,
  contentRevisions: `${API_NAMESPACE}/homebrew/content/{id}/revisions`,
  contentRevision: `${API_NAMESPACE}/homebrew/content/{id}/revisions/{revisionId}`,
  contentRevisionRestore: `${API_NAMESPACE}/homebrew/content/{id}/revisions/{revisionId}/restore`,
  sharing: `${API_NAMESPACE}/homebrew/sharing`,
  table: `${API_NAMESPACE}/homebrew/table`,
  overview: `${API_NAMESPACE}/homebrew/overview`,
  search: `${API_NAMESPACE}/homebrew/search`,
  srdRecord: `${API_NAMESPACE}/homebrew/srd/{id}`,
  packs: `${API_NAMESPACE}/homebrew/packs`,
  packById: `${API_NAMESPACE}/homebrew/packs/{packId}`,
  packsExport: `${API_NAMESPACE}/homebrew/packs/export`,
  packsImport: `${API_NAMESPACE}/homebrew/packs/import`,
  seeAsCompendium: `${API_NAMESPACE}/homebrew/see-as/compendium`,
  seeAsContent: `${API_NAMESPACE}/homebrew/see-as/content/{id}`,
  seeAsBuilderOffers: `${API_NAMESPACE}/homebrew/see-as/builder-offers`
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
  encounterCombatantRemove: `${API_NAMESPACE}/game/encounter/combatants/{actorId}/remove`,
  initiativeSet: `${API_NAMESPACE}/game/initiative/set`,
  initiativeSwap: `${API_NAMESPACE}/game/initiative/swap`,
  initiativeOrderTie: `${API_NAMESPACE}/game/initiative/order-tie`,
  initiativeRollSelf: `${API_NAMESPACE}/game/initiative/roll-self`,
  initiativeRollRemaining: `${API_NAMESPACE}/game/initiative/roll-remaining`,
  initiativeNext: `${API_NAMESPACE}/game/initiative/next`,
  initiativePrevious: `${API_NAMESPACE}/game/initiative/previous`,
  turnEnd: `${API_NAMESPACE}/game/turn/end`,
  turnOrder: `${API_NAMESPACE}/game/turn/order`,
  turnUse: `${API_NAMESPACE}/game/turn/use`,
  turnReaction: `${API_NAMESPACE}/game/turn/reaction`,
  turnLegendary: `${API_NAMESPACE}/game/turn/legendary`,
  tokenMove: `${API_NAMESPACE}/game/tokens/{actorId}/move`,
  tokenAltitude: `${API_NAMESPACE}/game/tokens/{actorId}/altitude`,
  actorFall: `${API_NAMESPACE}/game/actors/{actorId}/fall`,
  actorMount: `${API_NAMESPACE}/game/actors/{actorId}/mount`,
  summonCommand: `${API_NAMESPACE}/game/actors/{actorId}/summons/command`,
  summonDismiss: `${API_NAMESPACE}/game/actors/{actorId}/summon/dismiss`,
  summonRecall: `${API_NAMESPACE}/game/actors/{actorId}/summon/recall`,
  summonLook: `${API_NAMESPACE}/game/actors/{actorId}/summon/look`,
  actors: `${API_NAMESPACE}/game/actors`,
  actorById: `${API_NAMESPACE}/game/actors/{actorId}`,
  sampleCharactersRemove: `${API_NAMESPACE}/game/sample-characters/remove`,
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
  actorRevive: `${API_NAMESPACE}/game/actors/{actorId}/revive`,
  actorStabilize: `${API_NAMESPACE}/game/actors/{actorId}/stabilize`,
  actorRechoose: `${API_NAMESPACE}/game/actors/{actorId}/rechoose`,
  actorSpendHitDice: `${API_NAMESPACE}/game/actors/{actorId}/spend-hit-dice`,
  actorSpendUses: `${API_NAMESPACE}/game/actors/{actorId}/uses/spend`,
  actorRestoreUses: `${API_NAMESPACE}/game/actors/{actorId}/uses/restore`,
  actorConvert: `${API_NAMESPACE}/game/actors/{actorId}/convert`,
  restAsk: `${API_NAMESPACE}/game/actors/{actorId}/long-rest-request`,
  restAnswer: `${API_NAMESPACE}/game/actors/{actorId}/long-rest-request/answer`,
  restParty: `${API_NAMESPACE}/game/rests/party`,
  restMarkDone: `${API_NAMESPACE}/game/rests/party/{actorId}/done`,
  restFinish: `${API_NAMESPACE}/game/rests/party/finish`,
  timePass: `${API_NAMESPACE}/game/time/pass`,
  survival: `${API_NAMESPACE}/game/survival`,
  actorNourish: `${API_NAMESPACE}/game/actors/{actorId}/nourish`,
  actorBreath: `${API_NAMESPACE}/game/actors/{actorId}/breath`,
  timeSetDawn: `${API_NAMESPACE}/game/time/dawn`,
  characterSetSlot: `${API_NAMESPACE}/game/actors/{actorId}/spell-slot`,
  characterSetPrepared: `${API_NAMESPACE}/game/actors/{actorId}/prepared-spell`,
  characterFinishPreparing: `${API_NAMESPACE}/game/actors/{actorId}/finish-preparing`,
  characterSwapSpell: `${API_NAMESPACE}/game/actors/{actorId}/swap-spell`,
  characterAddToSpellbook: `${API_NAMESPACE}/game/actors/{actorId}/spellbook`,
  characterSetInventory: `${API_NAMESPACE}/game/actors/{actorId}/inventory`,
  characterGiveItem: `${API_NAMESPACE}/game/actors/{actorId}/inventory/give`,
  characterStudyItem: `${API_NAMESPACE}/game/actors/{actorId}/inventory/study`,
  characterRecoverAmmunition: `${API_NAMESPACE}/game/actors/{actorId}/inventory/recover-ammunition`,
  characterSetCurrency: `${API_NAMESPACE}/game/actors/{actorId}/currency`,
  characterSetFavourites: `${API_NAMESPACE}/game/actors/{actorId}/favourites`,
  characterSetKnownForms: `${API_NAMESPACE}/game/actors/{actorId}/known-forms`,
  characterNextLevel: `${API_NAMESPACE}/game/actors/{actorId}/next-level`,
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
  checkRoll: `${API_NAMESPACE}/game/actors/{actorId}/check`,
  checkReroll: `${API_NAMESPACE}/game/actors/{actorId}/check/reroll`,
  checkAnswer: `${API_NAMESPACE}/game/actors/{actorId}/check/answer`,
  actorHeroicInspiration: `${API_NAMESPACE}/game/actors/{actorId}/heroic-inspiration`,
  actorGiveHeroicInspiration: `${API_NAMESPACE}/game/actors/{actorId}/heroic-inspiration/give`,
  awardExperience: `${API_NAMESPACE}/game/experience/award`,
  rollCalls: `${API_NAMESPACE}/game/roll-calls`,
  rollCallAnswer: `${API_NAMESPACE}/game/roll-calls/{callId}/answer`,
  rollCallClose: `${API_NAMESPACE}/game/roll-calls/{callId}/close`,
  rulesAsk: `${API_NAMESPACE}/game/rules/ask`,
  rulesAnswer: `${API_NAMESPACE}/game/rules/answer`,
  stagingDefaults: `${API_NAMESPACE}/game/table/staging-defaults`,
  partyVisibility: `${API_NAMESPACE}/game/table/party-visibility`,
  annotations: `${API_NAMESPACE}/game/annotations`,
  annotationsPing: `${API_NAMESPACE}/game/annotations/ping`,
  annotationsClear: `${API_NAMESPACE}/game/annotations/clear`,
  annotationById: `${API_NAMESPACE}/game/annotations/{id}`,
  annotationMove: `${API_NAMESPACE}/game/annotations/{id}/move`,
  spellZonePlace: `${API_NAMESPACE}/game/spell-zones/{zoneId}/place`,
  spellZoneEnd: `${API_NAMESPACE}/game/spell-zones/{zoneId}/end`,
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
  actorAttitude: `${API_NAMESPACE}/game/actors/{actorId}/attitude`,
  actorSpeed: `${API_NAMESPACE}/game/actors/{actorId}/speed`,
  actorArmorClass: `${API_NAMESPACE}/game/actors/{actorId}/armor-class`,
  scenes: `${API_NAMESPACE}/game/scenes`,
  sceneById: `${API_NAMESPACE}/game/scenes/{sceneId}`,
  sceneRename: `${API_NAMESPACE}/game/scenes/{sceneId}/rename`,
  sceneActivate: `${API_NAMESPACE}/game/scenes/{sceneId}/activate`,
  sceneCombatants: `${API_NAMESPACE}/game/scenes/{sceneId}/combatants`,
  sceneDuplicate: `${API_NAMESPACE}/game/scenes/{sceneId}/duplicate`,
  sceneReorder: `${API_NAMESPACE}/game/scenes/reorder`,
  scenePreview: `${API_NAMESPACE}/game/scenes/{sceneId}/preview`,
  fogEnabled: `${API_NAMESPACE}/game/fog/enabled`,
  fogPaint: `${API_NAMESPACE}/game/fog/paint`,
  fogReset: `${API_NAMESPACE}/game/fog/reset`,
  terrainPaint: `${API_NAMESPACE}/game/terrain/paint`,
  terrainReset: `${API_NAMESPACE}/game/terrain/reset`,
  // The sound board (ADR-0024): GM-grade, kept apart from the game state and its revision.
  sound: `${API_NAMESPACE}/game/sound`,
  soundArrange: `${API_NAMESPACE}/game/sound/arrange`,
  soundPlay: `${API_NAMESPACE}/game/sound/play`,
  soundStop: `${API_NAMESPACE}/game/sound/stop`,
  soundNextTrack: `${API_NAMESPACE}/game/sound/next-track`,
  soundPause: `${API_NAMESPACE}/game/sound/pause`,
  sceneSound: `${API_NAMESPACE}/game/scenes/{sceneId}/sound`,
  visionEnabled: `${API_NAMESPACE}/game/vision/enabled`,
  visionAmbient: `${API_NAMESPACE}/game/vision/ambient`,
  visionExploredReset: `${API_NAMESPACE}/game/vision/explored/reset`,
  visionPreview: `${API_NAMESPACE}/game/vision/preview`,
  walls: `${API_NAMESPACE}/game/walls`,
  wallsClear: `${API_NAMESPACE}/game/walls/clear`,
  wallById: `${API_NAMESPACE}/game/walls/{wallId}`,
  wallMove: `${API_NAMESPACE}/game/walls/{wallId}/move`,
  doorOpen: `${API_NAMESPACE}/game/doors/{wallId}/open`,
  lights: `${API_NAMESPACE}/game/lights`,
  lightById: `${API_NAMESPACE}/game/lights/{lightId}`,
  lightMove: `${API_NAMESPACE}/game/lights/{lightId}/move`,
  visionAreas: `${API_NAMESPACE}/game/vision/areas`,
  visionAreaById: `${API_NAMESPACE}/game/vision/areas/{areaId}`,
  itemLight: `${API_NAMESPACE}/game/actors/{actorId}/items/{itemId}/light`
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
  /** Outside `/monsters/` so it can never be read as a definition id. */
  monsterBenchmarks: `${API_NAMESPACE}/content/monster-benchmarks`,
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
  names: `${API_NAMESPACE}/content/names`,
  /** The Compendium: one kind of the SRD and the homebrew this reader receives. No monsters. */
  compendium: `${API_NAMESPACE}/content/compendium`
} as const;

/** The archive document's schema version; the generated reference interpolates it. */
export const ENCOUNTER_ARCHIVE_SCHEMA_VERSION = 3 as const;

/** Permanent Time Machine records of ended encounters (archiveSchemaVersion 3). GM-grade only: documents hold full state. */
export const ENCOUNTER_ARCHIVE_PATHS = {
  collection: `${API_NAMESPACE}/encounters`,
  byId: `${API_NAMESPACE}/encounters/{id}`,
  visibility: `${API_NAMESPACE}/encounters/{id}/visibility`,
  /** The GM's own name for a replay. */
  name: `${API_NAMESPACE}/encounters/{id}/name`,
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
        details: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Facts about the error. On a refused game command or read, `reason` is a stable code for why, finer than `code` and safe to branch on (the message may be reworded): not_joined, validation_failed, forbidden, not_found, stale_revision, needs_confirm, refused, history_review, scene_room_full or internal_error; a rules-mode block's reason is the blocking rule's id (`details.blocked.rule`)."
          ),
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
    token: z
      .string()
      .min(1)
      .describe("Shown exactly once; the server stores only a salted hash and cannot redisplay it.")
  })
  .strict();

export const RotateIntegrationCredentialRequestSchema = z
  .object({
    /** Omit to keep the current expiration; pass null to clear it; pass a timestamp to set a new one. */
    expiresAt: TimestampSchema.nullable().optional().describe("Omit to keep the current expiration; null clears it.")
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
  "encounter.remove-combatant": {
    scope: "combat:write",
    method: "post",
    path: GAME_PATHS.encounterCombatantRemove
  },
  "initiative.set": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeSet },
  "initiative.swap": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeSwap },
  "initiative.order-tie": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeOrderTie },
  "initiative.next": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeNext },
  "initiative.previous": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativePrevious },
  "initiative.roll-self": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeRollSelf },
  "initiative.roll-remaining": { scope: "combat:write", method: "post", path: GAME_PATHS.initiativeRollRemaining },
  "turn.end": { scope: "combat:write", method: "post", path: GAME_PATHS.turnEnd },
  "turn.order": { scope: "combat:write", method: "post", path: GAME_PATHS.turnOrder },
  "turn.use": { scope: "combat:write", method: "post", path: GAME_PATHS.turnUse },
  "turn.use-reaction": { scope: "combat:write", method: "post", path: GAME_PATHS.turnReaction },
  "turn.use-legendary": { scope: "combat:write", method: "post", path: GAME_PATHS.turnLegendary },
  "token.move": { scope: "combat:write", method: "post", path: GAME_PATHS.tokenMove },
  "token.set-altitude": { scope: "combat:write", method: "post", path: GAME_PATHS.tokenAltitude },
  "actor.fall": { scope: "combat:write", method: "post", path: GAME_PATHS.actorFall },
  "actor.mount": { scope: "combat:write", method: "post", path: GAME_PATHS.actorMount },
  "summon.command": { scope: "combat:write", method: "post", path: GAME_PATHS.summonCommand },
  "summon.dismiss": { scope: "combat:write", method: "post", path: GAME_PATHS.summonDismiss },
  "summon.recall": { scope: "combat:write", method: "post", path: GAME_PATHS.summonRecall },
  "summon.look": { scope: "combat:write", method: "post", path: GAME_PATHS.summonLook },
  "actor.add-from-definition": { scope: "actor:write", method: "post", path: GAME_PATHS.actors },
  "actor.import-definition": { scope: "actor:write", method: "post", path: GAME_PATHS.definitionsImport },
  "character.submit-import": { scope: "actor:write", method: "post", path: GAME_PATHS.characterImports },
  "character.resolve-import": { scope: "actor:write", method: "post", path: GAME_PATHS.characterImportResolve },
  "actor.remove": { scope: "actor:write", method: "delete", path: GAME_PATHS.actorById },
  "actor.remove-samples": { scope: "actor:write", method: "post", path: GAME_PATHS.sampleCharactersRemove },
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
  "actor.stabilize": { scope: "combat:write", method: "post", path: GAME_PATHS.actorStabilize },
  "encounter.set-rules-mode": { scope: "combat:write", method: "post", path: GAME_PATHS.rulesMode },
  "rules.set-policy": { scope: "combat:write", method: "post", path: GAME_PATHS.rulesPolicy },
  "action.use": { scope: "combat:write", method: "post", path: GAME_PATHS.actionUse },
  "save.roll": { scope: "combat:write", method: "post", path: GAME_PATHS.saveRoll },
  "check.roll": { scope: "combat:write", method: "post", path: GAME_PATHS.checkRoll },
  "check.reroll": { scope: "combat:write", method: "post", path: GAME_PATHS.checkReroll },
  "check.answer": { scope: "combat:write", method: "post", path: GAME_PATHS.checkAnswer },
  "roll-call.start": { scope: "combat:write", method: "post", path: GAME_PATHS.rollCalls },
  "roll-call.answer": { scope: "combat:write", method: "post", path: GAME_PATHS.rollCallAnswer },
  "roll-call.close": { scope: "combat:write", method: "post", path: GAME_PATHS.rollCallClose },
  "actor.set-heroic-inspiration": {
    scope: "actor:write",
    method: "post",
    path: GAME_PATHS.actorHeroicInspiration
  },
  "actor.give-heroic-inspiration": {
    scope: "actor:write",
    method: "post",
    path: GAME_PATHS.actorGiveHeroicInspiration
  },
  "actor.award-experience": { scope: "actor:write", method: "post", path: GAME_PATHS.awardExperience },
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
  "actor.revive": { scope: "actor:write", method: "post", path: GAME_PATHS.actorRevive },
  "actor.rechoose": { scope: "actor:write", method: "post", path: GAME_PATHS.actorRechoose },
  "actor.spend-hit-dice": { scope: "actor:write", method: "post", path: GAME_PATHS.actorSpendHitDice },
  "actor.spend-uses": { scope: "actor:write", method: "post", path: GAME_PATHS.actorSpendUses },
  "actor.restore-uses": { scope: "actor:write", method: "post", path: GAME_PATHS.actorRestoreUses },
  "actor.convert": { scope: "actor:write", method: "post", path: GAME_PATHS.actorConvert },
  "rest.ask": { scope: "actor:write", method: "post", path: GAME_PATHS.restAsk },
  "rest.answer": { scope: "actor:write", method: "post", path: GAME_PATHS.restAnswer },
  "rest.party": { scope: "actor:write", method: "post", path: GAME_PATHS.restParty },
  "rest.mark-done": { scope: "actor:write", method: "post", path: GAME_PATHS.restMarkDone },
  "rest.finish": { scope: "actor:write", method: "post", path: GAME_PATHS.restFinish },
  "time.pass": { scope: "combat:write", method: "post", path: GAME_PATHS.timePass },
  "survival.set-tracking": { scope: "combat:write", method: "post", path: GAME_PATHS.survival },
  "actor.nourish": { scope: "actor:write", method: "post", path: GAME_PATHS.actorNourish },
  "actor.hold-breath": { scope: "actor:write", method: "post", path: GAME_PATHS.actorBreath },
  "time.set-dawn": { scope: "combat:write", method: "post", path: GAME_PATHS.timeSetDawn },
  "character.set-slot": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetSlot },
  "character.set-prepared": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetPrepared },
  "character.finish-preparing": {
    scope: "actor:write",
    method: "post",
    path: GAME_PATHS.characterFinishPreparing
  },
  "character.swap-spell": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSwapSpell },
  "character.add-to-spellbook": { scope: "actor:write", method: "post", path: GAME_PATHS.characterAddToSpellbook },
  "character.set-inventory": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetInventory },
  "character.give-item": { scope: "actor:write", method: "post", path: GAME_PATHS.characterGiveItem },
  "character.study-item": { scope: "actor:write", method: "post", path: GAME_PATHS.characterStudyItem },
  "character.recover-ammunition": {
    scope: "actor:write",
    method: "post",
    path: GAME_PATHS.characterRecoverAmmunition
  },
  "character.set-currency": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetCurrency },
  "character.set-favourites": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetFavourites },
  "character.set-known-forms": { scope: "actor:write", method: "post", path: GAME_PATHS.characterSetKnownForms },
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
  "spell-zone.place": { scope: "combat:write", method: "post", path: GAME_PATHS.spellZonePlace },
  "spell-zone.end": { scope: "combat:write", method: "post", path: GAME_PATHS.spellZoneEnd },
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
  "actor.set-attitude": { scope: "actor:write", method: "post", path: GAME_PATHS.actorAttitude },
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
  "terrain.reset": { scope: "scene:write", method: "post", path: GAME_PATHS.terrainReset },
  "sound.arrange": { scope: "scene:write", method: "post", path: GAME_PATHS.soundArrange },
  "sound.play": { scope: "scene:write", method: "post", path: GAME_PATHS.soundPlay },
  "sound.stop": { scope: "scene:write", method: "post", path: GAME_PATHS.soundStop },
  "sound.next-track": { scope: "scene:write", method: "post", path: GAME_PATHS.soundNextTrack },
  "sound.pause": { scope: "scene:write", method: "post", path: GAME_PATHS.soundPause },
  "sound.set-scene-preset": { scope: "scene:write", method: "post", path: GAME_PATHS.sceneSound },
  "vision.set-enabled": { scope: "scene:write", method: "post", path: GAME_PATHS.visionEnabled },
  "vision.set-ambient": { scope: "scene:write", method: "post", path: GAME_PATHS.visionAmbient },
  "vision.reset-explored": { scope: "scene:write", method: "post", path: GAME_PATHS.visionExploredReset },
  "wall.add": { scope: "scene:write", method: "post", path: GAME_PATHS.walls },
  "wall.move": { scope: "scene:write", method: "post", path: GAME_PATHS.wallMove },
  "wall.remove": { scope: "scene:write", method: "delete", path: GAME_PATHS.wallById },
  "wall.clear": { scope: "scene:write", method: "post", path: GAME_PATHS.wallsClear },
  // Players open doors beside their own character, so it is a combat command.
  "door.set-open": { scope: "combat:write", method: "post", path: GAME_PATHS.doorOpen },
  "light.add": { scope: "scene:write", method: "post", path: GAME_PATHS.lights },
  "light.move": { scope: "scene:write", method: "post", path: GAME_PATHS.lightMove },
  "light.remove": { scope: "scene:write", method: "delete", path: GAME_PATHS.lightById },
  "vision.add-area": { scope: "scene:write", method: "post", path: GAME_PATHS.visionAreas },
  "vision.remove-area": { scope: "scene:write", method: "delete", path: GAME_PATHS.visionAreaById },
  // A player lights a Torch in their own character's hand, so it is a combat command.
  "item.set-light": { scope: "combat:write", method: "post", path: GAME_PATHS.itemLight }
} as const satisfies Record<
  string,
  Readonly<{ scope: z.infer<typeof IntegrationScopeSchema>; method: "post" | "delete"; path: string }>
>;
export type GameCommandType = keyof typeof GAME_COMMANDS;

/** The generic command tunnel's request (dot-separated command types). `commandId` is the idempotency key: resend
 * it to retry safely; omit it and the server mints one. */
export const GameCommandEnvelopeSchema = z
  .object({
    type: GameCommandTypeSchema.describe("A cataloged command type, e.g. encounter.start or actor.apply-damage"),
    commandId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    payload: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "The command's Socket.IO payload shape, minus commandId/expectedRevision (carried at the envelope level)"
      )
  })
  .strict();

/** Every accepted mutation resolves to at least this; individual commands append extras (rollId, actorId, resolution, ...). */
export const GameMutationAcceptedSchema = z
  .object({
    commandId: z.uuid(),
    revision: z.number().int().nonnegative(),
    duplicate: z
      .boolean()
      .describe(
        "True when this commandId was already processed; the stored outcome's revision is returned and nothing re-executed."
      )
  })
  .catchall(z.unknown())
  .describe(
    "Commands append extras: rollId/hiddenFromRoller (dice), actorId (adds/imports), annotationId, resolution (action.resolve), outcome (save.answer), type (tunnel)."
  );

export const GameViewKindSchema = z.enum(["gm", "player"]);
/** The projection envelope for GET /game. `game` is the full GM view or the player-safe view: shapes owned by @vtt/domain and not duplicated here. */
export const GameSnapshotSchema = z
  .object({
    view: GameViewKindSchema,
    revision: z.number().int().nonnegative(),
    game: z
      .record(z.string(), z.unknown())
      .describe(
        "GmView (full state + presence + turnHistory) or PlayerView (visibility-filtered actors with banded monster HP, filtered rolls/annotations/saves), exactly what the same principal receives over Socket.IO."
      )
  })
  .strict();

/** A roll as the log carries it: the domain's `RollRecord` without the session that rolled it. */
export const LoggedRollSchema = z.record(z.string(), z.unknown());
/** `kind` stays an open string so a new log kind is an additive change. */
export const GameLogEntrySchema = z
  .object({
    id: z.number().int().positive(),
    at: TimestampSchema,
    kind: z
      .string()
      .min(1)
      .max(40)
      .describe(
        "damage, heal, save, action, condition, reaction, turn, encounter, scene, history, roll, movement, effect, death-save or override; the list grows over time"
      ),
    text: z.string(),
    gmOnly: z.boolean(),
    revision: z.number().int().nonnegative(),
    actorId: z
      .string()
      .nullable()
      .optional()
      .describe("The character or monster the line is about. A line about the whole table has none."),
    roll: LoggedRollSchema.optional().describe("The roll behind a `roll` line."),
    private: z
      .boolean()
      .optional()
      .describe("True only on a roll the reader made for their own eyes. It is worked out for each reader.")
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
    playerVisible: z.boolean().describe("Whether the GM has shared this record with players. False until shared"),
    /** The GM's own name for the replay; null until the GM gives one. A player sees it on a shared replay. */
    name: z
      .string()
      .min(1)
      .max(80)
      .nullable()
      .describe("The GM's own name for the replay, or null; a player sees it on a shared replay"),
    /** The live scene the fight was on, when it had one. GM-only: a player's list leaves it out, as their view
     *  of the table never names scenes. */
    sceneName: z
      .string()
      .nullable()
      .optional()
      .describe("The live scene the fight was on, or null. GM-grade callers only; a player's list leaves it out")
  })
  .strict();
export const EncounterArchiveListSchema = z.object({ encounters: z.array(EncounterArchiveSummarySchema) }).strict();
export const EncounterArchiveVisibilitySchema = z
  .object({ id: z.number().int().positive(), playerVisible: z.boolean() })
  .strict();
/** Renames a replay; null (or an empty name) takes the GM's name away again. */
export const EncounterArchiveNameRequestSchema = z.object({ name: z.string().trim().max(80).nullable() }).strict();
/** Shares a replay with players, or takes it back. Keys beside `playerVisible` are ignored. */
export const EncounterArchiveVisibilityRequestSchema = z.object({
  playerVisible: z.boolean().describe("True shares this fight with players; false hides it again, as it starts.")
});
export const EncounterArchiveNameSchema = z
  .object({ id: z.number().int().positive(), name: z.string().min(1).max(80).nullable() })
  .strict();
/** `document` is the stored archive JSON verbatim (archiveSchemaVersion 3); its full shape is documented in apps/server/src/encounter-archive.ts. */
export const EncounterArchiveDocumentSchema = z
  .object({
    id: z.number().int().positive(),
    document: z
      .record(z.string(), z.unknown())
      .describe(
        "archiveSchemaVersion 3 (additive over 1 and 2): { archiveSchemaVersion, startedAt, endedAt, turnCount, turns[{index,kind,label,revision,at,state}], log[], journal[{seq,commandId,type,actorId,principal,payload,revision,at}], finalState, postEncounterState, rolls[], definitions[{id,source,definition}], attribution }"
      )
  })
  .strict();
/** What `POST /encounters/{id}/launch` returns: the new live scene and the combatants it cloned. */
export const EncounterArchiveLaunchSchema = z
  .object({
    commandId: z.uuid(),
    revision: z.number().int().nonnegative(),
    duplicate: z.boolean(),
    sceneId: z.string().describe("The new live scene holding the restored moment"),
    actorIds: z
      .array(z.string())
      .describe("The cloned combatants, so a client can offer to remove them with the replay scene")
  })
  .strict();
export const EncounterArchiveDeletedSchema = z
  .object({ id: z.number().int().positive(), deleted: z.literal(true) })
  .strict();

/** Issued by POST /sessions/player: the same open, LAN-trust join the socket performs. */
export const PlayerSessionIssuedSchema = z
  .object({
    token: z
      .string()
      .min(1)
      .describe("Bearer token for player-limited calls; long-lived, with no per-token revocation (LAN trust)."),
    sessionId: z.uuid()
  })
  .strict();

export const GameMutationAcceptedResponseSchema = successEnvelopeSchema(GameMutationAcceptedSchema);
export const GameSnapshotResponseSchema = successEnvelopeSchema(GameSnapshotSchema);
export const GameLogResponseSchema = successEnvelopeSchema(GameLogSchema);
export const GameCommandCatalogResponseSchema = successEnvelopeSchema(GameCommandCatalogSchema);
export const EncounterArchiveListResponseSchema = successEnvelopeSchema(EncounterArchiveListSchema);
export const EncounterArchiveDocumentResponseSchema = successEnvelopeSchema(EncounterArchiveDocumentSchema);
export const EncounterArchiveDeletedResponseSchema = successEnvelopeSchema(EncounterArchiveDeletedSchema);
export const EncounterArchiveVisibilityResponseSchema = successEnvelopeSchema(EncounterArchiveVisibilitySchema);
export const EncounterArchiveNameResponseSchema = successEnvelopeSchema(EncounterArchiveNameSchema);
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
/** Set only by `/publish` and `/unpublish`. A draft is always Hidden; `/unpublish` hides the record. */
export const HomebrewContentStateSchema = z.enum(["draft", "published"]);
/** Who sees a record: the GM only, every player, or the players of the party characters in `characterIds`. */
export const HomebrewAudienceSchema = z.enum(["hidden", "everyone", "characters"]);
/** Party characters by actor id. */
const HomebrewCharacterIdsSchema = z.array(z.uuid()).max(12);
/** Where a record or a catalog row came from. */
const HomebrewSourceKindSchema = z.enum(["srd", "homebrew"]);
/** A persisted homebrew id (`hb-<slug>-<6 hex>`). Capped at 60, below the content id's 80: persisted ActorDefinition ids cap at 60,
 * and a longer one would fail `GameStateSchema.parse` on the next boot. */
export const HomebrewIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(60);
/** The offending field, machine-addressable, so a form editor can point at it with no prose to parse. */
export const HomebrewValidationIssueSchema = z
  .object({
    path: z
      .array(z.union([z.string(), z.number().int()]))
      .describe(
        'Field path into the authored record, e.g. ["levelTable", 3, "spellSlots"]: the offending field, machine-addressable, so a form editor can point at it with no prose to parse'
      ),
    message: z.string().min(1).max(500),
    recordId: HomebrewIdSchema.nullable().describe(
      "Which record in a pack the issue belongs to; null for a single-record publish. Present-but-null, so a consumer never branches on key presence"
    )
  })
  .strict();
/** `warnings` never block publishing: an open slug the SRD does not know, which is legal but often a typo. */
export const HomebrewValiditySchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(HomebrewValidationIssueSchema),
    warnings: z.array(HomebrewValidationIssueSchema)
  })
  .strict()
  .describe(
    "Whether a record may be published, and why not. Carried on every single-record read so the GM's library can say \"3 drafts can't publish yet\" without a round-trip per record."
  );
/** The authored content body only, never row state. Opaque until each type's authored shape lands; see the HomebrewRecord component. */
export const HomebrewRecordSchema = z.record(z.string(), z.unknown());
/** When a published record reached one audience: `everyone`, or a character's actor id. */
export const HomebrewRevealSchema = z
  .object({ to: z.union([z.literal("everyone"), z.uuid()]), at: TimestampSchema })
  .strict();
/** What a duplicate was copied from, for Compare. */
export const HomebrewBasedOnSchema = z
  .object({
    source: HomebrewSourceKindSchema,
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    name: z.string().min(1).max(120),
    copiedAt: TimestampSchema
  })
  .strict();
/** The record an id in a body names, so an editor shows its name. */
export const HomebrewReferenceSchema = z
  .object({ type: HomebrewContentTypeSchema, name: z.string().min(1).max(120), source: HomebrewSourceKindSchema })
  .strict();
const CasterTypeSchema = z.enum(["full", "half", "third", "pact", "none"]);
/** A kind's own table columns, read from the body. Every key is optional, and null when the body does not say. */
export const HomebrewTableColumnsSchema = z
  .object({
    level: z.number().int().nullable().optional(),
    school: z.string().max(40).nullable().optional(),
    castingTime: z.string().max(200).nullable().optional(),
    range: z.string().max(200).nullable().optional(),
    lists: z.array(z.string().max(80)).nullable().optional(),
    challengeRating: z.number().nullable().optional(),
    size: z.string().max(40).nullable().optional(),
    creatureType: z.string().max(80).nullable().optional(),
    armorClass: z.number().int().nullable().optional(),
    hitPoints: z.number().int().nullable().optional(),
    itemKind: z.string().max(40).nullable().optional(),
    rarity: z.string().max(40).nullable().optional(),
    attunement: z
      .object({ required: z.boolean(), restrictedTo: z.array(z.string().max(80)) })
      .strict()
      .nullable()
      .optional(),
    hitDie: z.string().max(8).nullable().optional(),
    primaryAbilities: z.array(z.string().max(8)).nullable().optional(),
    casterType: CasterTypeSchema.nullable().optional(),
    classId: z.string().max(80).nullable().optional(),
    speedFeet: z.number().int().nullable().optional(),
    originFeatId: z.string().max(80).nullable().optional(),
    category: z.string().max(40).nullable().optional(),
    prerequisiteLevel: z.number().int().nullable().optional(),
    spellCount: z.number().int().nonnegative().nullable().optional()
  })
  .strict();
export const HomebrewRecordDocumentSchema = z
  .object({
    id: HomebrewIdSchema,
    type: HomebrewContentTypeSchema,
    state: HomebrewContentStateSchema,
    audience: HomebrewAudienceSchema.describe(
      "Who sees it: hidden (the GM only), everyone, or characters (the players of the party characters in `characterIds`). Publishing does not reveal: sharing is the separate, deliberate second step, and a draft is always hidden"
    ),
    characterIds: HomebrewCharacterIdsSchema.describe("Non-empty exactly when `audience` is `characters`"),
    reveals: z
      .array(HomebrewRevealSchema)
      .describe("A stamp for each time the published record reached a new audience, oldest first. Hiding keeps them"),
    packId: z.string().max(60).describe("The record's pack: `table` for this table's own, or an imported pack's id"),
    packName: z.string().max(120).nullable().describe("The pack's name; null for this table's own pack"),
    inCatalogs: z
      .boolean()
      .describe(
        "Published, not deleted, and its pack is on: what every catalog, the GM's pickers and the bestiary hold"
      ),
    basedOn: HomebrewBasedOnSchema.nullable(),
    references: z
      .record(z.string().max(80), HomebrewReferenceSchema)
      .describe(
        "Every other record the body names by id, with its name, so an editor shows a name where the body holds an id"
      ),
    deletedAt: TimestampSchema.nullable().describe(
      "Soft delete; a deleted row leaves every merged catalog at once and is restorable"
    ),
    rev: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    validity: HomebrewValiditySchema,
    /** A published record has edits that are not live yet; `record` and `validity` describe them. */
    pendingChanges: z
      .boolean()
      .describe(
        "A published record has edits that are not live yet. `record` and `validity` describe the pending body; the catalogs still serve the live one until /publish"
      ),
    record: HomebrewRecordSchema
  })
  .strict()
  .describe(
    "One stored row: the authored body plus its row state. `state` is set only by /publish and /unpublish, `audience` only by /audience and /sharing (and /unpublish, which hides), `deletedAt` only by DELETE and /restore. A player receives a record only when it is published, not deleted, in a pack that is on, and shared with everyone or one of that player's characters, and even then only through the merged CONTENT_PATHS catalogs, never through this component."
  );
/** The flat, NON-polymorphic list row: the row state and the kind's own columns, so the union stays out of the
 *  library's hot path. */
export const HomebrewRecordSummarySchema = z
  .object({
    id: HomebrewIdSchema,
    type: HomebrewContentTypeSchema,
    name: z.string().min(1).max(120),
    source: z
      .literal("homebrew")
      .describe(
        'Always "homebrew" on this surface; the field exists so a summary and a merged-catalog row read the same'
      ),
    state: HomebrewContentStateSchema,
    audience: HomebrewAudienceSchema,
    characterIds: HomebrewCharacterIdsSchema,
    packId: z.string().max(60),
    packName: z.string().max(120).nullable(),
    inCatalogs: z.boolean(),
    deletedAt: TimestampSchema.nullable(),
    rev: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    valid: z.boolean().describe("The live body publishes. A held edit is counted in `issueCount` instead"),
    pendingChanges: z.boolean(),
    issueCount: z
      .number()
      .int()
      .nonnegative()
      .describe("How many publish issues the body the editor shows has, pending edits included"),
    basedOn: HomebrewBasedOnSchema.nullable(),
    usageCount: z.number().int().nonnegative().describe("How many characters took this record; 0 is the common case"),
    columns: HomebrewTableColumnsSchema
  })
  .strict()
  .describe(
    "The flat, deliberately non-polymorphic list row: the row state, the issue count and the kind's own columns. The issue list costs a GET, so listing a 300-record library never ships a 20-row level table."
  );
export const HomebrewContentListSchema = z
  .object({
    records: z.array(HomebrewRecordSummarySchema),
    nextCursor: z
      .string()
      .max(200)
      .nullable()
      .describe("Opaque keyset cursor. Never construct or parse one. null means this was the last page"),
    total: z
      .number()
      .int()
      .nonnegative()
      .describe("How many rows match the filter. `limit` and `cursor` do not change it")
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
      .max(60)
      .describe("How the record is used: open slug (character-choice, class, species, ...), never a closed enum"),
    detail: z.string().max(300).nullable()
  })
  .strict();
/** A published record that is publishable now and would stop being so. */
export const HomebrewDependentSchema = z
  .object({ id: HomebrewIdSchema, type: HomebrewContentTypeSchema, name: z.string().min(1).max(120) })
  .strict()
  .describe("A published record another record's removal or edit would break: enough to name it and open it.");
export const HomebrewUsagesSchema = z
  .object({
    id: HomebrewIdSchema,
    usages: z.array(HomebrewUsageSchema),
    /** False when removing this record would break a published one; built characters never break. */
    safeToDelete: z
      .boolean()
      .describe(
        "False when removing this record would break a published one (`dependents.ifRemoved`). Characters never count: a built character carries a flattened, self-contained ActorDefinition, so the usage list is context and blocks nothing"
      ),
    dependents: z
      .object({
        /** Broken by removing or unpublishing this record. */
        ifRemoved: z.array(HomebrewDependentSchema),
        /** Broken by putting this record's pending edits live; empty when nothing is pending. */
        ifUpdated: z.array(HomebrewDependentSchema)
      })
      .strict()
      .describe(
        "Published records that publish now and would not: `ifRemoved` once this one is removed or unpublished, `ifUpdated` once its pending edits go live. A warning to show before the action, never a refusal"
      )
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
    records: z.array(HomebrewRecordSchema).describe("Authored bodies only: no state, visibility, deletion, or revision")
  })
  .strict()
  .describe(
    "The GM-to-GM interchange format (ADR-0007 schemaId + integer schemaVersion). One flat record array: the body already carries `type`, so a by-type map would duplicate the discriminator for nothing. No checksum field by design."
  );
export const HomebrewPackExportSchema = z.object({ pack: HomebrewPackSchema }).strict();
/** A pack: this table's own records, or one imported pack. Off takes its published records out of every catalog. */
export const HomebrewPackInfoSchema = z
  .object({
    id: z.string().max(60),
    kind: z.enum(["table", "imported"]),
    /** Null for this table's own pack. */
    name: z.string().min(1).max(120).nullable(),
    credit: z.string().max(400).nullable(),
    importedAt: TimestampSchema.nullable(),
    enabled: z.boolean(),
    counts: z
      .object({
        records: z.number().int().nonnegative(),
        published: z.number().int().nonnegative(),
        drafts: z.number().int().nonnegative(),
        shared: z.number().int().nonnegative(),
        archived: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();
export const HomebrewPackListSchema = z
  .object({
    srd: z.object({ records: z.number().int().nonnegative() }).strict(),
    packs: z.array(HomebrewPackInfoSchema)
  })
  .strict();
export const HomebrewPackResultSchema = z.object({ pack: HomebrewPackInfoSchema }).strict();
export const HomebrewPackUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    credit: z.string().max(400).nullable().optional(),
    enabled: z.boolean().optional()
  })
  .strict();
const HomebrewImportDecisionKindSchema = z.enum(["new", "replace", "skip", "rename"]);
/** What to do with one record of a pack, by its position in `pack.records`. */
export const HomebrewImportDecisionSchema = z
  .object({
    index: z.number().int().nonnegative(),
    decision: HomebrewImportDecisionKindSchema,
    /** For `rename`: the copy's name. Absent, it is "<name> (<pack name>)". */
    name: z.string().trim().min(1).max(120).optional()
  })
  .strict();
/** One record of a pack as the import reads it: its kind, what it clashes with here, and what the gate would say. */
export const HomebrewImportRecordSchema = z
  .object({
    index: z.number().int().nonnegative(),
    type: HomebrewContentTypeSchema.nullable(),
    name: z.string().min(1).max(120).nullable(),
    clash: z
      .object({
        source: HomebrewSourceKindSchema,
        id: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80),
        name: z.string().min(1).max(120),
        state: HomebrewContentStateSchema.nullable(),
        audience: HomebrewAudienceSchema.nullable(),
        archived: z.boolean()
      })
      .strict()
      .nullable(),
    problems: z.array(HomebrewValidationIssueSchema),
    allowed: z.array(HomebrewImportDecisionKindSchema),
    decision: HomebrewImportDecisionKindSchema,
    /** Where it landed, or would land; null when skipped or unreadable. */
    id: HomebrewIdSchema.nullable()
  })
  .strict();
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
          reason: z
            .enum(["srd-collision", "homebrew-collision", "foreign-shape"])
            .describe(
              "Why the id changed. srd-collision: outside `hb-`, the bundle's namespace, always re-minted. homebrew-collision: an existing row or an earlier record in the pack holds it; follows onIdCollision. foreign-shape: an `hb-` id this table would not mint for that type, always re-minted"
            )
        })
        .strict()
    ),
    overwritten: z.array(
      z.object({ id: HomebrewIdSchema, type: HomebrewContentTypeSchema, name: z.string().min(1).max(120) }).strict()
    ),
    rejected: z.array(
      z.object({ originalId: HomebrewIdSchema, issues: z.array(HomebrewValidationIssueSchema) }).strict()
    ),
    dryRun: z.boolean(),
    /** Every record of the pack, in order, with the decision applied (or the default, in a dry run). */
    records: z.array(HomebrewImportRecordSchema),
    /** The pack the records landed in; null for a dry run or when nothing landed. */
    pack: HomebrewPackInfoSchema.nullable()
  })
  .strict()
  .describe(
    "The import plan or its result: byte-for-byte the same report either way, which is what makes `dryRun` trustworthy."
  );
export const HomebrewCreateRequestSchema = z
  .object({ record: HomebrewRecordSchema })
  .strict()
  .describe(
    "The authored body only, with the name the GM chose: the id is minted from it and never changes. Row state is never client-supplied: a new record is always a Hidden draft in this table's own pack."
  );
export const HomebrewUpdateRequestSchema = z
  .object({
    record: HomebrewRecordSchema,
    expectedRev: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on.")
  })
  .strict()
  .describe("Replaces the whole authored body and touches no row state.");
export const HomebrewDuplicateRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "The name the GM typed for the copy; its id is minted from it. Omitted, the copy is named after its source."
      )
  })
  .strict();
export const HomebrewStateChangeRequestSchema = z
  .object({
    expectedRev: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Optimistic concurrency: reject with 409 (and `error.currentRevision`) if the row moved on.")
  })
  .strict();
/** Who sees one record. `characterIds` only, and then at least one, with `characters`. */
export const HomebrewAudienceRequestSchema = z
  .object({
    audience: HomebrewAudienceSchema,
    characterIds: HomebrewCharacterIdsSchema.optional(),
    expectedRev: z.number().int().nonnegative().optional()
  })
  .strict();
/** Who sees several records, in one write: all of them change or none does. */
export const HomebrewSharingRequestSchema = z
  .object({
    records: z
      .array(z.object({ id: HomebrewIdSchema, expectedRev: z.number().int().nonnegative().optional() }).strict())
      .min(1)
      .max(500),
    audience: HomebrewAudienceSchema,
    characterIds: HomebrewCharacterIdsSchema.optional()
  })
  .strict();
export const HomebrewSharingSchema = z.object({ records: z.array(HomebrewRecordSummarySchema) }).strict();
export const HomebrewPackImportRequestSchema = z
  .object({
    pack: HomebrewPackSchema,
    onIdCollision: z
      .enum(["remint", "overwrite"])
      .default("remint")
      .describe(
        "Without `decisions`: how to resolve a collision with an existing homebrew id; an SRD collision is always re-minted regardless."
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "Run the whole collision + rewrite + re-validate pass and return the identical report without writing."
      ),
    decisions: z
      .array(HomebrewImportDecisionSchema)
      .max(500)
      .optional()
      .describe(
        "What to do with each record, by its position in the pack: new, replace (only the GM's own draft it clashes with), skip, or rename. Send an empty list for a dry run that proposes the default decision for each record."
      )
  })
  .strict();
/** An SRD record as an authorable body: the body a duplicate starts from, with its SRD id. */
export const HomebrewSrdRecordSchema = z
  .object({ type: HomebrewContentTypeSchema, record: HomebrewRecordSchema })
  .strict();
/** One row of a kind's table: an SRD record or a homebrew one, in one shape. */
export const HomebrewTableRowSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    kind: HomebrewContentTypeSchema,
    name: z.string().min(1).max(120),
    source: HomebrewSourceKindSchema,
    /** Null for SRD rows. */
    packId: z.string().max(60).nullable(),
    /** SRD rows are published. */
    state: HomebrewContentStateSchema,
    archived: z.boolean(),
    inCatalogs: z.boolean(),
    pendingChanges: z.boolean(),
    issueCount: z.number().int().nonnegative(),
    audience: HomebrewAudienceSchema,
    characterIds: HomebrewCharacterIdsSchema,
    basedOn: HomebrewBasedOnSchema.nullable(),
    createdAt: TimestampSchema.nullable(),
    updatedAt: TimestampSchema.nullable(),
    usageCount: z.number().int().nonnegative().nullable(),
    columns: HomebrewTableColumnsSchema
  })
  .strict();
export const HomebrewTableSchema = z
  .object({ kind: HomebrewContentTypeSchema, rows: z.array(HomebrewTableRowSchema) })
  .strict();
export const HomebrewOverviewSchema = z
  .object({
    srd: z.object({ records: z.number().int().nonnegative() }).strict(),
    packs: z.array(HomebrewPackInfoSchema),
    byKind: z.array(
      z
        .object({
          kind: HomebrewContentTypeSchema,
          srd: z.number().int().nonnegative(),
          homebrew: z.number().int().nonnegative(),
          drafts: z.number().int().nonnegative(),
          shared: z.number().int().nonnegative()
        })
        .strict()
    ),
    needsYou: z.array(
      z
        .object({
          id: HomebrewIdSchema,
          kind: HomebrewContentTypeSchema,
          name: z.string().min(1).max(120),
          packId: z.string().max(60),
          reason: z.enum(["changes-not-live", "draft", "imported", "broken"]),
          issueCount: z.number().int().nonnegative(),
          since: TimestampSchema
        })
        .strict()
    )
  })
  .strict();
export const HomebrewSearchSchema = z
  .object({
    hits: z.array(
      z
        .object({
          id: HomebrewIdSchema,
          kind: HomebrewContentTypeSchema,
          name: z.string().min(1).max(120),
          packId: z.string().max(60),
          state: HomebrewContentStateSchema,
          archived: z.boolean(),
          matches: z.array(
            z.object({ path: z.array(z.union([z.string(), z.number().int()])), line: z.string().max(400) }).strict()
          )
        })
        .strict()
    ),
    total: z.number().int().nonnegative()
  })
  .strict();
const HomebrewRevisionEventSchema = z.enum([
  "create",
  "edit",
  "publish",
  "unpublish",
  "discard",
  "share",
  "archive",
  "restore",
  "import",
  "duplicate",
  "revert",
  "pack"
]);
/** One write in a record's history. */
export const HomebrewRevisionSummarySchema = z
  .object({
    id: z.number().int().positive(),
    rev: z.number().int().nonnegative(),
    at: TimestampSchema,
    event: HomebrewRevisionEventSchema,
    /** Read against the caller's GM session. */
    device: z.enum(["this-device", "other-device", "server"]),
    /** The same key for the same GM device; null for the server. */
    deviceKey: z.string().max(40).nullable(),
    name: z.string().min(1).max(120),
    state: HomebrewContentStateSchema,
    /** The body is a published record's changes that were not live. */
    pending: z.boolean(),
    audience: HomebrewAudienceSchema,
    characterIds: HomebrewCharacterIdsSchema,
    changedFields: z.array(z.string().max(80))
  })
  .strict();
export const HomebrewRevisionListSchema = z.object({ revisions: z.array(HomebrewRevisionSummarySchema) }).strict();
export const HomebrewRevisionReadSchema = z
  .object({ revision: HomebrewRevisionSummarySchema.extend({ record: HomebrewRecordSchema }).strict() })
  .strict();
/** `error.details.conflict` on a 409 for a stale `expectedRev`: what the server's copy changed since `baseRev`. */
export const HomebrewConflictSchema = z
  .object({
    baseRev: z.number().int().nonnegative(),
    currentRev: z.number().int().nonnegative(),
    /** False when no history row holds `baseRev` (very old data): the nearest earlier one stood in. */
    baseKnown: z.boolean(),
    changes: z.array(
      z.object({ field: z.string().max(80), base: z.unknown().optional(), current: z.unknown().optional() }).strict()
    ),
    rowChanges: z.array(z.enum(["state", "audience", "archived"]))
  })
  .strict();

/** Query booleans arrive as text; the two spellings a browser or curl sends are accepted. */
const QueryBooleanSchema = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");
/** `GET /homebrew/content`. Unknown keys are dropped: a stray query parameter does not refuse a read. */
export const HomebrewListQuerySchema = z.object({
  type: HomebrewContentTypeSchema.optional().describe("One type. Omit it for every type."),
  state: HomebrewContentStateSchema.optional(),
  audience: HomebrewAudienceSchema.optional().describe("Who sees it: hidden, everyone or characters."),
  packId: z
    .string()
    .max(60)
    .optional()
    .describe("Only the records of one pack: `table` for this table's own, or an imported pack's id."),
  q: z.string().max(120).optional().describe("Part of a name, matched without regard to case."),
  includeDeleted: QueryBooleanSchema.optional().describe("Lists soft-deleted records too. Default false."),
  limit: z.coerce.number().int().min(1).max(200).optional().describe("Records per page, 1 to 200. Default 50."),
  cursor: z
    .string()
    .max(200)
    .optional()
    .describe("The `nextCursor` of the page before. Opaque: pass it back as it came.")
});
/** `GET /homebrew/packs/export`. */
export const HomebrewPackExportQuerySchema = z.object({
  type: HomebrewContentTypeSchema.optional().describe("Only records of this type."),
  id: z
    .union([z.string().max(60), z.array(z.string().max(60)).max(500)])
    .optional()
    .describe("Only these records. Repeat it for several: `?id=a&id=b`. Omit it for every published record."),
  packId: z.string().max(60).optional().describe("Only the records of one pack."),
  name: z.string().trim().min(1).max(120).optional().describe('The pack\'s name. Absent, it is "Homebrew".'),
  credit: z
    .string()
    .trim()
    .max(400)
    .optional()
    .describe("Who made it, as the importing table's Sources will credit it.")
});
/** `GET /homebrew/table`. */
export const HomebrewTableQuerySchema = z.object({
  kind: HomebrewContentTypeSchema.describe("The kind of record the table lists."),
  includeArchived: QueryBooleanSchema.optional().describe("Lists archived homebrew too. Default false.")
});
/** `GET /homebrew/search`. */
export const HomebrewSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).describe("The words to find, matched without regard to case."),
  kind: HomebrewContentTypeSchema.optional().describe("Only records of this kind."),
  includeArchived: QueryBooleanSchema.optional().describe("Searches archived homebrew too. Default false."),
  limit: z.coerce.number().int().min(1).max(100).optional().describe("Hits to answer, 1 to 100. Default 50.")
});

export const HomebrewContentListResponseSchema = successEnvelopeSchema(HomebrewContentListSchema);
export const HomebrewContentResponseSchema = successEnvelopeSchema(HomebrewContentSchema);
export const HomebrewDeletedResponseSchema = successEnvelopeSchema(HomebrewDeletedSchema);
export const HomebrewUsagesResponseSchema = successEnvelopeSchema(HomebrewUsagesSchema);
export const HomebrewPackExportResponseSchema = successEnvelopeSchema(HomebrewPackExportSchema);
export const HomebrewPackImportResponseSchema = successEnvelopeSchema(HomebrewPackImportSchema);
export const HomebrewSharingResponseSchema = successEnvelopeSchema(HomebrewSharingSchema);
export const HomebrewPackListResponseSchema = successEnvelopeSchema(HomebrewPackListSchema);
export const HomebrewPackResponseSchema = successEnvelopeSchema(HomebrewPackResultSchema);
export const HomebrewSrdRecordResponseSchema = successEnvelopeSchema(HomebrewSrdRecordSchema);
export const HomebrewTableResponseSchema = successEnvelopeSchema(HomebrewTableSchema);
export const HomebrewOverviewResponseSchema = successEnvelopeSchema(HomebrewOverviewSchema);
export const HomebrewSearchResponseSchema = successEnvelopeSchema(HomebrewSearchSchema);
export const HomebrewRevisionListResponseSchema = successEnvelopeSchema(HomebrewRevisionListSchema);
export const HomebrewRevisionReadResponseSchema = successEnvelopeSchema(HomebrewRevisionReadSchema);

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
export type HomebrewAudience = z.infer<typeof HomebrewAudienceSchema>;
export type HomebrewReveal = z.infer<typeof HomebrewRevealSchema>;
export type HomebrewBasedOn = z.infer<typeof HomebrewBasedOnSchema>;
export type HomebrewReference = z.infer<typeof HomebrewReferenceSchema>;
export type HomebrewTableColumns = z.infer<typeof HomebrewTableColumnsSchema>;
export type HomebrewPackInfo = z.infer<typeof HomebrewPackInfoSchema>;
export type HomebrewPackList = z.infer<typeof HomebrewPackListSchema>;
export type HomebrewImportDecision = z.infer<typeof HomebrewImportDecisionSchema>;
export type HomebrewImportRecord = z.infer<typeof HomebrewImportRecordSchema>;
export type HomebrewSrdRecord = z.infer<typeof HomebrewSrdRecordSchema>;
export type HomebrewTableRow = z.infer<typeof HomebrewTableRowSchema>;
export type HomebrewTable = z.infer<typeof HomebrewTableSchema>;
export type HomebrewOverview = z.infer<typeof HomebrewOverviewSchema>;
export type HomebrewSearch = z.infer<typeof HomebrewSearchSchema>;
export type HomebrewRevisionSummary = z.infer<typeof HomebrewRevisionSummarySchema>;
export type HomebrewRevisionList = z.infer<typeof HomebrewRevisionListSchema>;
export type HomebrewRevisionRead = z.infer<typeof HomebrewRevisionReadSchema>;
export type HomebrewConflict = z.infer<typeof HomebrewConflictSchema>;
