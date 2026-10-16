export * from "./catalog-choice.js";
export * from "./pick-budget.js";
/** The character builder's parked build, shared so the wizard and the server's draft store read one shape. */
export * from "./character-draft.js";
/** The AC an attack meets, shared so the server's roll and the sheets agree. */
export * from "./armor-class.js";

/** Codex field vocabulary, shared so the GM UI and the server's prune-and-seal read one copy. */
export * from "./codex-entities.js";
/** In-world calendar arithmetic, shared so stored labels and the client's display agree. */
export * from "./codex-calendar.js";
/** The Codex's HTTP shapes, shared so the server's projections and the client's reads are one type. */
export * from "./codex-wire.js";

export {
  ACTOR_SCHEMA_VERSION,
  ActorSchema,
  DeathSavesSchema,
  EffectInstanceSchema,
  HealthDisplaySchema,
  ModifierSchema,
  type Actor,
  type ActorDefinition,
  type DeathSaves,
  type EffectInstance,
  type HealthDisplay,
  type HealthDisplayAudience,
  type HealthDisplayStyle,
  type Modifier
} from "@vtt/schemas";
/** Re-exported because the client cannot import `@vtt/schemas`; a hand-copied list would drift. */
export {
  ItemMagicMarkerSchema,
  ItemSlotSchema,
  RIDER_TRIGGER_KINDS,
  RiderTriggerSchema,
  RiderWhenSchema,
  riderLayer,
  type ItemSlot,
  type RiderTrigger,
  type RiderTriggerKind
} from "@vtt/schemas";
/** Character-sheet helpers, re-exported for the client. `resolveSpellcasting` is the single
 * implementation of the multiclass spellcasting order; never inline a `classes[0]` fallback beside it. */
export {
  characterChoices,
  resolveSpellcasting,
  makeHitDicePool,
  HitDiceEntrySchema,
  HitDicePoolSchema,
  HitDieSchema,
  // `AbilityId` is not re-exported: domain declares its own identical alias below.
  type CharacterChoice,
  type ClassSpellcasting,
  type HitDie,
  type HitDiceEntry,
  type HitDicePool,
  type Spellcasting
} from "@vtt/schemas";

/** The stored game state: what the server persists and validates on boot. */
export * from "./state.js";
/** What each role receives: the player and GM projections of the state. */
export * from "./views.js";
/** What a command or read answers with. */
export * from "./results.js";
/** The content catalogs' wire rows. */
export * from "./content.js";
/** The Socket.IO contract both ends are typed against. */
export * from "./socket.js";
