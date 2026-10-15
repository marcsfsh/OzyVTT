import { z } from "zod";
import {
  ActorDefinitionSchema,
  ActorSchema,
  HealthDisplaySchema,
  type Actor,
  type ActorDefinition,
  type EffectInstance,
  type EffectModifier,
  type HitDie
} from "@vtt/schemas";

export * from "./catalog-choice.js";
export * from "./pick-budget.js";
import type { PickBudgetScaling } from "./pick-budget.js";

/** Codex field vocabulary, shared so the GM UI and the server's prune-and-seal read one copy. */
export * from "./codex-entities.js";
/** In-world calendar arithmetic, shared so stored labels and the client's display agree. */
export * from "./codex-calendar.js";

export {
  ACTOR_SCHEMA_VERSION,
  ActorSchema,
  DeathSavesSchema,
  EffectInstanceSchema,
  EffectModifierSchema,
  HealthDisplaySchema,
  type Actor,
  type ActorDefinition,
  type DeathSaves,
  type EffectInstance,
  type EffectModifier,
  type HealthDisplay,
  type HealthDisplayAudience,
  type HealthDisplayStyle
} from "@vtt/schemas";
/** Re-exported because the client cannot import `@vtt/schemas`; a hand-copied list would drift. */
export {
  ItemMagicMarkerSchema,
  ItemSlotSchema,
  RIDER_TRIGGER_KINDS,
  RiderTriggerSchema,
  RiderWhenSchema,
  riderLayer,
  toRollModes,
  type ItemSlot,
  type NormalisedRollMode,
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

/** An imported stat block persisted with the campaign: the inert definition plus the id actors reference via `definitionId`. */
export const StoredDefinitionSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(200),
    definition: ActorDefinitionSchema
  })
  .strict();
export type StoredDefinition = z.infer<typeof StoredDefinitionSchema>;
/** A player-submitted PDF import awaiting GM approval. GM-only — never in PlayerView or the viewer (ADR-0018). */
export const PendingImportSchema = z
  .object({
    id: z.string().max(120),
    name: z.string().min(1).max(120),
    submittedBy: z.string().max(120),
    definition: ActorDefinitionSchema
  })
  .strict();
export type PendingImport = z.infer<typeof PendingImportSchema>;

export const RollVisibilitySchema = z.enum(["public", "gm-only", "blind", "self-only"]);
export const RollPurposeSchema = z.enum(["attack", "save", "check", "damage", "manual"]);
export const RollRecordSchema = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  initiatorSessionId: z.string().uuid(),
  initiatorRole: z.enum(["gm", "player"]),
  /** Who rolled: "GM" or the player's character name at roll time. Optional for older persisted rolls. */
  initiatorLabel: z.string().min(1).max(120).optional(),
  /** What was rolled ("Athletics check", "DEX save", a weapon or spell name); the UI falls back to the purpose. */
  label: z.string().min(1).max(80).optional(),
  actorId: z.string().uuid().nullable(),
  purpose: RollPurposeSchema,
  visibility: RollVisibilitySchema,
  formula: z.string(),
  normalizedFormula: z.string(),
  dice: z.array(
    z.object({
      group: z.number().int().nonnegative(),
      sides: z.number().int().positive(),
      face: z.number().int().positive(),
      kept: z.boolean(),
      sign: z.union([z.literal(1), z.literal(-1)])
    })
  ),
  modifiers: z.array(z.object({ value: z.number().int().nonnegative(), sign: z.union([z.literal(1), z.literal(-1)]) })),
  total: z.number().int(),
  createdAt: z.string().datetime()
});
export type RollVisibility = z.infer<typeof RollVisibilitySchema>;
export type RollPurpose = z.infer<typeof RollPurposeSchema>;
export type RollRecord = z.infer<typeof RollRecordSchema>;
export type PlayerRollRecord = Omit<RollRecord, "initiatorSessionId">;

export const InitiativeEntrySchema = z.object({
  actorId: z.string().uuid(),
  score: z.number().int().min(-1000).max(1000),
  tieBreaker: z.number().int().min(-1000).max(1000).default(0)
});
export type InitiativeEntry = z.infer<typeof InitiativeEntrySchema>;

export const EncounterTokenPositionSchema = z
  .object({
    x: z.number().finite().nonnegative().max(1_000_000),
    y: z.number().finite().nonnegative().max(1_000_000)
  })
  .strict();
export const EncounterTokenSchema = z
  .object({
    actorId: z.string().uuid(),
    position: EncounterTokenPositionSchema.nullable().default(null),
    sizePx: z.number().finite().positive().max(4096),
    gridSizePx: z.number().finite().positive().max(4096).nullable().default(null),
    gridRotationRadians: z.number().finite().min(-Math.PI).max(Math.PI).nullable().default(null),
    /** Footprint in cells per side; even sizes snap to grid intersections instead of cell centers. */
    sizeCells: z.number().int().min(1).max(4).default(1)
  })
  .strict();
export type EncounterTokenPosition = z.infer<typeof EncounterTokenPositionSchema>;
export type EncounterToken = z.infer<typeof EncounterTokenSchema>;

export const AnnotationVisibilitySchema = z.enum(["public", "gm-only", "owner-only", "owner-gm", "gm-actor"]);
export type AnnotationVisibility = z.infer<typeof AnnotationVisibilitySchema>;

export const AnnotationShapeKindSchema = z.enum(["circle", "cone", "line", "square"]);
export type AnnotationShapeKind = z.infer<typeof AnnotationShapeKindSchema>;

export const AnnotationPointSchema = z
  .object({
    x: z.number().finite().nonnegative().max(1_000_000),
    y: z.number().finite().nonnegative().max(1_000_000)
  })
  .strict();
export type AnnotationPoint = z.infer<typeof AnnotationPointSchema>;

/** `origin` anchors the shape (circle center, cone apex, line start, square corner); `target` is the resize
 * handle. The server re-snaps both and derives `sizeFeet` on every add/move so geometry stays on-grid. */
export const AnnotationGeometrySchema = z
  .object({
    origin: AnnotationPointSchema,
    target: AnnotationPointSchema,
    // Nonnegative: a ping is stored with sizeFeet 0 and must re-parse when the GameState loads.
    sizeFeet: z.number().finite().nonnegative().max(2000)
  })
  .strict();
export type AnnotationGeometry = z.infer<typeof AnnotationGeometrySchema>;

export const AnnotationColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #RRGGBB hex value.");
export const AnnotationSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["measurement", "shape", "ping"]),
    shape: AnnotationShapeKindSchema.nullable().default(null),
    geometry: AnnotationGeometrySchema,
    ownerSessionId: z.string().uuid(),
    createdByRole: z.enum(["gm", "player"]),
    visibility: AnnotationVisibilitySchema.default("public"),
    /** For `gm-actor` visibility: the actor whose owning player sees this alongside the GM. Null otherwise. */
    visibleToActorId: z.string().uuid().nullable().default(null),
    /** When true, any player (not just the owner) may move/resize this shape. The GM and owner always can. */
    movableByOthers: z.boolean().default(false),
    color: AnnotationColorSchema.default("#58c3ff"),
    /** Display label: the pinger's name for `ping` annotations; null otherwise. */
    label: z.string().max(60).nullable().default(null),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative().nullable().default(null)
  })
  .strict()
  .superRefine((annotation, context) => {
    if (annotation.kind === "shape" && annotation.shape === null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shape"],
        message: "A shape annotation must specify a shape kind."
      });
    if (annotation.kind !== "shape" && annotation.shape !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shape"],
        message: "Only shape annotations specify a shape kind."
      });
    if (annotation.visibility === "gm-actor" && annotation.visibleToActorId === null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleToActorId"],
        message: "gm-actor visibility requires a target actor."
      });
    if (annotation.visibility !== "gm-actor" && annotation.visibleToActorId !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleToActorId"],
        message: "Only gm-actor visibility carries a target actor."
      });
  });
export type Annotation = z.infer<typeof AnnotationSchema>;

export const AbilityIdSchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityId = z.infer<typeof AbilityIdSchema>;
/** A saving throw a target still owes (GM answers for anyone, a player for their own character). The
 * answer auto-applies: fail = full damage + condition, success = half or none (ADR-0008 carve-out). */
export const PendingSaveSchema = z
  .object({
    id: z.string().uuid(),
    targetActorId: z.string().uuid(),
    ability: AbilityIdSchema,
    dc: z.number().int().min(1).max(40),
    /** Source actor for GM bookkeeping; stripped from player projections. */
    sourceActorId: z.string().uuid().nullable().default(null),
    sourceName: z.string().min(1).max(120),
    actionName: z.string().min(1).max(120),
    proposedDamage: z.number().int().nonnegative().max(10000).default(0),
    /** Typed components of the proposed damage (optional for older saves); when present, application runs the typed-defense pipeline. */
    proposedDamageParts: z
      .array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict())
      .max(9)
      .optional(),
    halfOnSuccess: z.boolean().default(true),
    conditionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .nullable()
      .default(null),
    /** Flat bonus to the save roll (GM-adjudicated cover: +2/+5 on Dex saves, SRD Cover). */
    saveBonus: z.number().int().min(0).max(10).default(0),
    /** Concentration check (SRD): effects ended when this save fails. Stripped from player projections. */
    endsEffects: z
      .array(z.object({ actorId: z.string().uuid(), effectId: z.string().min(1).max(120) }).strict())
      .max(8)
      .optional(),
    /** Effect applied on a failed save, e.g. Grappled with its escape DC from an Unarmed Strike grapple. */
    onFailEffect: z
      .object({
        name: z.string().min(1).max(120),
        tags: z
          .array(
            z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(40)
          )
          .max(8)
          .default([]),
        linkedConditionIds: z
          .array(
            z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(60)
          )
          .max(4)
          .default([]),
        escapeDc: z.number().int().min(1).max(40).nullable().default(null),
        sourceActorId: z.string().uuid().nullable().default(null),
        sourceName: z.string().max(120).nullable().default(null)
      })
      .strict()
      .optional(),
    createdAt: z.number().int().nonnegative()
  })
  .strict();
export type PendingSave = z.infer<typeof PendingSaveSchema>;

