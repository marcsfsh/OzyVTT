import type { z } from "zod";
import type {
  ContentActionsResult,
  ContentBackgroundsResult,
  ContentClassesResult,
  ContentConditionsResult,
  ContentGlossaryResult,
  ContentEquipmentResult,
  ContentFeatsResult,
  ContentLanguagesResult,
  ContentMonstersResult,
  ContentNamesResult,
  ContentSheetResult,
  ContentSkillsResult,
  ContentSpeciesResult,
  ContentSpellsResult,
  ContentSubclassesResult
} from "./content.js";
import type {
  ActionResolveResult,
  BuilderOffersRequest,
  BuilderOffersResult,
  ActorActionsAvailabilityResult,
  ActorAddResult,
  ActorMovementResult,
  AnnotationAddResult,
  CharacterDraftResult,
  DamageApplyResult,
  DeathSaveResult,
  DiceRollResult,
  MutationResult,
  ReactionAnswerResult,
  RulesBlocked,
  SaveAnswerResult,
  SceneCreateResult,
  StabilizeResult
} from "./results.js";
import type { ClientRole, CombatLogEntry, GmView, PlayerView } from "./views.js";

// Type-only: the payload types are read off the schemas, and the schemas stay on the server's side of the import graph.
import type {
  ActionResolveSchema,
  ActionUseSchema,
  CharacterDraftDiscardSchema,
  CharacterDraftSaveSchema,
  ActorAddFromDefinitionSchema,
  ActorImportDefinitionSchema,
  ActorRechooseSchema,
  ActorRemoveSchema,
  ActorRestSchema,
  ActorReviveSchema,
  ActorSetSpeedSchema,
  ActorSetArmorClassSchema,
  ActorStabilizeSchema,
  ActorSpendHitDiceSchema,
  ActorSpendUsesSchema,
  ActorRestoreUsesSchema,
  AddCombatantSchema,
  AnnotationAddSchema,
  AnnotationClearSchema,
  AnnotationColorSetSchema,
  AnnotationMovableSetSchema,
  AnnotationMoveSchema,
  AnnotationPingSchema,
  AnnotationRemoveSchema,
  AnnotationVisibilitySetSchema,
  ApplyDamageSchema,
  BuilderRollAbilitiesSchema,
  BuilderSetPolicySchema,
  CharacterCreateSchema,
  CharacterGenerateSchema,
  CharacterRebuildSchema,
  CharacterResolveImportSchema,
  CharacterSetCurrencySchema,
  CharacterSetIdentitySchema,
  CharacterSetInventorySchema,
  CharacterGiveItemSchema,
  CharacterSetPreparedSchema,
  CharacterFinishPreparingSchema,
  CharacterSetProficienciesSchema,
  CharacterSetSlotSchema,
  CharacterSubmitImportSchema,
  CommandIdentitySchema,
  DamageResolveSchema,
  DeathSaveRollSchema,
  DiceRollSchema,
  EffectAddSchema,
  EffectEndSchema,
  EncounterStartSchema,
  FogPaintSchema,
  FogResetSchema,
  FogSetEnabledSchema,
  TerrainPaintSchema,
  TerrainResetSchema,
  HpAmountSchema,
  InitiativeNextSchema,
  InitiativePreviousSchema,
  InitiativeRollRemainingSchema,
  InitiativeRollSelfSchema,
  InitiativeScoreSchema,
  InitiativeSwapSchema,
  ReactionAnswerSchema,
  ReactionDismissSchema,
  ReplayLaunchSchema,
  RestAnswerSchema,
  RestAskSchema,
  RestFinishSchema,
  RestMarkDoneSchema,
  RestPartySchema,
  RulesAnswerSchema,
  RulesAskSchema,
  RulesSetPolicySchema,
  SaveAnswerSchema,
  SaveDismissSchema,
  SaveRollSchema,
  SceneCreateSchema,
  SceneIdSchema,
  SceneRenameSchema,
  SceneReorderSchema,
  SceneSetCombatantsSchema,
  SetActorArchivedSchema,
  SetActorHealthDisplaySchema,
  SetActorSheetPreviewSchema,
  SetActorSizeSchema,
  SetActorVisibilitySchema,
  SetConditionSchema,
  SetEnvironmentSchema,
  SetHealthDisplaySchema,
  SetHpSchema,
  SetPlayerDamageModeSchema,
  SetPlayerInitiativeModeSchema,
  SetRulesModeSchema,
  SetTokenImageSchema,
  TableSetPartyVisibilitySchema,
  TableSetStagingDefaultsSchema,
  TempHpSchema,
  TimePassSchema,
  TokenMoveSchema,
  TurnLegendarySchema,
  TurnReactionSchema,
  TurnUseSchema
} from "./commands.js";

