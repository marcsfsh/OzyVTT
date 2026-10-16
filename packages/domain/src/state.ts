import { z } from "zod";
import { ActorDefinitionSchema, ActorSchema, HealthDisplaySchema } from "@vtt/schemas";

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
export const RollPurposeSchema = z.enum(["attack", "save", "check", "damage", "healing", "manual"]);
export const RollRecordSchema = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  initiatorSessionId: z.uuid(),
  initiatorRole: z.enum(["gm", "player"]),
  /** Who rolled: "GM" or the player's character name at roll time. Optional for older persisted rolls. */
  initiatorLabel: z.string().min(1).max(120).optional(),
  /** What was rolled ("Athletics check", "DEX save", a weapon or spell name); the UI falls back to the purpose. */
  label: z.string().min(1).max(80).optional(),
  actorId: z.uuid().nullable(),
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
  createdAt: z.iso.datetime()
});
export type RollVisibility = z.infer<typeof RollVisibilitySchema>;
export type RollPurpose = z.infer<typeof RollPurposeSchema>;
export type RollRecord = z.infer<typeof RollRecordSchema>;
export type PlayerRollRecord = Omit<RollRecord, "initiatorSessionId">;

export const InitiativeEntrySchema = z.object({
  actorId: z.uuid(),
  score: z.number().int().min(-1000).max(1000),
  tieBreaker: z.number().int().min(-1000).max(1000).default(0)
});
export type InitiativeEntry = z.infer<typeof InitiativeEntrySchema>;

export const EncounterTokenPositionSchema = z
  .object({
    x: z.number().nonnegative().max(1_000_000),
    y: z.number().nonnegative().max(1_000_000)
  })
  .strict();
export const EncounterTokenSchema = z
  .object({
    actorId: z.uuid(),
    position: EncounterTokenPositionSchema.nullable().default(null),
    sizePx: z.number().positive().max(4096),
    gridSizePx: z.number().positive().max(4096).nullable().default(null),
    gridRotationRadians: z.number().min(-Math.PI).max(Math.PI).nullable().default(null),
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
    x: z.number().nonnegative().max(1_000_000),
    y: z.number().nonnegative().max(1_000_000)
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
    sizeFeet: z.number().nonnegative().max(2000)
  })
  .strict();
export type AnnotationGeometry = z.infer<typeof AnnotationGeometrySchema>;

export const AnnotationColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #RRGGBB hex value.");
export const AnnotationSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["measurement", "shape", "ping"]),
    shape: AnnotationShapeKindSchema.nullable().default(null),
    geometry: AnnotationGeometrySchema,
    ownerSessionId: z.uuid(),
    createdByRole: z.enum(["gm", "player"]),
    visibility: AnnotationVisibilitySchema.default("public"),
    /** For `gm-actor` visibility: the actor whose owning player sees this alongside the GM. Null otherwise. */
    visibleToActorId: z.uuid().nullable().default(null),
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
        code: "custom",
        path: ["shape"],
        message: "A shape annotation must specify a shape kind."
      });
    if (annotation.kind !== "shape" && annotation.shape !== null)
      context.addIssue({
        code: "custom",
        path: ["shape"],
        message: "Only shape annotations specify a shape kind."
      });
    if (annotation.visibility === "gm-actor" && annotation.visibleToActorId === null)
      context.addIssue({
        code: "custom",
        path: ["visibleToActorId"],
        message: "gm-actor visibility requires a target actor."
      });
    if (annotation.visibility !== "gm-actor" && annotation.visibleToActorId !== null)
      context.addIssue({
        code: "custom",
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
    id: z.uuid(),
    targetActorId: z.uuid(),
    ability: AbilityIdSchema,
    dc: z.number().int().min(1).max(40),
    /** Source actor for GM bookkeeping; stripped from player projections. */
    sourceActorId: z.uuid().nullable().default(null),
    sourceName: z.string().min(1).max(120),
    actionName: z.string().min(1).max(120),
    proposedDamage: z.number().int().nonnegative().max(10000).default(0),
    /** Typed components of the proposed damage (optional for older saves); when present, application runs the typed-defense pipeline. */
    proposedDamageParts: z
      .array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict())
      .max(9)
      .optional(),
    halfOnSuccess: z.boolean().default(true),
    /** Conditions a failed save imposes. */
    conditionIds: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60)
      )
      .max(4)
      .default([]),
    /** Flat bonus to the save roll (GM-adjudicated cover: +2/+5 on Dex saves, SRD Cover). */
    saveBonus: z.number().int().min(0).max(10).default(0),
    /** Concentration check (SRD): effects ended when this save fails. Stripped from player projections. */
    endsEffects: z
      .array(z.object({ actorId: z.uuid(), effectId: z.string().min(1).max(120) }).strict())
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
        sourceActorId: z.uuid().nullable().default(null),
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
    id: z.uuid(),
    /** What opened the window: an attack that hit the reactor, or an enemy leaving its reach (opportunity attack). */
    kind: z.enum(["hit-by-attack", "leaves-reach"]).default("hit-by-attack"),
    actorId: z.uuid(),
    actionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    actionName: z.string().min(1).max(120),
    /** leaves-reach: the mover the reaction would strike. */
    targetActorId: z.uuid().nullable().default(null),
    /** Source actor for GM bookkeeping; stripped from player projections. */
    sourceActorId: z.uuid().nullable().default(null),
    sourceName: z.string().min(1).max(120),
    triggerCommandId: z.uuid(),
    proposedDamage: z.number().int().nonnegative().max(10000).default(0),
    proposedDamageParts: z
      .array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict())
      .max(18)
      .default([]),
    /** The triggering attack was a critical hit (drives death-save failure ticks when the damage lands). */
    critical: z.boolean().default(false),
    /** hit-by-attack: what each answer takes off hit points after the reactor's defences, weighed when the hit
     *  landed. Null when nothing was weighed (an opportunity attack). */
    weighed: z
      .object({
        use: z.number().int().nonnegative().max(10000),
        decline: z.number().int().nonnegative().max(10000)
      })
      .strict()
      .nullable()
      .default(null),
    createdAt: z.number().int().nonnegative()
  })
  .strict();