/** A declared reaction (ADR-0020), e.g. Uncanny Dodge, awaiting an answer; the triggering damage waits here
 * ("use" = halved, "decline" = full, or GM dismiss) and persists until answered so it is never lost. */
export const PendingReactionSchema = z
  .object({
    id: z.string().uuid(),
    /** What opened the window: an attack that hit the reactor, or an enemy leaving its reach (opportunity attack). */
    kind: z.enum(["hit-by-attack", "leaves-reach"]).default("hit-by-attack"),
    actorId: z.string().uuid(),
    actionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    actionName: z.string().min(1).max(120),
    /** leaves-reach: the mover the reaction would strike. */
    targetActorId: z.string().uuid().nullable().default(null),
    /** Source actor for GM bookkeeping; stripped from player projections. */
    sourceActorId: z.string().uuid().nullable().default(null),
    sourceName: z.string().min(1).max(120),
    triggerCommandId: z.string().uuid(),
    proposedDamage: z.number().int().nonnegative().max(10000).default(0),
    proposedDamageParts: z
      .array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict())
      .max(18)
      .default([]),
    /** The triggering attack was a critical hit (drives death-save failure ticks when the damage lands). */
    critical: z.boolean().default(false),
    createdAt: z.number().int().nonnegative()
  })
  .strict();
export type PendingReaction = z.infer<typeof PendingReactionSchema>;

/** A player's hit awaiting the GM's Apply (proposal mode, the default), so players never change HP on a creature
 * they don't own. GM-only: never projected to players or the viewer. */
export const PendingDamageSchema = z
  .object({
    id: z.string().uuid(),
    sourceActorId: z.string().uuid(),
    sourceName: z.string().min(1).max(120),
    actionName: z.string().min(1).max(120),
    targetActorId: z.string().uuid(),
    targetName: z.string().min(1).max(120),
    proposedDamageParts: z
      .array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict())
      .max(18)
      .default([]),
    proposedTotal: z.number().int().nonnegative().max(10000).default(0),
    /** The hit was a critical (drives death-save failure ticks when the damage lands). */
    critical: z.boolean().default(false),
    createdAt: z.number().int().nonnegative()
  })
  .strict();
export type PendingDamage = z.infer<typeof PendingDamageSchema>;

/** Invariants shared by the live combat and each parked scene's copy; paths are relative so Zod nests them. */
function refineCombatContext(
  combat: {
    active: boolean;
    turnActorId: string | null;
    initiative: ReadonlyArray<{ actorId: string }>;
    tokens: ReadonlyArray<{ actorId: string }>;
  },
  context: z.RefinementCtx
) {
  const actorIds = new Set<string>();
  for (const [index, entry] of combat.initiative.entries()) {
    if (actorIds.has(entry.actorId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initiative", index, "actorId"],
        message: "Initiative actor IDs must be unique."
      });
    actorIds.add(entry.actorId);
  }
  if (combat.active && combat.initiative.length === 0)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["initiative"],
      message: "An active encounter requires at least one combatant."
    });
  if (combat.active && combat.turnActorId === null)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["turnActorId"],
      message: "An active encounter requires a current turn."
    });
  if (combat.turnActorId !== null && !actorIds.has(combat.turnActorId))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["turnActorId"],
      message: "The current turn actor must be in Initiative."
    });
  const tokenActorIds = new Set<string>();
  for (const [index, token] of combat.tokens.entries()) {
    if (tokenActorIds.has(token.actorId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", index, "actorId"],
        message: "Encounter token actor IDs must be unique."
      });
    tokenActorIds.add(token.actorId);
    if (!actorIds.has(token.actorId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", index, "actorId"],
        message: "Encounter tokens must belong to actors in Initiative."
      });
  }
}

/** How strictly the engine polices one rule (ADR-0020); the UI labels these Enforce / Advise / Off. */
export const RuleModeSchema = z.enum(["strict", "assisted", "freeform"]);
export type RuleMode = z.infer<typeof RuleModeSchema>;

/** A GM relaxes rules a family at a time, never per rule id. The rule-id → family mapping lives in
 * `apps/server/src/rules-families.ts`. */
export const RuleFamilySchema = z.enum(["movement", "economy", "resources", "targeting", "slots"]);
export type RuleFamily = z.infer<typeof RuleFamilySchema>;

/** Per-family overrides of the standing dial; an absent key follows the dial. Not `.strict()`, so an unknown
 * family from a newer build strips on load (ADR-0007); command schemas add `.strict()` to reject typos. */
export const RuleExceptionsSchema = z.object({
  movement: RuleModeSchema.optional(),
  economy: RuleModeSchema.optional(),
  resources: RuleModeSchema.optional(),
  targeting: RuleModeSchema.optional(),
  slots: RuleModeSchema.optional()
});
export type RuleExceptions = z.infer<typeof RuleExceptionsSchema>;

/** `slots` defaults to "assisted" regardless of the dial; the GM opts into strict slot tracking. */
export const DEFAULT_RULE_EXCEPTIONS: RuleExceptions = { slots: "assisted" };

/** Closed list: `rules.answer` replays the parked payload under GM authority. */
export const AskableCommandSchema = z.enum(["action.resolve", "action.use", "token.move", "actor.set-condition"]);
export type AskableCommand = z.infer<typeof AskableCommandSchema>;

/** A player's parked "Ask the GM": a blocked command waiting for the GM to allow or deny it. The owner is not
 * stored; it is the actor's live `ownerSessionId`, as for pending saves and reactions. `command.payload` is
 * revalidated against its own schema before the replay and never reaches a player (it can name hidden ids). */
export const PendingRuleAskSchema = z
  .object({
    id: z.string().uuid(),
    /** The character the blocked command was for; also decides which player may see this ask. */
    actorId: z.string().uuid(),
    /** The machine-readable rule that blocked it (e.g. `economy.action-used`). */
    rule: z.string().min(1).max(120),
    family: RuleFamilySchema.nullable().default(null),
    /** The player-facing sentence the block produced ("That needs your action - already used this turn"). */
    message: z.string().min(1).max(300),
    /** The parked command, replayed verbatim on Allow. GM-only - never projected to any player. */
    command: z.object({ type: AskableCommandSchema, payload: z.unknown() }).strict(),
    createdAt: z.string().datetime()
  })
  .strict();
export type PendingRuleAsk = z.infer<typeof PendingRuleAskSchema>;

/** Combat fields shared by the live combat and each parked scene: everything except the map and scene bookkeeping. */
const sceneCombatShape = {
  active: z.boolean().default(false),
  round: z.number().int().positive().default(1),
  turnActorId: z.string().uuid().nullable().default(null),
  initiative: z.array(InitiativeEntrySchema).max(200).default([]),
  tokens: z.array(EncounterTokenSchema).max(200).default([]),
  annotations: z.array(AnnotationSchema).max(300).default([]),
  /** Action economy of the current turn's actor, reset on turn change. `actionInstance` holds remaining components
   * of an open compound action (Extra Attack); `turnUses` is keyed `${actorId}:${actionId}`. */
  turn: z
    .object({
      actionUsed: z.boolean().default(false),
      bonusActionUsed: z.boolean().default(false),
      actionInstance: z
        .object({ actorId: z.string().uuid(), components: z.record(z.string(), z.number().int().nonnegative()) })
        .strict()
        .nullable()
        .default(null),
      turnUses: z.record(z.string(), z.number().int().nonnegative()).default({}),
      /** Feet of movement the current turn's actor has spent (fractional on gridless maps). */
      movementUsedFeet: z.number().nonnegative().max(100000).default(0),
      /** Legacy economy/range-only override flag, kept so older mid-turn state parses; readers prefer
       * `rulesOverriddenFamilies`. Stripped from player projections. */
      rulesOverridden: z.boolean().optional(),
      /** Rule families the GM already waved through this turn. Stripped from player projections. */
      rulesOverriddenFamilies: z.array(RuleFamilySchema).max(5).optional()
    })
    .default({ actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 }),
  /** How structured action resolution enforces rules (ADR-0020): strict rejects with an override path, assisted warns, freeform stays reference-level. */
  rulesMode: RuleModeSchema.default("strict"),
  /** Per-family overrides of `rulesMode` (see RuleExceptionsSchema). Player-readable; holds no secrets. */
  ruleExceptions: RuleExceptionsSchema.default(DEFAULT_RULE_EXCEPTIONS),
  /** How a player's confirmed hit reaches an enemy's HP: "proposal" parks it for the GM's Apply; "direct" applies
   * it server-side at once. */
  playerDamageMode: z.enum(["proposal", "direct"]).default("proposal"),
  /** With `playersRollInitiative`: "immediate" starts turns on a provisional order that re-sorts as players
   * roll; "wait" holds turn advancement until every claimed player has rolled (or the GM rolls the rest). */
  playerInitiativeMode: z.enum(["immediate", "wait"]).default("immediate"),
  /** Table-wide token health display (a per-token `actor.healthDisplay` overrides it). `band` is the coarse badge
   * everyone sees; `bar`/`ring` are gated by `audience`. */
  healthDisplay: HealthDisplaySchema.default({ style: "band", audience: "gm" }),
  /** SRD Underwater Combat: melee disadvantage unless piercing, ranged auto-miss beyond normal range, everyone resists fire. */
  underwater: z.boolean().default(false),
  /** Combatants whose reaction is spent; an actor's id is removed when their own turn starts (5e refresh timing). */
  reactionsUsed: z.array(z.string().uuid()).max(200).default([]),
  /** Legendary actions spent since each creature's last turn start (SRD refresh). Stripped from the player projection. */
  legendaryUsed: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Manual fog of war (ADR-0022): an ordered list of reveal/hide rects applied over "all hidden"; enabled with
   * no shapes means a fully hidden map. Rects are in image-pixel space. Fog is presentation, not the security
   * boundary: hidden actors and annotations are stripped by their own projections, so players get this verbatim. */
  fog: z
    .object({
      enabled: z.boolean().default(false),
      shapes: z
        .array(
          z
            .object({
              kind: z.literal("rect"),
              id: z.string().uuid(),
              op: z.enum(["reveal", "hide"]),
              x: z.number().min(0).max(100000),
              y: z.number().min(0).max(100000),
              width: z.number().positive().max(100000),
              height: z.number().positive().max(100000)
            })
            .strict()
        )
        .max(200)
        .default([])
    })
    .strict()
    .default({ enabled: false, shapes: [] }),
  pendingSaves: z.array(PendingSaveSchema).max(100).default([]),
  pendingReactions: z.array(PendingReactionSchema).max(20).default([]),
  /** GM-only (see PendingDamageSchema). */
  pendingDamage: z.array(PendingDamageSchema).max(50).default([]),
  /** A player sees only their own (see PendingRuleAskSchema). */
  pendingRuleAsks: z.array(PendingRuleAskSchema).max(10).default([]),
  /** Claimed-PC actorIds whose owner still owes an initiative roll. */
  pendingInitiative: z.array(z.string().uuid()).max(200).default([])
};