/** A brief, ephemeral battlemap notification ("Goblin took 6 damage"). Never stored in GameState - presentation only; the roll history is the durable record. */
export type TableEvent = Readonly<{
  id: string;
  kind: "damage" | "heal" | "save" | "action" | "condition" | "reaction" | "effect" | "death-save";
  text: string;
  actorIds: readonly string[];
  at: number;
}>;
/** The codex changed. Revision only, so each recipient refetches its own projection without learning what changed. */
export type CodexChangedEvent = Readonly<{ codexRevision: number }>;
/** The homebrew library changed. Revision only: a payload would hand players GM-only drafts. */
export type HomebrewChangedEvent = Readonly<{ revision: number }>;
export interface ServerToClientEvents {
  "state:updated": (state: PlayerView | GmView) => void;
  "system:error": (message: string) => void;
  "table:event": (event: TableEvent) => void;
  "log:entry": (entry: CombatLogEntry) => void;
  "codex:changed": (event: CodexChangedEvent) => void;
  "homebrew:changed": (event: HomebrewChangedEvent) => void;
}
export type SessionJoinResult = {
  ok: boolean;
  role?: ClientRole;
  sessionId?: string;
  token?: string;
  message?: string;
};

/** JSON a caller may build from readonly data: arrays and objects at any depth may be readonly. */
type ReadonlyJson<T> = T extends readonly (infer Item)[]
  ? readonly ReadonlyJson<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: ReadonlyJson<T[Key]> }
    : T;
/** A command's payload as a caller writes it: the input of the schema the server parses it with, so defaults
 *  may be left out and a field the server adds can't be missed here. */
type CommandPayload<Schema extends z.ZodType> = ReadonlyJson<z.input<Schema>>;