export type PendingReaction = z.infer<typeof PendingReactionSchema>;

/** A player's hit awaiting the GM's Apply (proposal mode, the default), so players never change HP on a creature
 * they don't own. GM-only: never projected to players or the viewer. */
export const PendingDamageSchema = z
  .object({
    id: z.uuid(),
    sourceActorId: z.uuid(),
    sourceName: z.string().min(1).max(120),
    actionName: z.string().min(1).max(120),
    targetActorId: z.uuid(),
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
        code: "custom",
        path: ["initiative", index, "actorId"],
        message: "Initiative actor IDs must be unique."
      });
    actorIds.add(entry.actorId);
  }
  if (combat.active && combat.initiative.length === 0)
    context.addIssue({
      code: "custom",
      path: ["initiative"],
      message: "An active encounter requires at least one combatant."
    });
  if (combat.active && combat.turnActorId === null)
    context.addIssue({
      code: "custom",
      path: ["turnActorId"],
      message: "An active encounter requires a current turn."
    });
  if (combat.turnActorId !== null && !actorIds.has(combat.turnActorId))
    context.addIssue({
      code: "custom",
      path: ["turnActorId"],
      message: "The current turn actor must be in Initiative."
    });
  const tokenActorIds = new Set<string>();
  for (const [index, token] of combat.tokens.entries()) {
    if (tokenActorIds.has(token.actorId))
      context.addIssue({
        code: "custom",
        path: ["tokens", index, "actorId"],
        message: "Encounter token actor IDs must be unique."
      });
    tokenActorIds.add(token.actorId);
    if (!actorIds.has(token.actorId))
      context.addIssue({
        code: "custom",
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
    id: z.uuid(),
    /** The character the blocked command was for; also decides which player may see this ask. */
    actorId: z.uuid(),
    /** The machine-readable rule that blocked it (e.g. `economy.action-used`). */
    rule: z.string().min(1).max(120),
    family: RuleFamilySchema.nullable().default(null),
    /** The player-facing sentence the block produced ("That needs your action - already used this turn"). */
    message: z.string().min(1).max(300),
    /** The parked command, replayed verbatim on Allow. GM-only - never projected to any player. */
    command: z.object({ type: AskableCommandSchema, payload: z.unknown() }).strict(),
    createdAt: z.iso.datetime()
  })
  .strict();
export type PendingRuleAsk = z.infer<typeof PendingRuleAskSchema>;

/** Combat fields shared by the live combat and each parked scene: everything except the map and scene bookkeeping. */
const sceneCombatShape = {
  active: z.boolean().default(false),
  round: z.number().int().positive().default(1),
  turnActorId: z.uuid().nullable().default(null),
  initiative: z.array(InitiativeEntrySchema).max(200).default([]),
  tokens: z.array(EncounterTokenSchema).max(200).default([]),
  annotations: z.array(AnnotationSchema).max(300).default([]),
  /** Action economy of the current turn's actor, reset on turn change. `actionInstance` holds remaining components
   * of an open compound action (Extra Attack) and `bonusActionInstance` those of a compound bonus action (Flurry of
   * Blows); `turnUses` is keyed `${actorId}:${actionId}`. */
  turn: z
    .object({
      actionUsed: z.boolean().default(false),
      bonusActionUsed: z.boolean().default(false),
      actionInstance: z
        .object({ actorId: z.uuid(), components: z.record(z.string(), z.number().int().nonnegative()) })
        .strict()
        .nullable()
        .default(null),
      bonusActionInstance: z
        .object({ actorId: z.uuid(), components: z.record(z.string(), z.number().int().nonnegative()) })
        .strict()
        .nullable()
        .default(null),
      turnUses: z.record(z.string(), z.number().int().nonnegative()).default({}),
      /** Feet of movement the current turn's actor has spent (fractional on gridless maps). */
      movementUsedFeet: z.number().nonnegative().max(100000).default(0),
      /** Rule families the GM already waved through this turn. Stripped from player projections. */
      rulesOverriddenFamilies: z.array(RuleFamilySchema).max(5).optional()
    })
    .prefault({
      actionUsed: false,
      bonusActionUsed: false,
      actionInstance: null,
      bonusActionInstance: null,
      turnUses: {},
      movementUsedFeet: 0
    }),
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
  reactionsUsed: z.array(z.uuid()).max(200).default([]),
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
              id: z.uuid(),
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
    .prefault({ enabled: false, shapes: [] }),
  pendingSaves: z.array(PendingSaveSchema).max(100).default([]),
  pendingReactions: z.array(PendingReactionSchema).max(20).default([]),
  /** GM-only (see PendingDamageSchema). */
  pendingDamage: z.array(PendingDamageSchema).max(50).default([]),
  /** A player sees only their own (see PendingRuleAskSchema). */
  pendingRuleAsks: z.array(PendingRuleAskSchema).max(10).default([]),
  /** Claimed-PC actorIds whose owner still owes an initiative roll. */
  pendingInitiative: z.array(z.uuid()).max(200).default([])
};

/** A parked scene's frozen combat - same fields and invariants as the live combat, minus the map (the Scene owns that). */
export const SceneCombatSchema = z.object(sceneCombatShape).superRefine(refineCombatContext);
export type SceneCombat = z.infer<typeof SceneCombatSchema>;

/** A prepared encounter the GM can switch to: its map plus a frozen combat context that resumes exactly when activated. */
export const SceneSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    mapAssetId: z.uuid(),
    combat: SceneCombatSchema.prefault({}),
    /** Set when this scene is a launched replay. Such scenes are disposable: `scenes.ts` drops the scene and its
     * cloned combatants (`Actor.replaySceneId`) when the table leaves it. GM-only. */
    replayOf: z
      .object({
        archiveId: z.number().int().nonnegative(),
        actorIds: z.array(z.uuid()).max(200)
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
    mapAssetId: z.uuid().nullable().default(null),
    /** Prepared scenes the GM parks and resumes. The active scene's own `combat` stays empty; its live copy is the top-level fields. */
    scenes: z.array(SceneSchema).max(20).default([]),
    activeSceneId: z.uuid().nullable().default(null),
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
          code: "custom",
          path: ["scenes", index, "id"],
          message: "Scene IDs must be unique."
        });
      sceneIds.add(scene.id);
    }
    if (combat.activeSceneId !== null && !sceneIds.has(combat.activeSceneId))
      context.addIssue({
        code: "custom",
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
        code: "custom",
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
  combat: CombatStateSchema.prefault({
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
  builderPolicy: BuilderPolicySchema.prefault({}),
  /** Standing rules policy every new fight starts from. GM-set, player-read. */
  rulesPolicy: RulesPolicySchema.prefault({}),
  /** Table defaults for staging new combatants. GM-set, GM-read. */
  stagingDefaults: StagingDefaultsSchema.prefault({}),
  /** How much a player sees of another player's character (see PartyVisibilitySchema). GM-set; player-read via `PlayerView`. */
  partyVisibility: PartyVisibilitySchema.default("name-and-class")
});
export type GameState = z.infer<typeof GameStateSchema>;