/** A parked scene's frozen combat - same fields and invariants as the live combat, minus the map (the Scene owns that). */
export const SceneCombatSchema = z.object(sceneCombatShape).superRefine(refineCombatContext);
export type SceneCombat = z.infer<typeof SceneCombatSchema>;

/** A prepared encounter the GM can switch to: its map plus a frozen combat context that resumes exactly when activated. */
export const SceneSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    mapAssetId: z.string().uuid(),
    combat: SceneCombatSchema.default({}),
    /** Set when this scene is a launched replay. Such scenes are disposable: `scenes.ts` drops the scene and its
     * cloned combatants (`Actor.replaySceneId`) when the table leaves it. GM-only. */
    replayOf: z
      .object({
        archiveId: z.number().int().nonnegative(),
        actorIds: z.array(z.string().uuid()).max(200)
      })
      .strict()
      .optional()
  })
  .strict();
export type Scene = z.infer<typeof SceneSchema>;

/** The campaign roster every management surface lists, shared so server and client agree. Excludes a launched
 * replay's clones (`Actor.replaySceneId`), which fight on the map but are never claimable. */
export function rosterActors<T extends { readonly replaySceneId?: string | undefined }>(
  actors: readonly T[]
): readonly T[] {
  return actors.filter((actor) => actor.replaySceneId === undefined);
}

export const CombatStateSchema = z
  .object({
    ...sceneCombatShape,
    mapAssetId: z.string().uuid().nullable().default(null),
    /** Prepared scenes the GM parks and resumes. The active scene's own `combat` stays empty; its live copy is the top-level fields. */
    scenes: z.array(SceneSchema).max(20).default([]),
    activeSceneId: z.string().uuid().nullable().default(null),
    /** Turn time-travel (live fight only): `historyCursor` is the snapshot index being viewed (null = live);
     * `historyDirty` means state changed while rewound, so moving on needs GM confirmation. */
    historyCursor: z.number().int().nonnegative().nullable().default(null),
    historyDirty: z.boolean().default(false)
  })
  .superRefine((combat, context) => {
    refineCombatContext(combat, context);
    const sceneIds = new Set<string>();
    for (const [index, scene] of combat.scenes.entries()) {
      if (sceneIds.has(scene.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes", index, "id"],
          message: "Scene IDs must be unique."
        });
      sceneIds.add(scene.id);
    }
    if (combat.activeSceneId !== null && !sceneIds.has(combat.activeSceneId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeSceneId"],
        message: "The active scene must be one of the prepared scenes."
      });
    const active =
      combat.activeSceneId === null ? undefined : combat.scenes.find((scene) => scene.id === combat.activeSceneId);
    if (
      active &&
      (active.combat.active ||
        active.combat.initiative.length > 0 ||
        active.combat.tokens.length > 0 ||
        active.combat.annotations.length > 0 ||
        active.combat.reactionsUsed.length > 0 ||
        Object.keys(active.combat.legendaryUsed).length > 0 ||
        active.combat.fog.enabled ||
        active.combat.fog.shapes.length > 0 ||
        active.combat.pendingSaves.length > 0 ||
        active.combat.pendingReactions.length > 0 ||
        active.combat.pendingDamage.length > 0 ||
        active.combat.pendingRuleAsks.length > 0 ||
        active.combat.pendingInitiative.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message: "The active scene's stored combat must be empty - its live copy is the top-level combat."
      });
    }
  });
export type CombatState = z.infer<typeof CombatStateSchema>;

export const BuilderAbilityMethodSchema = z.enum(["standard-array", "point-buy", "roll", "custom"]);
export type BuilderAbilityMethod = z.infer<typeof BuilderAbilityMethodSchema>;
/** The GM's character-builder policy. Player-readable; campaign policy, so not on `combat`. "custom" needs
 * `customFormula`, which is validated on write with `@vtt/rules-5e`'s `validateAbilityFormula`. */
export const BuilderPolicySchema = z
  .object({
    allowedAbilityMethods: z
      .array(BuilderAbilityMethodSchema)
      .min(1)
      .max(4)
      .default(["standard-array", "point-buy", "roll", "custom"]),
    customFormula: z.string().min(1).max(160).nullable().default(null),
    /** The highest character level this table builds to, enforced server-side by the builder and by the sheet's identity edit. */
    maxLevel: z.number().int().min(1).max(20).default(20),
    /** Whether players may run the character builder themselves; enforced in `character.create`. */
    playerBuilder: z.enum(["open", "gm-only"]).default("open"),
    /** Whether players may roll a random character; "gm-only" by default because it fills a roster slot in one tap. */
    playerRandom: z.enum(["open", "gm-only"]).default("gm-only")
  })
  .strict();
export type BuilderPolicy = z.infer<typeof BuilderPolicySchema>;

/** Standing rules policy each new fight starts from; `combat.rulesMode`/`ruleExceptions` are the live copy. */
export const RulesPolicySchema = z
  .object({
    dial: RuleModeSchema.default("strict"),
    exceptions: RuleExceptionsSchema.default(DEFAULT_RULE_EXCEPTIONS)
  })
  .strict();
export type RulesPolicy = z.infer<typeof RulesPolicySchema>;

/** The token visibility a surface pre-selects when staging; the server never substitutes it. */
export const StagingDefaultsSchema = z
  .object({
    visibility: z.enum(["public", "gm-only"]).default("public")
  })
  .strict();
export type StagingDefaults = z.infer<typeof StagingDefaultsSchema>;

/** How much a player sees of another player's character (UI: Off · Name and class · Full sheet · Sheet + resources).
 * - `off`: no identity card, sheet or resources; the actor stays for the map, tokens and turn order.
 * - `name-and-class`: the identity card only. The default.
 * - `full-sheet`: plus their imported sheet, read-only.
 * - `sheet-and-resources`: plus owner-only resources (slots, prepared spells, inventory, currency, hit dice, uses).
 * Enforced in `projectPlayerView` (apps/server/src/projections.ts), never client-side. A player's own
 * character is never limited by this. */
export const PartyVisibilitySchema = z.enum(["off", "name-and-class", "full-sheet", "sheet-and-resources"]);
export type PartyVisibility = z.infer<typeof PartyVisibilitySchema>;

export const GameStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  actors: z.array(ActorSchema).default([]),
  rolls: z.array(RollRecordSchema).default([]),
  combat: CombatStateSchema.default({
    active: false,
    round: 1,
    turnActorId: null,
    mapAssetId: null,
    initiative: [],
    tokens: [],
    annotations: []
  }),
  /** Imported stat blocks (canonical ActorDefinition JSON) that live with the campaign (ADR-0007). */
  definitions: z.array(StoredDefinitionSchema).max(100).default([]),
  /** Player-submitted PDF imports awaiting GM approval. GM-only: excluded from PlayerView and the viewer (ADR-0018). */
  pendingImports: z.array(PendingImportSchema).max(20).default([]),
  /** Character-builder table policy. GM-set, player-read. */
  builderPolicy: BuilderPolicySchema.default({}),
  /** Standing rules policy every new fight starts from. GM-set, player-read. */
  rulesPolicy: RulesPolicySchema.default({}),
  /** Table defaults for staging new combatants. GM-set, GM-read. */
  stagingDefaults: StagingDefaultsSchema.default({}),
  /** How much a player sees of another player's character (see PartyVisibilitySchema). GM-set; player-read via `PlayerView`. */
  partyVisibility: PartyVisibilitySchema.default("name-and-class")
});
export type GameState = z.infer<typeof GameStateSchema>;
export type ClientRole = "player" | "gm";

/** Server-authoritative connection presence for a claimed character's owning session. Never carries a session ID, token, socket ID, or address across the wire. */
export const PresenceStatusSchema = z.enum(["online", "reconnecting", "offline"]);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

/** Coarse health signal safe for any audience; "bloodied" is the 2024 rules' at-or-below-half state. */
export type HealthBand = "healthy" | "bloodied" | "down";
/** Player characters stay exact for the whole party; monsters/NPCs reach players only as a band so the GM keeps exact numbers. */
export type PlayerHp =
  { kind: "exact"; current: number; maximum: number; temporary: number } | { kind: "band"; band: HealthBand };
/** An effect as players see it: source ids never cross the wire, and a hidden source's name is masked server-side (viewer safety). */
export type PlayerEffect = Omit<EffectInstance, "sourceActorId" | "sourceActionId">;
/** A creature as one player sees it. Their own claimed character gets everything; another player's is limited by
 * `GameState.partyVisibility` (see apps/server/src/projections.ts). */
/** Actor fields every player receives for every visible actor (apps/server/src/projections.ts). */
export type PlayerActorTableField =
  "id" | "name" | "kind" | "visibility" | "size" | "sizeCells" | "tokenAssetId" | "conditions" | "deathSaves";