export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (
    payload: CommandPayload<typeof ActorRemoveSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:release": (
    payload: CommandPayload<typeof CommandIdentitySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:force-release": (
    payload: CommandPayload<typeof ActorRemoveSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "content:monsters": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentMonstersResult) => void
  ) => void;
  /** `joinEncounter` also adds the new combatant to the running fight (initiative + tray token) in the same command. Ignored when no fight is running. */
  "actor:add-from-definition": (
    payload: CommandPayload<typeof ActorAddFromDefinitionSchema>,
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  "actor:remove": (
    payload: CommandPayload<typeof ActorRemoveSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:import-definition": (
    payload: CommandPayload<typeof ActorImportDefinitionSchema>,
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  "character:submit-import": (
    payload: CommandPayload<typeof CharacterSubmitImportSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:resolve-import": (
    payload: CommandPayload<typeof CharacterResolveImportSchema>,
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  /** Roll a whole character server-side. The caller picks the level and optionally the class; the server makes every other pick. */
  "character:generate": (
    payload: CommandPayload<typeof CharacterGenerateSchema>,
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  /** Create a character from choices; the server's feature-rider interpreter builds and imports the ActorDefinition. */
  "character:create": (
    payload: CommandPayload<typeof CharacterCreateSchema>,
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  "builder:set-policy": (
    payload: CommandPayload<typeof BuilderSetPolicySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** The caller's parked character build (one per player session, one for the GM), or null. */
  "character:draft": (payload: Record<string, never>, acknowledgement: (result: CharacterDraftResult) => void) => void;
  /** Park the caller's in-progress build on the server, replacing any it parked before. */
  "character:save-draft": (
    payload: CommandPayload<typeof CharacterDraftSaveSchema>,
    acknowledgement: (result: MutationResult & { updatedAt?: string }) => void
  ) => void;
  /** Drop the caller's parked build. */
  "character:discard-draft": (
    payload: CommandPayload<typeof CharacterDraftDiscardSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** Rebuild or respec a character. The GM may rebuild anyone; a player only their own while the builder is open. */
  "character:rebuild": (
    payload: CommandPayload<typeof CharacterRebuildSchema>,
    acknowledgement: (result: MutationResult & { actorId?: string }) => void
  ) => void;
  /** Roll six ability scores server-side for the builder; the set lands in the table feed. */
  "builder:offers": (payload: BuilderOffersRequest, acknowledgement: (result: BuilderOffersResult) => void) => void;
  "builder:roll-abilities": (
    payload: CommandPayload<typeof BuilderRollAbilitiesSchema>,
    acknowledgement: (
      result: MutationResult & { scores?: readonly number[]; dice?: ReadonlyArray<readonly number[]>; rollId?: string }
    ) => void
  ) => void;
  /** GM sets the standing rules policy every new fight inherits. Omitted `exceptions` keeps the stored ones. */
  "rules:set-policy": (
    payload: CommandPayload<typeof RulesSetPolicySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** `route` is `resolved` (on this creature's turn in the fight) or `loose` (no fight). Off turn it returns `blocked`. */
  "action:use": (
    payload: CommandPayload<typeof ActionUseSchema>,
    acknowledgement: (
      result: MutationResult & { route?: "resolved" | "loose"; rollIds?: readonly string[]; warning?: string }
    ) => void
  ) => void;
  /** Roll a saving throw: answers a matching pending save (`route: "answered"`), else a loose attributed save. */
  "save:roll": (
    payload: CommandPayload<typeof SaveRollSchema>,
    acknowledgement: (
      result: MutationResult & { route?: "answered" | "loose"; saveId?: string; rollId?: string }
    ) => void
  ) => void;
  /** The server first re-runs the command as the player; only a still-blocked one is parked for the GM (`askId`). */
  "rules:ask": (
    payload: CommandPayload<typeof RulesAskSchema>,
    acknowledgement: (result: MutationResult & { askId?: string; ran?: boolean }) => void
  ) => void;
  /** GM answers a parked ask: Allow re-runs the parked command with an override (reason optional), Deny tells the player. */
  "rules:answer": (
    payload: CommandPayload<typeof RulesAnswerSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM sets the table's staging defaults (the visibility a newly staged combatant's token starts at). */
  "table:set-staging-defaults": (
    payload: CommandPayload<typeof TableSetStagingDefaultsSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM sets how much a player sees of another player's character; enforced in the projection, never client-side. */
  "table:set-party-visibility": (
    payload: CommandPayload<typeof TableSetPartyVisibilitySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-token-image": (
    payload: CommandPayload<typeof SetTokenImageSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-size": (
    payload: CommandPayload<typeof SetActorSizeSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-visibility": (
    payload: CommandPayload<typeof SetActorVisibilitySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-archived": (
    payload: CommandPayload<typeof SetActorArchivedSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM shares (or un-shares) an archived character's sheet with players as a read-only keepsake. Default hidden. */
  "actor:set-sheet-preview": (
    payload: CommandPayload<typeof SetActorSheetPreviewSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-speed": (
    payload: CommandPayload<typeof ActorSetSpeedSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-armor-class": (
    payload: CommandPayload<typeof ActorSetArmorClassSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** `damageType` types a bare manual `amount` (ignored when `parts` is present); `damageOverride` replaces a
   * rolled total while keeping its types. */
  "actor:apply-damage": (
    payload: CommandPayload<typeof ApplyDamageSchema>,
    acknowledgement: (result: DamageApplyResult) => void
  ) => void;
  "actor:heal": (
    payload: CommandPayload<typeof HpAmountSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-temp-hp": (
    payload: CommandPayload<typeof TempHpSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-hp": (
    payload: CommandPayload<typeof SetHpSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-condition": (
    payload: CommandPayload<typeof SetConditionSchema>,
    acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void
  ) => void;
  "content:conditions": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentConditionsResult) => void
  ) => void;
  "content:glossary": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentGlossaryResult) => void
  ) => void;
  "content:skills": (payload: Record<string, never>, acknowledgement: (result: ContentSkillsResult) => void) => void;
  "content:languages": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentLanguagesResult) => void
  ) => void;
  "content:spells": (payload: Record<string, never>, acknowledgement: (result: ContentSpellsResult) => void) => void;
  "content:equipment": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentEquipmentResult) => void
  ) => void;
  "content:classes": (payload: Record<string, never>, acknowledgement: (result: ContentClassesResult) => void) => void;
  "content:subclasses": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentSubclassesResult) => void
  ) => void;
  "content:species": (payload: Record<string, never>, acknowledgement: (result: ContentSpeciesResult) => void) => void;
  "content:backgrounds": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentBackgroundsResult) => void
  ) => void;
  "content:feats": (payload: Record<string, never>, acknowledgement: (result: ContentFeatsResult) => void) => void;
  "content:names": (payload: Record<string, never>, acknowledgement: (result: ContentNamesResult) => void) => void;
  "content:monster-actions": (
    payload: { definitionId: string },
    acknowledgement: (result: ContentActionsResult) => void
  ) => void;
  "content:monster-sheet": (
    payload: { definitionId: string },
    acknowledgement: (result: ContentSheetResult) => void
  ) => void;
  "action:resolve": (
    payload: CommandPayload<typeof ActionResolveSchema>,
    acknowledgement: (result: ActionResolveResult) => void
  ) => void;
  "effect:add": (
    payload: CommandPayload<typeof EffectAddSchema>,
    acknowledgement: (result: MutationResult & { effectId?: string }) => void
  ) => void;
  "effect:end": (
    payload: CommandPayload<typeof EffectEndSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "death-save:roll": (
    payload: CommandPayload<typeof DeathSaveRollSchema>,
    acknowledgement: (result: DeathSaveResult) => void
  ) => void;
  /** Stabilize a creature at 0 HP (first aid, a Healer's Kit, Spare the Dying, or the GM's ruling). */
  "actor:stabilize": (
    payload: CommandPayload<typeof ActorStabilizeSchema>,
    acknowledgement: (result: StabilizeResult) => void
  ) => void;
  "encounter:set-rules-mode": (
    payload: CommandPayload<typeof SetRulesModeSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-player-damage-mode": (
    payload: CommandPayload<typeof SetPlayerDamageModeSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-player-initiative-mode": (
    payload: CommandPayload<typeof SetPlayerInitiativeModeSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-health-display": (
    payload: CommandPayload<typeof SetHealthDisplaySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-health-display": (
    payload: CommandPayload<typeof SetActorHealthDisplaySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-environment": (
    payload: CommandPayload<typeof SetEnvironmentSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:rest": (
    payload: CommandPayload<typeof ActorRestSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM-only: bring a dead creature back with the hit points the revival gives. */
  "actor:revive": (
    payload: CommandPayload<typeof ActorReviveSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** Re-make a pick a feature says may be re-made on a rest (Circle of the Land's land type, Fiendish Resilience's damage type). `offer` is the offer key the build already uses. */
  "actor:rechoose": (
    payload: CommandPayload<typeof ActorRechooseSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:spend-hit-dice": (
    payload: CommandPayload<typeof ActorSpendHitDiceSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** Spend several uses of a limited-use pool at once (the character's player or the GM). */
  "actor:spend-uses": (
    payload: CommandPayload<typeof ActorSpendUsesSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM-only: give back spent uses of a limited-use pool. */
  "actor:restore-uses": (
    payload: CommandPayload<typeof ActorRestoreUsesSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** A player asks the GM for a Long Rest for their character, or takes the ask back. */
  "rest:ask": (
    payload: CommandPayload<typeof RestAskSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM-only: approve a Long Rest request (the rest happens now) or turn it down. */
  "rest:answer": (
    payload: CommandPayload<typeof RestAnswerSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM-only: rest several characters at once; a Short Rest stays open until the GM finishes it. */
  "rest:party": (
    payload: CommandPayload<typeof RestPartySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** A member of the party's Short Rest is done spending Hit Dice. */
  "rest:mark-done": (
    payload: CommandPayload<typeof RestMarkDoneSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM-only: end the party's Short Rest, with its benefits or without. */
  "rest:finish": (
    payload: CommandPayload<typeof RestFinishSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM-only: move game time forward. */
  "time:pass": (
    payload: CommandPayload<typeof TimePassSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-slot": (
    payload: CommandPayload<typeof CharacterSetSlotSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-prepared": (
    payload: CommandPayload<typeof CharacterSetPreparedSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:finish-preparing": (
    payload: CommandPayload<typeof CharacterFinishPreparingSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  // Optional item keys are declared so the type states the whole wire contract; the server validates `baseId`.
  "character:set-inventory": (
    payload: CommandPayload<typeof CharacterSetInventorySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:give-item": (
    payload: CommandPayload<typeof CharacterGiveItemSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-currency": (
    payload: CommandPayload<typeof CharacterSetCurrencySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  // `classes[].hitDie` lets an identity edit rebuild the multiclass hit-dice pool (Fighter 3 / Wizard 2 is 3d10 + 2d6).
  "character:set-identity": (
    payload: CommandPayload<typeof CharacterSetIdentitySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-proficiencies": (
    payload: CommandPayload<typeof CharacterSetProficienciesSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** `damageOverride` is the pre-halving damage the answerer means to apply, kept in the proposal's damage types. A player may amend only their own claimed character's save. */
  "save:answer": (
    payload: CommandPayload<typeof SaveAnswerSchema>,
    acknowledgement: (result: SaveAnswerResult) => void
  ) => void;
  "save:dismiss": (
    payload: CommandPayload<typeof SaveDismissSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "reaction:answer": (
    payload: CommandPayload<typeof ReactionAnswerSchema>,
    acknowledgement: (result: ReactionAnswerResult) => void
  ) => void;
  "reaction:dismiss": (
    payload: CommandPayload<typeof ReactionDismissSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "damage:resolve": (
    payload: CommandPayload<typeof DamageResolveSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:available-actions": (
    payload: { actorId: string },
    acknowledgement: (result: ActorActionsAvailabilityResult) => void
  ) => void;
  "actor:movement": (payload: { actorId: string }, acknowledgement: (result: ActorMovementResult) => void) => void;
  "turn:use": (
    payload: CommandPayload<typeof TurnUseSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "turn:use-reaction": (
    payload: CommandPayload<typeof TurnReactionSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "turn:use-legendary": (
    payload: CommandPayload<typeof TurnLegendarySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "turn:end": (
    payload: CommandPayload<typeof CommandIdentitySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "dice:roll": (
    payload: CommandPayload<typeof DiceRollSchema>,
    acknowledgement: (result: DiceRollResult) => void
  ) => void;
  "encounter:start": (
    payload: CommandPayload<typeof EncounterStartSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:end": (
    payload: CommandPayload<typeof CommandIdentitySchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:add-combatant": (
    payload: CommandPayload<typeof AddCombatantSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:set": (
    payload: CommandPayload<typeof InitiativeScoreSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:swap": (
    payload: CommandPayload<typeof InitiativeSwapSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:roll-self": (
    payload: CommandPayload<typeof InitiativeRollSelfSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:roll-remaining": (
    payload: CommandPayload<typeof InitiativeRollRemainingSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:next": (
    payload: CommandPayload<typeof InitiativeNextSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:previous": (
    payload: CommandPayload<typeof InitiativePreviousSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "log:read": (
    payload: Record<string, never>,
    acknowledgement: (result: { ok: boolean; message?: string; entries?: readonly CombatLogEntry[] }) => void
  ) => void;
  "token:move": (
    payload: CommandPayload<typeof TokenMoveSchema>,
    acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void
  ) => void;
  "scene:create": (
    payload: CommandPayload<typeof SceneCreateSchema>,
    acknowledgement: (result: SceneCreateResult) => void
  ) => void;
  "scene:rename": (
    payload: CommandPayload<typeof SceneRenameSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "scene:remove": (
    payload: CommandPayload<typeof SceneIdSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "scene:activate": (
    payload: CommandPayload<typeof SceneIdSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** Launch one recorded moment of an archived fight; combatants are cloned so live characters are never rewritten. GM only. */
  "replay:launch": (
    payload: CommandPayload<typeof ReplayLaunchSchema>,
    acknowledgement: (result: MutationResult & { sceneId?: string; actorIds?: readonly string[] }) => void
  ) => void;
  "scene:set-combatants": (
    payload: CommandPayload<typeof SceneSetCombatantsSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "scene:duplicate": (
    payload: CommandPayload<typeof SceneIdSchema>,
    acknowledgement: (result: SceneCreateResult) => void
  ) => void;
  "scene:reorder": (
    payload: CommandPayload<typeof SceneReorderSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "fog:set-enabled": (
    payload: CommandPayload<typeof FogSetEnabledSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "fog:paint": (
    payload: CommandPayload<typeof FogPaintSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "fog:reset": (
    payload: CommandPayload<typeof FogResetSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "terrain:paint": (
    payload: CommandPayload<typeof TerrainPaintSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "terrain:reset": (
    payload: CommandPayload<typeof TerrainResetSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:add": (
    payload: CommandPayload<typeof AnnotationAddSchema>,
    acknowledgement: (result: AnnotationAddResult) => void
  ) => void;
  "annotation:ping": (
    payload: CommandPayload<typeof AnnotationPingSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:set-color": (
    payload: CommandPayload<typeof AnnotationColorSetSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:move": (
    payload: CommandPayload<typeof AnnotationMoveSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:remove": (
    payload: CommandPayload<typeof AnnotationRemoveSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:set-visibility": (
    payload: CommandPayload<typeof AnnotationVisibilitySetSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:set-movable": (
    payload: CommandPayload<typeof AnnotationMovableSetSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:clear": (
    payload: CommandPayload<typeof AnnotationClearSchema>,
    acknowledgement: (result: MutationResult) => void
  ) => void;
}