/** Actor fields players receive only on player characters; a monster's stats are GM knowledge. */
export type PlayerActorPartyField = "armorClass" | "initiative" | "speedFeet" | "definitionId";
export type PlayerActor = Pick<Actor, PlayerActorTableField> &
  Partial<Pick<Actor, PlayerActorPartyField>> & {
    replaySceneId?: string;
    hp: PlayerHp;
    effects: PlayerEffect[];
    claimStatus: "available" | "mine" | "claimed";
    presence: PresenceStatus | null;
    /** "Fighter 5 / Rogue 2", derived server-side; only on another player's claimed character. */ classLine?: string;
    /** The imported sheet. Your own claimed character always; another player's only at `partyVisibility` `full-sheet` or `sheet-and-resources`. */ definition?: ActorDefinition;
    /** Spent limited-use counts. Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ actionUses?: Record<
      string,
      number
    >;
    /** Picks re-made on a rest, keyed by offer key (Circle of the Land's land type). Same gate as `actionUses`. */ choiceOverrides?: Record<
      string,
      { id: string; per: "short-rest" | "long-rest" }
    >;
    /** Limits for the `actionUses` counts, same keys (`uses.pool ?? action.id`). Derived, never stored; same gate as `actionUses`. */ pools?: Array<{
      id: string;
      name: string;
      limit: number;
      per: string;
    }>;
    /** Hit Point Dice pool (per-die `entries` plus the derived total summary). Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ hitDice?: NonNullable<
      Actor["hitDice"]
    >;
    /** Sheet resources (spell slots, prepared spells, inventory, currency). Your own claimed character always; another player's only at `partyVisibility` `sheet-and-resources`. */ spellSlots?: Actor["spellSlots"];
    pactSlots?: Actor["pactSlots"];
    preparedSpellIds?: Actor["preparedSpellIds"];
    inventory?: Actor["inventory"];
    currency?: Actor["currency"];
    /** The resolved token health indicator, present only when the table shows a bar/ring/aura to everyone (audience "all"); the client derives the fill from `hp` (exact for the owner, coarse band otherwise). */ healthDisplay?: Readonly<{
      style: "bar" | "ring" | "aura";
    }>;
  };
export type PlayerInitiativeEntry = Readonly<{
  actorId: string;
  name: string;
  score: number;
  active: boolean;
  health: HealthBand;
  /** Active condition ids + parallel display labels ("Prone", "Exhaustion 3"): public info, so players and the shared screen render the same dots from one source. */ conditionIds: readonly string[];
  conditions: readonly string[];
}>;
export type PlayerAnnotation = Omit<Annotation, "ownerSessionId"> & { mine: boolean };
/** A player's own pending saves only; source actor ids and concentration effect references never cross the wire, and a hidden source's name is masked server-side. */
export type PlayerPendingSave = Omit<PendingSave, "sourceActorId" | "endsEffects">;
/** A player's own pending reaction prompts only; same masking rules as saves. */
export type PlayerPendingReaction = Omit<PendingReaction, "sourceActorId">;
/** A player's view of their own parked ask. `command` is omitted: its payload can name ids the player may not know. */
export type PlayerPendingRuleAsk = Omit<PendingRuleAsk, "command">;
export type PlayerCombatView = Readonly<{
  active: boolean;
  round: number;
  turnActorId: string | null;
  mapAssetId: string | null;
  hiddenTurn: boolean;
  initiative: readonly PlayerInitiativeEntry[];
  tokens: readonly EncounterToken[];
  annotations: readonly PlayerAnnotation[];
  turn: {
    actionUsed: boolean;
    bonusActionUsed: boolean;
    actionInstance: { actorId: string; components: Record<string, number> } | null;
    turnUses: Record<string, number>;
    movementUsedFeet: number;
  };
  rulesMode: RuleMode;
  /** Per-family overrides of `rulesMode`; no secrets, and the player's sheet needs it to anticipate blocks. */ ruleExceptions: RuleExceptions;
  /** Lets the player runner label a hit "handed to the GM" or "applied"; the proposals themselves stay GM-only. */ playerDamageMode:
    "proposal" | "direct";
  /** Claimed-PC actorIds still owing an initiative roll; a player looks for their own id. */ pendingInitiative: readonly string[];
  /** Whether the table waits for all players' initiative rolls before turns begin (see CombatState.playerInitiativeMode). */ playerInitiativeMode:
    "immediate" | "wait";
  underwater: boolean;
  reactionsUsed: readonly string[];
  /** The fog mask verbatim (geometry only - hidden things are stripped by their own filters). */ fog: CombatState["fog"];
  pendingSaves: readonly PlayerPendingSave[];
  pendingReactions: readonly PlayerPendingReaction[];
  /** The player's own parked Ask-the-GM questions only. */ pendingRuleAsks: readonly PlayerPendingRuleAsk[];
  /** True while the GM has the table viewing an earlier turn (no labels - those can name hidden combatants). */ rewound: boolean;
}>;
/** An archived, public character the GM shared for preview: id and name only. */
export type PlayerArchivedCharacter = Readonly<{ id: string; name: string }>;
export type PlayerView = Pick<GameState, "revision"> & {
  combat: PlayerCombatView;
  actors: PlayerActor[];
  rolls: PlayerRollRecord[];
  /** The GM's builder policy, verbatim (GM-set, player-read - a player's wizard offers exactly these methods). */ builderPolicy: BuilderPolicy;
  /** Archived characters the GM shared for preview (see PlayerArchivedCharacter). Empty by default. */ archivedCharacters: readonly PlayerArchivedCharacter[];
  /** The tier the server applied, so the client renders the shape it was given ("no definition" and "definition withheld" look the same otherwise). Descriptive only. */ partyVisibility: PartyVisibility;
};
export type GmActor = Actor & { presence: PresenceStatus | null };
/** One recorded turn boundary on the time-travel timeline. GM-only (labels can name hidden combatants); the server attaches the list to GM views at emission. */
export type TurnHistoryEntry = Readonly<{
  index: number;
  kind: "turn" | "return";
  label: string;
  revision: number;
  at: string;
}>;
export type GmView = Omit<GameState, "actors"> & { actors: GmActor[]; turnHistory?: readonly TurnHistoryEntry[] };
/** One line of the table feed. Players get only gmOnly=false entries; a `self-only` roll reaches the roller and
 * the GM. `kind: "roll"` rows share `RollRecord.id` with `GameState.rolls`, so dedupe on it. */
export type CombatLogEntry = Readonly<{
  id: number;
  at: string;
  kind:
    | "damage"
    | "heal"
    | "save"
    | "action"
    | "condition"
    | "reaction"
    | "turn"
    | "encounter"
    | "scene"
    | "history"
    | "roll"
    | "movement"
    | "effect"
    | "death-save"
    | "override";
  text: string;
  gmOnly: boolean;
  revision: number;
  /** Which character or monster this line is about; drives the feed's "just mine" filter. Absent on table-wide lines. */
  actorId?: string | null;
  /** The roll behind a `kind: "roll"` row; `initiatorSessionId` is stripped for every recipient, GM included. */
  roll?: PlayerRollRecord;
  /** True only on a `self-only` roll the recipient rolled. Computed per recipient; never stored. */
  private?: boolean;
}>;

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
/**
 * Why a command or read was refused, stable across rewording: branch on this, show the message. A
 * rules-mode block's code is instead the id of the rule that blocked it (`blocked.rule`). Over HTTP the
 * same code is `error.details.reason`, beside the envelope's coarse `error.code`.
 */
export type RefusalCode =
  | "not_joined"
  | "validation_failed"
  | "forbidden"
  | "not_found"
  | "stale_revision"
  | "needs_confirm"
  | "refused"
  | "history_review"
  | "scene_room_full"
  | "internal_error";
export type MutationResult = {
  ok: boolean;
  revision?: number;
  duplicate?: boolean;
  message?: string;
  /** Present on every refusal (`ok: false`). */
  code?: RefusalCode | (string & {});
  needsConfirm?: "rewrite-history" | "discard-changes";
  /** Present when a rules-mode validation blocked the command (ADR-0020); resend with override to bypass. */ blocked?: RulesBlocked;
};
export type DiceRollResult = MutationResult & { rollId?: string; hiddenFromRoller?: boolean };
export type EncounterStartEntry = Readonly<{
  actorId: string;
  score?: number;
  /** 2024 surprise: initiative rolls with disadvantage. */ surprised?: boolean;
}>;
export type AnnotationGeometryInput = Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
export type AnnotationAddResult = MutationResult & { annotationId?: string };
export type ActorAddResult = MutationResult & { actorId?: string };
export type SceneCreateResult = MutationResult & { sceneId?: string };
/** Compact browse row for bundled monster content; the server maps content definitions into this wire shape. */
export type ContentMonsterSummary = Readonly<{
  id: string;
  name: string;
  challengeRating: number;
  type: string;
  size: string;
  armorClass: number;
  hitPoints: number;
}>;
export type ContentMonstersResult = {
  ok: boolean;
  message?: string;
  monsters?: readonly ContentMonsterSummary[];
  attribution?: string;
};
/** SRD condition reference (name + rules text) for pickers and tooltips; public information for any joined session. */
export type ContentConditionSummary = Readonly<{ id: string; name: string; description: string }>;
export type ContentConditionsResult = {
  ok: boolean;
  message?: string;
  conditions?: readonly ContentConditionSummary[];
  /** The bundle's canonical CC BY 4.0 line (ADR-0015). */ attribution?: string;
};
/** SRD spell reference (rules text + the header fields a card shows) for the in-app spell rules window; public information for any joined session. */
export type ContentSpellSummary = Readonly<{
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  rangeText: string | null;
  componentsText: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  higherLevel: string | null;
  /** Whether casting it rolls an attack (the `fromPicks` predicate for Repelling Blast's "cantrip that requires an attack roll"). */
  attackRoll: boolean;
  /** Range in feet when the printed range is a distance, else null (Self and Touch are not zero). Read by the `ranged` predicate. */
  rangeFeet: number | null;
  /** Spell-list ids ("wizard", a homebrew list slug); the wizard's spell step matches `ContentClassSummary.spellcasting.spellListId`. */
  classes: readonly string[];
  /** Base damage/healing roll ("8d6"), or null for a spell that rolls nothing. Drives the sheet's "cast at" auto-roll. */
  damageRoll: string | null;
  /** Damage types for the base roll (empty for healing/none). */
  damageTypes: readonly string[];
  /** Per-slot-level upcast scaling parsed from the SRD (Fireball's 9d6 at 4th); the sheet applies the entry for the cast level. */
  castingOptions: ReadonlyArray<{ level: number; damageRoll: string | null; targetCount: number | null }>;
}>;
export type ContentSpellsResult = {
  ok: boolean;
  message?: string;
  spells?: readonly ContentSpellSummary[];
  /** The bundle's canonical CC BY 4.0 line (ADR-0015). */ attribution?: string;
};
/** One addable-equipment catalog row (SRD gear, weapons and armor in one shape). `category` is an open slug;
 * only "weapon", "armor" and "shield" drive AC and attack derivation, so group by the data, not a closed list.
 * `weapon` also carries browse-only `mastery`, which must not be copied onto an inventory row
 * (`ItemWeaponSchema` is strict); `inventoryWeaponFrom` does the conversion. */
export type ContentEquipmentSummary = Readonly<{
  id: string;
  name: string;
  category: string;
  costGp: number | null;
  weightLb: number | null;
  description: string | null;
  weapon: Readonly<{
    category: "simple" | "martial";
    damageDice: string;
    damageType: string;
    rangeFeet: number | null;
    longRangeFeet: number | null;
    mastery?: string;
    properties?: readonly string[];
  }> | null;
  armor: Readonly<{
    acBase: number;
    addDexModifier: boolean;
    dexModifierCap: number | null;
    stealthDisadvantage: boolean;
    strengthRequired: number | null;
  }> | null;
  appliesTo: Readonly<{ label: string; baseIds: readonly string[] }> | null;
}>;
export type ContentEquipmentResult = {
  ok: boolean;
  message?: string;
  equipment?: readonly ContentEquipmentSummary[];
  attribution?: string;
};

// ---------- Character-builder catalogs ----------
// Public SRD rules reference, readable by any joined session. Every response carries the CC BY 4.0
// `attribution` line the displaying surface must show (ADR-0015).

/** Where a catalog record came from. SRD and GM homebrew are merged server-side into one catalog. */
export type ContentSourceKind = "srd" | "homebrew";
/** One inline option of a feature's pick: its authored name and any second-order pick it owes (Divine Order's
 * "thaumaturge" grants an extra cantrip). Riders (actions, grants, modifiers, uses) stay server-side. */
export type ContentFeatureOptionSummary = Readonly<{
  id: string;
  name: string;
  description: string;
  /** The earlier pick that makes this option legal (Blessed Strikes), or null. The wizard filters like the server:
   * if gating leaves exactly as many options as picks, the answer is a consequence and no pick is shown. */
  requires: Readonly<{ offer: string; id: string }> | null;
  /** The first pick this option owes, or null; `choices` is the whole list. */
  choice: ContentFeatureChoiceSummary | null;
  /** Every pick this option owes, in authored order. */
  choices: readonly ContentFeatureChoiceSummary[];
  extraPicks: readonly ContentExtraPickSummary[];
}>;
/** One budget a feature or option raises: "one extra Cleric cantrip" is `{offer: "class-cantrips", amount: 1}`.
 * `offer` is an offer key shared with the server, which rejects keys naming no real offer. */
export type ContentExtraPickSummary = Readonly<{
  offer: string;
  /** A flat number of extra picks; null when `scaling` states it instead. Exactly one of the two is set. */
  amount: number | null;
  /** A budget that follows a class-table column (Eldritch Invocations 1 → 10), resolved with `extraPickAmount`. */
  scaling: PickBudgetScaling | null;
}>;
export type ContentFeatureChoiceSummary = Readonly<{
  kind: string;
  choose: number;
  from: readonly string[];
  fromCatalog: string | null;
  /** Ceiling on a spell pick's level (Evocation Savant: level 2 and under; Magic Initiate: cantrips). Null = none. */
  maxSpellLevel: number | null;
  /** Floor on a spell pick's level (Mystic Arcanum: both 6 means exactly level 6). Null = none. */
  minSpellLevel: number | null;
  /** Options drawn from the character's own earlier picks; `offer` names the budget, `where` a predicate slug. */
  fromPicks: Readonly<{ offer: string; where: string | null }> | null;
  /** Inline options with their names and any nested pick. Empty when the options come from `fromCatalog` or are plain ids in `from`. */
  options: readonly ContentFeatureOptionSummary[];
}>;
/** A class/subclass/species/background/feat feature as browse-and-pick data. Riders stay server-side. */
export type ContentFeatureSummary = Readonly<{
  id: string;
  name: string;
  level: number | null;
  description: string;
  tags: readonly string[];
  /** The first pick this feature asks for (open `kind` slug), or null. Each pick writes a `choices[]` ledger row. */ choice: ContentFeatureChoiceSummary | null;
  /** Every pick this feature asks for, in authored order (Magic Initiate owes two cantrips and one level-1 spell). */
  choices: readonly ContentFeatureChoiceSummary[]; /** Every class level that grants this feature: the repeat count (server capacity is choose × grants).
   * Empty for features not granted by a class table (species traits, feats, subclass features). */
  grantedAtLevels: readonly number[];
  extraPicks: readonly ContentExtraPickSummary[];
}>;
/** One row of a class's printed 20-level table, display only. `null` means the class has no such column. */
export type ContentClassLevelRow = Readonly<{
  level: number;
  proficiencyBonus: number;
  spellSlots: readonly number[] | null;
  pactSlots: Readonly<{ level: number; slots: number }> | null;
  cantripsKnown: number | null;
  spellsKnown: number | null;
  preparedFormula: string | null;
  preparedCount: number | null;
  classResources: ReadonlyArray<{ id: string; name: string; amount: number | string }>;
}>;
/** A starting-equipment bundle with resolvable contents; `goldPieces` is the "or take N gp" alternative. */
export type ContentStartingEquipmentOption = Readonly<{
  id: string;
  label: string;
  items: ReadonlyArray<{ id: string; name: string; quantity: number }>;
  goldPieces: number;
}>;
/** A "choose N from this list" proficiency grant, exactly as authored (class tool choices, background skill/tool/language choices). */
export type ContentChoiceList = Readonly<{
  choose: number;
  from: readonly string[];
  /** An open catalog slug supplying options instead of or beside `from`, resolved by `resolveCatalogChoice`
   * ("two languages from the Standard Languages table"). Null when `from` names them outright. */
  fromCatalog: string | null;
}>;
/** A spellcasting header. `spellListId` pairs with `ContentSpellSummary.classes`. */
export type ContentSpellcastingSummary = Readonly<{
  ability: string;
  prepares: "known" | "prepared";
  ritual: boolean;
  focus: string | null;
  progression: "full" | "half" | "third" | "pact";
  spellListId: string | null;
}>;
/** One playable class. `hitDie` keys the multiclass hit-dice pool; `statPriority` drives the random generator. */
export type ContentClassSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  hitDie: string;
  statPriority: readonly string[];
  primaryAbilities: readonly string[];
  savingThrows: readonly string[];
  skillChoiceCount: number;
  skillChoices: readonly string[];
  /** Granted armor/weapon/tool training as open slugs ("light", "martial", "thieves-tools"). */
  armorProficiencies: readonly string[];
  weaponProficiencies: readonly string[];
  toolProficiencies: readonly string[];
  /** "Choose N tools" where the class offers one (Monk-style); null otherwise. */
  toolChoices: ContentChoiceList | null;
  /** Proficiencies gained when this class is taken as a multiclass (narrower than the level-1 set); null when none. */
  multiclassProficiencies: Readonly<{
    armor: readonly string[];
    weapons: readonly string[];
    tools: readonly string[];
    skillChoices: ContentChoiceList | null;
  }> | null;
  /** Ability minimums for multiclassing into this class; `mode: "any"` covers "STR 13 or DEX 13". Null = always allowed. Display only; the server re-validates. */
  multiclassPrerequisites: Readonly<{
    mode: "all" | "any";
    minimums: ReadonlyArray<Readonly<{ ability: string; minimum: number }>>;
  }> | null;
  subclassLevel: number;
  subclassLabel: string | null;
  asiLevels: readonly number[];
  spellcastingAbility: string | null;
  spellcastingProgression: "full" | "half" | "third" | "pact" | null;
  spellcasting: ContentSpellcastingSummary | null;
  levelTable: readonly ContentClassLevelRow[];
  startingEquipmentOptions: readonly ContentStartingEquipmentOption[];
  features: readonly ContentFeatureSummary[];
}>;
export type ContentClassesResult = {
  ok: boolean;
  message?: string;
  classes?: readonly ContentClassSummary[];
  attribution?: string;
};
/** One subclass, keyed to its parent `classId`. `subclassLevel` is null when it simply inherits the class's own subclass level. */
export type ContentSubclassSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  classId: string;
  summary: string | null;
  description: string | null;
  subclassLevel: number | null;
  spellcastingAbility: string | null;
  spellcastingProgression: "full" | "half" | "third" | "pact" | null;
  /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own header, same shape as a class's; null otherwise. */
  spellcasting: ContentSpellcastingSummary | null;
  features: readonly ContentFeatureSummary[];
}>;
export type ContentSubclassesResult = {
  ok: boolean;
  message?: string;
  subclasses?: readonly ContentSubclassSummary[];
  attribution?: string;
};
/** One playable species. `sizes` is a list because several 2024 species let the player pick. SRD 5.2.1 puts ability increases on the background. */
export type ContentSpeciesSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  sizes: readonly string[];
  speedFeet: number;
  darkvisionFeet: number | null;
  creatureType: string;
  /** Fixed ability increases; empty for SRD 5.2.1 species, used by 2014-style or homebrew records. */
  abilityBonuses: ReadonlyArray<Readonly<{ ability: string; amount: number }>>;
  /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern); null when the species has none. */
  abilityBonusChoice: Readonly<{ choose: number; amount: number; from: readonly string[] }> | null;
  languages: readonly string[];
  /** "Choose N languages" where the species offers one; null otherwise. */
  languageChoices: ContentChoiceList | null;
  lineages: ReadonlyArray<{ id: string; name: string; description: string | null }>;
  features: readonly ContentFeatureSummary[];
}>;
export type ContentSpeciesResult = {
  ok: boolean;
  message?: string;
  species?: readonly ContentSpeciesSummary[];
  attribution?: string;
};
/** One background: the ability-increase options and proficiencies it grants, its origin feat, and its starting-equipment choices (chosen option recorded in the character's `choices[]` ledger). */
export type ContentBackgroundSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  abilityOptions: Readonly<{ from: readonly string[]; spreads: ReadonlyArray<readonly number[]> }> | null;
  originFeatId: string | null;
  skillProficiencies: readonly string[];
  /** "Choose N skills/tools/languages" where the background offers one; null otherwise. Fixed grants stay in the flat lists beside these. */
  skillChoices: ContentChoiceList | null;
  toolProficiencies: readonly string[];
  toolChoices: ContentChoiceList | null;
  languages: readonly string[];
  languageChoices: ContentChoiceList | null;
  startingEquipmentOptions: readonly ContentStartingEquipmentOption[];
  features: readonly ContentFeatureSummary[];
}>;
export type ContentBackgroundsResult = {
  ok: boolean;
  message?: string;
  backgrounds?: readonly ContentBackgroundSummary[];
  attribution?: string;
};
/** One skill and the ability its check uses; `ability` is null only when the bundle row lacks it (the server fills the 18 SRD skills). */
export type ContentSkillSummary = Readonly<{ id: string; name: string; description: string; ability: string | null }>;
export type ContentSkillsResult = {
  ok: boolean;
  message?: string;
  skills?: readonly ContentSkillSummary[];
  attribution?: string;
};
/** One language and its SRD table ("standard" / "rare"); the base language budget draws from "standard". */
export type ContentLanguageSummary = Readonly<{ id: string; name: string; description: string; table: string }>;
export type ContentLanguagesResult = {
  ok: boolean;
  message?: string;
  languages?: readonly ContentLanguageSummary[];
  attribution?: string;
};
/** One feat (a feature plus catalog metadata). Prerequisites are display data; the server decides whether one is met. */
export type ContentFeatSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  category: string;
  repeatable: boolean;
  prerequisiteLevel: number | null;
  prerequisiteAbilities: ReadonlyArray<{ ability: string; minimum: number }>;
  prerequisiteRequires: readonly string[];
  prerequisiteText: string | null;
  feature: ContentFeatureSummary;
}>;
export type ContentFeatsResult = {
  ok: boolean;
  message?: string;
  feats?: readonly ContentFeatSummary[];
  attribution?: string;
};
/** Name pools for one species, feeding the random generator. Pool `id` is an open slug; order comes from the data. */
export type ContentNameBundle = Readonly<{
  speciesId: string;
  source: ContentSourceKind;
  pools: ReadonlyArray<{ id: string; label: string; names: readonly string[] }>;
}>;
export type ContentNamesResult = {
  ok: boolean;
  message?: string;
  names?: readonly ContentNameBundle[];
  attribution?: string;
};
/** An area of effect parsed from a definition action's prose ("60-foot Cone", etc.); the GM places a matching template on the map. */
export type ContentActionArea = Readonly<{
  shape: "cone" | "line" | "sphere" | "cube" | "emanation";
  sizeFeet: number;
  widthFeet: number | null;
}>;
/** A definition action flattened for the GM's action runner. Structured fields only where the content has them; the ADR-0020 mechanics fields power availability hints (the server stays the authority). */
export type ContentActionSummary = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  description: string;
  attackBonus: number | null;
  reachFeet: number | null;
  rangeFeet: number | null;
  /** Normal range band for two-range weapons; shots beyond it (up to rangeFeet) roll at disadvantage. */ rangeNormalFeet:
    number | null;
  saveAbility: string | null;
  saveDc: number | null;
  damage: ReadonlyArray<{ formula: string; type: string }>;
  area: ContentActionArea | null;
  attackCount: number | null;
  usesLimit: number | null;
  usesPer: "turn" | "encounter" | "long-rest" | "short-rest" | "recharge" | null;
  /** d6 threshold for usesPer "recharge" ("Recharge 5-6" → 5); rolled automatically at the start of the owner's turn. */ usesRecharge:
    number | null;
  usesPool: string | null;
  requiresEffectTag: string | null;
  multiattack: ReadonlyArray<{ actionId: string; count: number }> | null;
  grants: boolean;
  reaction: Readonly<{ trigger: "hit-by-attack"; response: "half-damage" }> | null;
  /** SRD generic action rows (Dodge, Dash, Help, ...) appended after the stat block's own. */ builtin?: boolean;
  /** Builtin targeting: "single" picks one combatant, "none" is a direct tap. */ targeting?: "single" | "none";
  /** SRD Legendary Action cost against the creature's per-round pool (taken on other creatures' turns). */ legendaryCost?: number;
}>;
export type ContentActionsResult = {
  ok: boolean;
  message?: string;
  actions?: readonly ContentActionSummary[];
  /** The definition's legendary resources, when it has any (SRD 2024 legendary creatures). */ legendary?: Readonly<{
    actionsPerRound?: number;
    resistancesPerDay?: number;
  }>;
};
/** Full stat-block payload for the GM's sheet view; inert content data, GM-gated. */
export type ContentSheetResult = { ok: boolean; message?: string; definition?: import("@vtt/schemas").ActorDefinition };
/** Server-computed outcome of resolving a definition action (rolls already recorded in the roll history). */
export type ActionResolutionAttack = Readonly<{
  targetId: string;
  targetName: string;
  total: number;
  naturalRoll: number;
  targetAc: number | null;
  outcome: "crit" | "hit" | "miss" | "fumble" | "unknown";
  /** Cover's AC bonus folded into targetAc (SRD Cover: +2 half, +5 three-quarters). */ coverBonus?: number;
}>;
/** Every source behind an attack's advantage/disadvantage, so the table can see the math (ADR-0020). */
export type ActionRollMode = Readonly<{
  mode: "advantage" | "disadvantage" | "normal";
  advantage: readonly string[];
  disadvantage: readonly string[];
}>;
/** A feed line a resolve produced for the whole table (e.g. a push a rider caused), unlike `warnings`, which are
 * GM-only rules notes; anything players must not read stays in `warnings`. Two independent gates keep hidden
 * combatants out of player feeds: the resolver's `gmOnly` verdict, and `appendLog` (apps/server/src/server.ts)
 * re-checking `actorIds` for `visibility !== "public"`. A leak needs both to fail. */
export type ActionTableNarration = Readonly<{
  /** The feed row's kind, from the `CombatLogEntry` vocabulary. */
  kind: "movement" | "save";
  text: string;
  /** Everyone the line names. The feed keeps it from players when any of them is a hidden combatant. */
  actorIds: readonly string[];
  /** The resolver already knows this line names a hidden combatant; true forces the GM-only read. */
  gmOnly?: boolean;
}>;
export type ActionResolution = Readonly<{
  actionName: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  attack: ActionResolutionAttack | null;
  save: { ability: string; dc: number; targets: ReadonlyArray<{ targetId: string; targetName: string }> } | null;
  damage: ReadonlyArray<{ formula: string; type: string; total: number }>;
  damageTotal: number;
  crit: boolean;
  /** Advantage/disadvantage aggregation for the attack roll; absent when nothing contributed (plain 1d20). */
  rollMode?: ActionRollMode;
  /** Flat typed damage added by active effects (Rage +2 melee), included in damageTotal. */
  bonusDamage?: ReadonlyArray<{ amount: number; type: string; source: string }>;
  /** Source-linked effects the hit applied to targets (Bite: Grappled + Restrained). */
  effectsApplied?: ReadonlyArray<{
    targetId: string;
    targetName: string;
    name: string;
    conditionIds: readonly string[];
  }>;
  /** The self effect this action granted (Rage, Reckless Attack). */
  effectGranted?: Readonly<{ name: string; tags: readonly string[] }> | null;
  /** Remaining components of the open compound action after this resolve ("Attack 2 of 2" UI). */
  componentsRemaining?: Readonly<Record<string, number>> | null;
  /** Assisted-mode rule conflicts that were allowed through (also logged). */
  warnings?: readonly string[];
  /** Lines for the whole table to read (an accomplished push, the save a Topple forced); see `ActionTableNarration`. */
  tableNarration?: readonly ActionTableNarration[];
  /** Present when the GM overrode a strict-mode rejection; the override is logged and journaled. */
  overridden?: Readonly<{ rule: string; reason: string }> | null;
  /** Reaction prompts this hit opened (Uncanny Dodge): the triggering damage waits on the answer instead of the apply button. */
  reactionPrompts?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; actionName: string }>>;
  /** A builtin action's check roll (Hide vs DC 15; Influence/Search/Study with dc/success null - GM adjudicates). */
  check?: Readonly<{
    skill: string;
    total: number;
    naturalRoll: number;
    dc: number | null;
    success: boolean | null;
  }> | null;
  /** Effects this resolve ended as a rule consequence (attacking revealed Hiding; an off-turn action released a Ready). */
  effectsEnded?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; name: string }>>;
  /** An attack-roll preview: the d20 is shown but nothing is applied until confirmed or re-rolled. */
  preview?: boolean;
}>;
/** A strict-mode rules rejection: what rule blocked the command and whether an override may bypass it. */
export type RulesBlocked = Readonly<{ rule: string; message: string; overridable: boolean }>;
export type ActionResolveResult = MutationResult & { resolution?: ActionResolution };
/** Typed damage as applied: per-part defenses, temp-HP absorption and any zero-HP transition. */
export type DamageApplication = Readonly<{
  totalRequested: number;
  totalApplied: number;
  parts: ReadonlyArray<{
    type: string;
    amount: number;
    adjusted: number;
    adjustment: "resistance" | "immunity" | "vulnerability" | null;
    adjustmentSource: string | null;
  }>;
  temporaryAbsorbed: number;
  hpBefore: number;
  hpAfter: number;
  /** Zero-HP machine outcomes (player characters). */
  droppedToZero: boolean;
  deathSaveFailuresAdded: number;
  instantDeath: boolean;
  /** A non-PC hit 0 HP: effects it sustained were ended (grapples released). */
  defeated: boolean;
  /** Flat `damage-reduction` taken once off the post-resistance total, floored at 0. */
  flatReduction?: number;
}>;
export type DamageApplyResult = MutationResult & { applied?: DamageApplication };
export type DeathSaveResult = MutationResult & {
  deathSave?: Readonly<{
    naturalRoll: number;
    outcome: "success" | "failure" | "critical-success" | "critical-failure";
    successes: number;
    failures: number;
    stable: boolean;
    dead: boolean;
    regainedConsciousness: boolean;
    /** false = previewed only (pips unchanged, awaiting confirmation); true = applied. */ committed: boolean;
    /** The d20 mode when adv/disadv was chosen; absent for a plain roll. */ rollMode?:
      "advantage" | "disadvantage" | "normal";
  }>;
};
/** Outcome of answering a pending save; applied damage/condition already happened server-side when present. */
export type SaveAnswerResult = MutationResult & {
  outcome?: {
    success: boolean;
    total: number;
    dc: number;
    appliedDamage: number;
    conditionApplied: boolean;
    committed: boolean;
    /** Condition id that forced an automatic failure (Paralyzed on a Dex save); null/absent when rolled. */ autoFailed?:
      string | null;
    /** Advantage/disadvantage sources that shaped the save roll (Restrained, Dodge). */ rollMode?: ActionRollMode;
    /** The typed breakdown behind `appliedDamage`; absent when the save applied no damage. */ parts?: DamageApplication["parts"];
    /** Flat reduction taken off the post-resistance total. */ flatReduction?: number;
  };
};
/** Outcome of answering a reaction prompt; the (halved or full) damage already applied server-side. A used opportunity attack carries its full attack `resolution`. */
export type ReactionAnswerResult = MutationResult & {
  outcome?: {
    used: boolean;
    appliedDamage: number;
    resolution?: ActionResolution;
    /** The typed breakdown behind `appliedDamage`. */ parts?: DamageApplication["parts"];
    flatReduction?: number;
  };
};
/** One action's strict-mode availability for an actor, with every violated rule named (server-computed; ADR-0020 explainability). */
export type ActionAvailability = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  /** Whether strict mode would allow resolving this action right now (target-specific rules can't be pre-checked). */
  available: boolean;
  violations: ReadonlyArray<{ rule: string; message: string }>;
  /** Limited-use spending left in the current scope; null when the action has no use limit. */
  usesRemaining: number | null;
  /** Rolls left in the open compound-action instance for this action; null when no instance applies. */
  componentsRemaining: number | null;
  /** True for the SRD generic actions every combatant can take (Dodge, Dash, Help, ...) - not on the stat block. */
  builtin?: boolean;
}>;
/** The sheet's derived numbers. Sent only via `actor:available-actions` (authorized per actor), not `PlayerView`. */
export type DerivedAbilityRow = Readonly<{
  ability: AbilityId;
  check: number;
  checkWithProficiency: number;
  save: number;
  saveProficient: boolean;
  saveFromItems: number;
}>;
/** `tier` is the effective tier: the sheet's base raised by any item grant. `sources` names the items that raised it. */
export type DerivedSkillRow = Readonly<{
  id: string;
  name: string;
  ability: AbilityId | null;
  tier: "none" | "proficient" | "expertise";
  bonus: number | null;
  sources: readonly string[];
}>;
export type ActorDerivedSheet = Readonly<{
  proficiencyBonus: number;
  armorClass: number;
  initiative: number;
  abilities: readonly DerivedAbilityRow[];
  skills: readonly DerivedSkillRow[];
}>;
export type ActorActionsAvailabilityResult = {
  ok: boolean;
  message?: string;
  rulesMode?: "strict" | "assisted" | "freeform";
  actions?: readonly ActionAvailability[];
  derived?: ActorDerivedSheet;
};
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (
    payload: { commandId: string; actorId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:release": (
    payload: { commandId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:force-release": (
    payload: { commandId: string; actorId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "content:monsters": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentMonstersResult) => void
  ) => void;
  /** `joinEncounter` also adds the new combatant to the running fight (initiative + tray token) in the same command. Ignored when no fight is running. */
  "actor:add-from-definition": (
    payload: {
      commandId: string;
      definitionId: string;
      visibility?: "public" | "gm-only";
      joinEncounter?: boolean;
      expectedRevision?: number;
    },
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  "actor:remove": (
    payload: { commandId: string; actorId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:import-definition": (
    payload: { commandId: string; definition: unknown; visibility?: "public" | "gm-only"; expectedRevision?: number },
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  "character:submit-import": (
    payload: { commandId: string; definition: unknown; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:resolve-import": (
    payload: { commandId: string; importId: string; approve: boolean; expectedRevision?: number },
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  /** Roll a whole character server-side. The caller picks the level and optionally the class; the server makes every other pick. */
  "character:generate": (
    payload: { commandId: string; level: number; classId?: string; name?: string; expectedRevision?: number },
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  /** Create a character from choices; the server's feature-rider interpreter builds and imports the ActorDefinition. */
  "character:create": (
    payload: {
      commandId: string;
      name: string;
      speciesId: string;
      backgroundId: string;
      classId: string;
      level: number;
      subclassId?: string;
      abilityMethod: BuilderAbilityMethod;
      baseScores: Record<AbilityId, number>;
      backgroundBonusAllocation: ReadonlyArray<{ ability: AbilityId; amount: number }>;
      hp: { mode: "average" | "entries"; entries?: readonly number[] };
      choices: ReadonlyArray<{
        level: number;
        classId?: string;
        kind: string;
        id: string;
        payload?: Record<string, unknown>;
      }>;
      expectedRevision?: number;
    },
    acknowledgement: (result: ActorAddResult) => void
  ) => void;
  "builder:set-policy": (
    payload: {
      commandId: string;
      allowedAbilityMethods: readonly BuilderAbilityMethod[];
      customFormula?: string | null;
      maxLevel?: number;
      playerBuilder?: "open" | "gm-only";
      playerRandom?: "open" | "gm-only";
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** Rebuild or respec a character. The GM may rebuild anyone; a player only their own while the builder is open. */
  "character:rebuild": (
    payload: {
      commandId: string;
      actorId: string;
      speciesId: string;
      backgroundId: string;
      classId: string;
      level: number;
      subclassId?: string;
      abilityMethod: BuilderAbilityMethod;
      baseScores: Record<AbilityId, number>;
      backgroundBonusAllocation: ReadonlyArray<{ ability: AbilityId; amount: number }>;
      hp: { mode: "average" | "entries"; entries?: readonly number[] };
      choices: ReadonlyArray<{
        level: number;
        classId?: string;
        kind: string;
        id: string;
        payload?: Record<string, unknown>;
      }>;
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult & { actorId?: string }) => void
  ) => void;
  /** Roll six ability scores server-side for the builder; the set lands in the table feed. */
  "builder:roll-abilities": (
    payload: { commandId: string; method: "roll" | "custom"; expectedRevision?: number },
    acknowledgement: (
      result: MutationResult & { scores?: readonly number[]; dice?: ReadonlyArray<readonly number[]>; rollId?: string }
    ) => void
  ) => void;
  /** GM sets the standing rules policy every new fight inherits. Omitted `exceptions` keeps the stored ones. */
  "rules:set-policy": (
    payload: { commandId: string; dial: RuleMode; exceptions?: RuleExceptions; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** `route` is `resolved` (on this creature's turn in the fight) or `loose` (no fight). Off turn it returns `blocked`. */
  "action:use": (
    payload: {
      commandId: string;
      actorId: string;
      actionId: string;
      targetIds?: readonly string[];
      rollMode?: "advantage" | "disadvantage" | "normal";
      includeDamage?: boolean;
      expectedRevision?: number;
    },
    acknowledgement: (
      result: MutationResult & { route?: "resolved" | "loose"; rollIds?: readonly string[]; warning?: string }
    ) => void
  ) => void;
  /** Roll a saving throw: answers a matching pending save (`route: "answered"`), else a loose attributed save. */
  "save:roll": (
    payload: {
      commandId: string;
      actorId: string;
      ability: AbilityId;
      rollMode?: "advantage" | "disadvantage" | "normal";
      total?: number;
      expectedRevision?: number;
    },
    acknowledgement: (
      result: MutationResult & { route?: "answered" | "loose"; saveId?: string; rollId?: string }
    ) => void
  ) => void;
  /** The server first re-runs the command as the player; only a still-blocked one is parked for the GM (`askId`). */
  "rules:ask": (
    payload: { commandId: string; type: AskableCommand; payload: unknown; expectedRevision?: number },
    acknowledgement: (result: MutationResult & { askId?: string; ran?: boolean }) => void
  ) => void;
  /** GM answers a parked ask: Allow re-runs the parked command with an override (reason optional), Deny tells the player. */
  "rules:answer": (
    payload: { commandId: string; askId: string; allow: boolean; reason?: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM sets the table's staging defaults (the visibility a newly staged combatant's token starts at). */
  "table:set-staging-defaults": (
    payload: { commandId: string; visibility: "public" | "gm-only"; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM sets how much a player sees of another player's character; enforced in the projection, never client-side. */
  "table:set-party-visibility": (
    payload: { commandId: string; visibility: PartyVisibility; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-token-image": (
    payload: { commandId: string; actorId: string; tokenAssetId: string | null; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-size": (
    payload: {
      commandId: string;
      actorId: string;
      size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-visibility": (
    payload: { commandId: string; actorId: string; visibility: "public" | "gm-only"; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-archived": (
    payload: { commandId: string; actorId: string; archived: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** GM shares (or un-shares) an archived character's sheet with players as a read-only keepsake. Default hidden. */
  "actor:set-sheet-preview": (
    payload: { commandId: string; actorId: string; enabled: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-speed": (
    payload: { commandId: string; actorId: string; speedFeet: number | null; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** `damageType` types a bare manual `amount` (ignored when `parts` is present); `damageOverride` replaces a
   * rolled total while keeping its types. */
  "actor:apply-damage": (
    payload: {
      commandId: string;
      actorId: string;
      amount: number;
      parts?: ReadonlyArray<{ amount: number; type: string }>;
      damageType?: string;
      damageOverride?: number;
      sourceActorId?: string;
      sourceActionId?: string;
      sourceName?: string;
      critical?: boolean;
      nonlethal?: boolean;
      expectedRevision?: number;
    },
    acknowledgement: (result: DamageApplyResult) => void
  ) => void;
  "actor:heal": (
    payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-temp-hp": (
    payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-hp": (
    payload: { commandId: string; actorId: string; current: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-condition": (
    payload: {
      commandId: string;
      actorId: string;
      conditionId: string;
      active: boolean;
      level?: number;
      override?: { reason?: string };
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void
  ) => void;
  "content:conditions": (
    payload: Record<string, never>,
    acknowledgement: (result: ContentConditionsResult) => void
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
    payload: {
      commandId: string;
      actorId: string;
      actionId: string;
      targetIds?: readonly string[];
      template?: { shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint };
      conditionId?: string;
      rollMode?: "advantage" | "disadvantage" | "normal";
      override?: { reason?: string };
      effectId?: string;
      note?: string;
      cover?: "half" | "three-quarters" | "total";
      commit?: boolean;
      attackNatural?: number;
      attackTotal?: number;
      critical?: boolean;
      expectedRevision?: number;
    },
    acknowledgement: (result: ActionResolveResult) => void
  ) => void;
  "effect:add": (
    payload: {
      commandId: string;
      actorId: string;
      name: string;
      tags?: readonly string[];
      duration?:
        | { type: "rounds"; rounds: number }
        | { type: "until-source-next-turn" }
        | { type: "encounter" }
        | { type: "manual" };
      modifiers?: readonly EffectModifier[];
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult & { effectId?: string }) => void
  ) => void;
  "effect:end": (
    payload: { commandId: string; actorId: string; effectId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "death-save:roll": (
    payload: {
      commandId: string;
      actorId: string;
      commit?: boolean;
      rollMode?: "advantage" | "disadvantage" | "normal";
      naturalRoll?: number;
      expectedRevision?: number;
    },
    acknowledgement: (result: DeathSaveResult) => void
  ) => void;
  "encounter:set-rules-mode": (
    payload: { commandId: string; mode: RuleMode; exceptions?: RuleExceptions; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-player-damage-mode": (
    payload: { commandId: string; mode: "proposal" | "direct"; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-player-initiative-mode": (
    payload: { commandId: string; mode: "immediate" | "wait"; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-health-display": (
    payload: {
      commandId: string;
      style: "band" | "bar" | "ring" | "aura";
      audience: "gm" | "all";
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:set-health-display": (
    payload: {
      commandId: string;
      actorId: string;
      display: { style: "band" | "bar" | "ring" | "aura"; audience: "gm" | "all" } | null;
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:set-environment": (
    payload: { commandId: string; underwater: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:rest": (
    payload: { commandId: string; actorId: string; kind: "long" | "short"; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** Re-make a pick a feature says may be re-made on a rest (Circle of the Land's land type, Fiendish Resilience's damage type). `offer` is the offer key the build already uses. */
  "actor:rechoose": (
    payload: { commandId: string; actorId: string; offer: string; id: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:spend-hit-dice": (
    payload: { commandId: string; actorId: string; count: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-slot": (
    payload: { commandId: string; actorId: string; level: number; remaining: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-prepared": (
    payload: { commandId: string; actorId: string; spellId: string; prepared: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  // Optional item keys are declared so the type states the whole wire contract; the server validates `baseId`.
  "character:set-inventory": (
    payload: {
      commandId: string;
      actorId: string;
      item: {
        id: string;
        name: string;
        quantity?: number;
        equipped?: boolean;
        attuned?: boolean;
        weightEach?: number;
        description?: string;
        category?: string;
        baseId?: string;
        weapon?: Readonly<{
          category: "simple" | "martial";
          damageDice: string;
          damageType: string;
          rangeFeet: number | null;
          longRangeFeet: number | null;
          properties?: readonly string[];
        }>;
        armor?: Readonly<{
          acBase: number;
          addDexModifier: boolean;
          dexModifierCap: number | null;
          stealthDisadvantage: boolean;
          strengthRequired: number | null;
        }>;
        magic?: Readonly<{ isMagic?: boolean; attunementRequired?: boolean; slot?: string }>;
      };
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-currency": (
    payload: {
      commandId: string;
      actorId: string;
      currency: { cp?: number; sp?: number; ep?: number; gp?: number; pp?: number };
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  // `classes[].hitDie` lets an identity edit rebuild the multiclass hit-dice pool (Fighter 3 / Wizard 2 is 3d10 + 2d6).
  "character:set-identity": (
    payload: {
      commandId: string;
      actorId: string;
      character: {
        classes: ReadonlyArray<{
          id: string;
          name: string;
          subclass?: { id: string; name: string };
          level: number;
          hitDie?: HitDie;
        }>;
        race?: { id: string; name: string; subrace?: { id: string; name: string } };
        background?: { id: string; name: string };
        feats: ReadonlyArray<{ id: string; name: string; description?: string }>;
      };
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "character:set-proficiencies": (
    payload: {
      commandId: string;
      actorId: string;
      proficiencies: {
        saves: ReadonlyArray<"str" | "dex" | "con" | "int" | "wis" | "cha">;
        skills: ReadonlyArray<{ id: string; proficiency: "proficient" | "expertise" }>;
        saveOverrides?: Record<string, number>;
        skillOverrides?: Record<string, number>;
      };
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** `damageOverride` is the pre-halving damage the answerer means to apply, kept in the proposal's damage types. A player may amend only their own claimed character's save. */
  "save:answer": (
    payload: {
      commandId: string;
      saveId: string;
      method: "roll" | "manual";
      total?: number;
      rollMode?: "advantage" | "disadvantage" | "normal";
      commit?: boolean;
      legendaryResistance?: boolean;
      damageOverride?: number;
      expectedRevision?: number;
    },
    acknowledgement: (result: SaveAnswerResult) => void
  ) => void;
  "save:dismiss": (
    payload: { commandId: string; saveId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "reaction:answer": (
    payload: {
      commandId: string;
      reactionId: string;
      use: boolean;
      actionId?: string;
      commit?: boolean;
      rollMode?: "advantage" | "disadvantage" | "normal";
      attackNatural?: number;
      expectedRevision?: number;
    },
    acknowledgement: (result: ReactionAnswerResult) => void
  ) => void;
  "reaction:dismiss": (
    payload: { commandId: string; reactionId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "damage:resolve": (
    payload: { commandId: string; proposalId: string; apply: boolean; amount?: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "actor:available-actions": (
    payload: { actorId: string },
    acknowledgement: (result: ActorActionsAvailabilityResult) => void
  ) => void;
  "turn:use": (
    payload: { commandId: string; slot: "action" | "bonus-action"; used: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "turn:use-reaction": (
    payload: { commandId: string; actorId: string; used: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "turn:use-legendary": (
    payload: { commandId: string; actorId: string; spent: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "turn:end": (
    payload: { commandId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "dice:roll": (
    payload: {
      commandId: string;
      formula: string;
      purpose: RollPurpose;
      visibility: RollVisibility;
      label?: string;
      actorId?: string;
      expectedRevision?: number;
    },
    acknowledgement: (result: DiceRollResult) => void
  ) => void;
  "encounter:start": (
    payload: {
      commandId: string;
      mapAssetId: string;
      /** Omit while a prepared scene is live to start on exactly its staged combatants (the server owns that list). */ entries?: readonly EncounterStartEntry[];
      playersRollInitiative?: boolean;
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:end": (
    payload: { commandId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "encounter:add-combatant": (
    payload: { commandId: string; actorId: string; score?: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:set": (
    payload: { commandId: string; actorId: string; score: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:roll-self": (
    payload: {
      commandId: string;
      actorId: string;
      natural?: number;
      rollMode?: "advantage" | "disadvantage" | "normal";
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:roll-remaining": (
    payload: { commandId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:next": (
    payload: { commandId: string; confirmRewrite?: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "initiative:previous": (
    payload: { commandId: string; confirmDiscard?: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "log:read": (
    payload: Record<string, never>,
    acknowledgement: (result: { ok: boolean; message?: string; entries?: readonly CombatLogEntry[] }) => void
  ) => void;
  "token:move": (
    payload: {
      commandId: string;
      actorId: string;
      position: EncounterTokenPosition | null;
      sceneId?: string;
      override?: { reason?: string };
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void
  ) => void;
  "scene:create": (
    payload: {
      commandId: string;
      name: string;
      mapAssetId: string;
      combatantIds: readonly string[];
      /** Go live on the new scene in the same command (prepare-and-go), parking whatever was live. */ activate?: boolean;
      expectedRevision?: number;
    },
    acknowledgement: (result: SceneCreateResult) => void
  ) => void;
  "scene:rename": (
    payload: { commandId: string; sceneId: string; name: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "scene:remove": (
    payload: { commandId: string; sceneId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "scene:activate": (
    payload: { commandId: string; sceneId: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  /** Launch one recorded moment of an archived fight; combatants are cloned so live characters are never rewritten. GM only. */
  "replay:launch": (
    payload: { commandId: string; archiveId: number; turnIndex: number; expectedRevision?: number },
    acknowledgement: (result: MutationResult & { sceneId?: string; actorIds?: readonly string[] }) => void
  ) => void;
  "scene:set-combatants": (
    payload: { commandId: string; sceneId: string; combatantIds: readonly string[]; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "scene:duplicate": (
    payload: { commandId: string; sceneId: string; expectedRevision?: number },
    acknowledgement: (result: SceneCreateResult) => void
  ) => void;
  "scene:reorder": (
    payload: { commandId: string; order: readonly string[]; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "fog:set-enabled": (
    payload: { commandId: string; enabled: boolean; sceneId?: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "fog:paint": (
    payload: {
      commandId: string;
      op: "reveal" | "hide";
      rect: { x: number; y: number; width: number; height: number };
      sceneId?: string;
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "fog:reset": (
    payload: { commandId: string; sceneId?: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:add": (
    payload: {
      commandId: string;
      kind: "measurement" | "shape";
      shape?: AnnotationShapeKind;
      geometry: AnnotationGeometryInput;
      visibility?: AnnotationVisibility;
      visibleToActorId?: string | null;
      movableByOthers?: boolean;
      color?: string;
      expectedRevision?: number;
    },
    acknowledgement: (result: AnnotationAddResult) => void
  ) => void;
  "annotation:ping": (
    payload: { commandId: string; point: AnnotationPoint; color?: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:set-color": (
    payload: { commandId: string; id: string; color: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:move": (
    payload: { commandId: string; id: string; geometry: AnnotationGeometryInput; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:remove": (
    payload: { commandId: string; id: string; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:set-visibility": (
    payload: {
      commandId: string;
      id: string;
      visibility: AnnotationVisibility;
      visibleToActorId?: string | null;
      expectedRevision?: number;
    },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:set-movable": (
    payload: { commandId: string; id: string; movableByOthers: boolean; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
  "annotation:clear": (
    payload: { commandId: string; scope: "mine" | "players" | "all"; expectedRevision?: number },
    acknowledgement: (result: MutationResult) => void
  ) => void;
}
