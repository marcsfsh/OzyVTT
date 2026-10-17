import { z } from "zod";
import {
  ActionAreaSchema,
  ActorDefinitionSchema,
  DamageDrainSchema,
  ForcedPushSchema,
  ActorSchema,
  EffectInstanceSchema,
  EffectModifiersSchema,
  HealthDisplaySchema,
  SaveFailureDurationSchema
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
/** A player-submitted PDF import awaiting GM approval. GM-only: never in PlayerView or the viewer (ADR-0018). */
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
  /** The d20 was typed from a physical die; the server threw nothing. */
  typed: z.literal(true).optional(),
  createdAt: z.iso.datetime()
});
export type RollVisibility = z.infer<typeof RollVisibilitySchema>;
export type RollPurpose = z.infer<typeof RollPurposeSchema>;
export type RollRecord = z.infer<typeof RollRecordSchema>;
export type PlayerRollRecord = Omit<RollRecord, "initiatorSessionId">;

export const InitiativeEntrySchema = z.object({
  actorId: z.uuid(),
  score: z.number().int().min(-1000).max(1000),
  tieBreaker: z.number().int().min(-1000).max(1000).default(0),
  /** Surprised when the fight began (SRD Surprise), kept so a later roll of this entry has Disadvantage too. */
  surprised: z.boolean().optional()
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
    /** Footprint in cells per side; even sizes snap to grid intersections, odd ones to cell centers. */
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
/** What a save's outcome leaves on its target, e.g. Grappled with its escape DC from an Unarmed Strike grapple. */
const PendingSaveEffectSchema = z
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
    sourceName: z.string().max(120).nullable().default(null),
    /** How long it lasts, as the text prints it; absent is until ended. */
    duration: SaveFailureDurationSchema.optional(),
    /** The save the target repeats at the end of each of its turns, a success ending the effect. */
    repeatSave: EffectInstanceSchema.shape.repeatSave,
    endsOnDamage: z.boolean().optional(),
    speedZero: z.boolean().optional(),
    /** A grapple: it ends with its source's defeat, and when a move takes them farther apart than `rangeFeet`. */
    endsWhenSourceDefeated: z.boolean().optional(),
    rangeFeet: EffectInstanceSchema.shape.rangeFeet,
    /** The Concentration cast it belongs to: it is sustained by the caster's Concentration, and is not applied
     * once that has ended. */
    castId: z.string().min(1).max(120).optional(),
    /** The action it came from, so a second hit from the same action refreshes it and never stacks. */
    sourceActionId: z.string().max(120).optional(),
    /** Damage the effect deals at the start of a turn while it lasts (a swallow's acid). */
    ongoingDamage: EffectInstanceSchema.shape.ongoingDamage,
    /** A spell's or a magic item's, so the save repeated against it is one Magic Resistance helps with. */
    magical: EffectInstanceSchema.shape.magical,
    /** It ends when a spell restores the bearer's hit points (an infernal wound). */
    endsOnSpellHealing: EffectInstanceSchema.shape.endsOnSpellHealing,
    /** What the effect does while it lasts (Bane's -1d4 on attack rolls and saves). */
    modifiers: EffectModifiersSchema.default([]),
    /** What it adds to AC while it lasts (Slow's -2). */
    armorClassBonus: EffectInstanceSchema.shape.armorClassBonus,
    /** "Until the end of the current turn" for a save made at the start of the bearer's own turn (Stinking Cloud),
     *  where "until the end of its next turn" would run a turn longer. */
    currentTurn: z.literal(true).optional()
  })
  .strict();

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
    onFailEffect: PendingSaveEffectSchema.optional(),
    /** What a success leaves instead (Heat Metal: holding on to the red-hot object brings Disadvantage). The same shape
     *  as `onFailEffect`. GM bookkeeping, never projected. */
    onSuccessEffect: PendingSaveEffectSchema.optional(),
    /** A line for the table when the save fails, for what the engine can't do (Heat Metal: it drops the object, if it
     *  can). */
    failureNote: z.string().min(1).max(300).optional(),
    /** A failure also breaks the creature's Concentration (Sleet Storm). */
    breaksConcentration: z.literal(true).optional(),
    /** The spell area that raised it (`SpellZone`), which counts the damage it deals toward its cap. Never projected. */
    zoneId: z.string().min(1).max(120).optional(),
    /** A save the bearer repeats at the end of its turn: a success ends this effect. Stripped from player projections. */
    repeatOf: z
      .object({ actorId: z.uuid(), effectId: z.string().min(1).max(120) })
      .strict()
      .optional(),
    /** The GM's call for a roll this save answers; the outcome is written back to the call. */
    callId: z.uuid().optional(),
    /** Against a spell or another magical effect (a magic item's): Magic Resistance gives Advantage on it. */
    magical: z.literal(true).optional(),
    /** A success makes the target immune to this source's trait for the rest of the fight ("immune to this ghast's
     * Stench for 24 hours"). */
    immuneOnSuccess: z.literal(true).optional(),
    /** What the save's damage drains as it lands (Harm's lower Hit Point maximum). GM bookkeeping, never projected. */
    drain: DamageDrainSchema.optional(),
    /** Where a failure pushes the creature (Thunderwave), narrated when it lands. */
    failurePush: ForcedPushSchema.optional(),
    /** A creature this size or larger has Advantage on the save (Ensnaring Strike). */
    advantageAtSize: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional(),
    createdAt: z.number().int().nonnegative()
  })
  .strict();
export type PendingSave = z.infer<typeof PendingSaveSchema>;

/** What an ability check is made with: the ability, and a skill or a tool (or both) when one applies. */
export const CheckSubjectSchema = z
  .object({
    ability: AbilityIdSchema,
    skill: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional(),
    tool: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional()
  })
  .strict();
export type CheckSubject = z.infer<typeof CheckSubjectSchema>;

/**
 * Dice thrown before they count, held so a second look at the same roll returns the same dice (ADR-0012): a previewed
 * save, death save, attack or opportunity attack, and the latest check, which Heroic Inspiration may still reroll.
 * GM-only; the player saw the dice in the roll itself.
 */
export const HeldRollSchema = z
  .object({
    /** What the dice belong to: `save:<saveId>`, `death-save:<actorId>`, `attack:<actorId>`, `reaction:<reactionId>`
     *  or `check:<actorId>`. */
    key: z.string().min(1).max(200),
    actorId: z.uuid(),
    /** The d20 faces thrown so far, in order. */
    faces: z.array(z.number().int().min(1).max(20)).min(1).max(2),
    /** The roll's other dice as thrown (Bless's d4), kept with the d20s. */
    others: z
      .array(z.object({ sides: z.number().int().min(2).max(100), face: z.number().int().min(1).max(100) }).strict())
      .max(20)
      .default([]),
    /** The roll the faces were recorded under. */
    rollId: z.uuid().nullable().default(null),
    /** Typed from a physical die; the server threw nothing. */
    typed: z.boolean().default(false),
    /** The round and turn they were thrown in: a die held for one turn's attack is not reused on a later turn. */
    round: z.number().int().nonnegative(),
    turnActorId: z.uuid().nullable(),
    /** A check's subject and how it was made, so Heroic Inspiration can reroll it. */
    check: z
      .object({
        subject: CheckSubjectSchema,
        dc: z.number().int().min(1).max(40).nullable(),
        visibility: RollVisibilitySchema,
        /** The GM's forced mode, which a reroll keeps. */
        rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
        callId: z.uuid().optional(),
        findActorId: z.uuid().optional()
      })
      .strict()
      .optional(),
    createdAt: z.number().int().nonnegative()
  })
  .strict();
export type HeldRoll = z.infer<typeof HeldRollSchema>;

/** One character's part of a call for a roll: who, the pending save a save call opened, and the result once rolled. */
export const RollCallEntrySchema = z
  .object({
    actorId: z.uuid(),
    saveId: z.uuid().optional(),
    result: z
      .object({
        natural: z.number().int().min(0).max(20),
        total: z.number().int(),
        /** Null when the call set no DC. */
        success: z.boolean().nullable(),
        /** The condition that made a Strength or Dexterity save fail without a roll. */
        autoFailed: z.string().max(60).optional(),
        rollId: z.uuid().optional()
      })
      .strict()
      .optional()
  })
  .strict();
/**
 * The GM's call for a roll: a check or a save from one or several characters, with an optional DC. A save call opens a
 * pending save for each character; a check call is answered with `roll-call.answer`. A blind call's rolls are hidden from
 * the players who make them. Closed by the GM.
 */
export const RollCallSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["check", "save"]),
    subject: CheckSubjectSchema,
    dc: z.number().int().min(1).max(40).nullable(),
    blind: z.boolean().default(false),
    entries: z.array(RollCallEntrySchema).min(1).max(20),
    createdAt: z.number().int().nonnegative()
  })
  .strict();
export type RollCall = z.infer<typeof RollCallSchema>;

/** An attack a reaction (Parry, Shield) may still turn into a miss, held at the roll until the prompt is answered and
 * then replayed with the same die. The economy it spent was committed when it rolled. GM-only. */
export const ParkedAttackSchema = z
  .object({
    actionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    /** The action came from the builtin catalog (Unarmed Strike). */
    builtin: z.boolean(),
    /** The kept d20, or null when the total was typed by hand. */
    attackNatural: z.number().int().min(1).max(20).nullable(),
    attackTotal: z.number().int().min(-50).max(100).nullable(),
    cover: z.enum(["half", "three-quarters"]).nullable(),
    conditionId: z.string().max(60).nullable(),
    /** How the attack was made where the action can't say (an opportunity attack). */
    attackKinds: z.array(z.enum(["reaction", "opportunity"])).max(2),
    pushFeet: z.number().int().min(0).max(100).nullable(),
    /** The slot the spell was cast with, so the replay rolls the same dice. */
    slotLevel: z.number().int().min(1).max(9).nullable(),
    /** The damage type the caster picked (Chromatic Orb), so the replay deals it. */
    damageType: z.string().max(40).nullable().default(null),
    /** Dice an effect added to the roll (Bless's d4) as they rolled, so the replay totals the same. */
    bonusDice: z
      .array(
        z
          .object({
            label: z.string().min(1).max(120),
            dice: z.string().max(8),
            total: z.number().int().min(-48).max(48)
          })
          .strict()
      )
      .max(8)
      .default([]),
    /** Attacker to target when it rolled, so the replay classifies the swing (melee or thrown) the same way. */
    distanceFeet: z.number().min(0).max(100000).nullable(),
    initiatorRole: z.enum(["gm", "player"]),
    initiatorSessionId: z.string().min(1).max(200),
    /** The bonus lasts until the reactor's next turn (Shield); without it, the bonus counts against this attack only (Parry). */
    untilNextTurn: z.boolean(),
    /** Extras chosen for the hit (Sneak Attack, a smite), checked and spent only if it still hits. */
    hitOptions: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(120),
            damageType: z
              .string()
              .regex(/^[a-z]+$/)
              .max(40)
              .optional(),
            slotLevel: z.number().int().min(1).max(9).optional()
          })
          .strict()
      )
      .max(6)
      .default([])
  })
  .strict();
export type ParkedAttack = z.infer<typeof ParkedAttackSchema>;

/** A declared reaction (ADR-0020) awaiting an answer, which persists until it is answered or the GM dismisses it, so
 * nothing it holds is lost. What it holds depends on the trigger: a hit's damage (Uncanny Dodge), an attack not yet
 * landed (Parry), or nothing, when answering strikes a creature (an opportunity attack, Hellish Rebuke). */
export const PendingReactionSchema = z
  .object({
    id: z.uuid(),
    /** What opened the window: an attack that hit the reactor, an enemy leaving its reach (opportunity attack), an
     *  attack that would hit before its damage (`attack-would-hit`), or a creature damaging the reactor. */
    kind: z.enum(["hit-by-attack", "leaves-reach", "attack-would-hit", "damaged-by-creature"]).default("hit-by-attack"),
    actorId: z.uuid(),
    actionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    actionName: z.string().min(1).max(120),
    /** leaves-reach and damaged-by-creature: the creature the reaction would strike. */
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
    /** attack-would-hit: what the reaction adds to AC. */
    acBonus: z.number().int().min(1).max(10).nullable().default(null),
    /** Answering "use" rolls an attack, previewed before it lands (Retaliation; an opportunity attack always does). */
    rollsAttack: z.boolean().default(false),
    /** attack-would-hit: the attack the answer finishes. */
    parkedAttack: ParkedAttackSchema.nullable().default(null),
    /** attack-would-hit: the held attack's total, against the reactor's AC before the reaction. */
    attackTotal: z.number().int().min(-100).max(1000).optional(),
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
    /** What the damage drains as it lands (Vampiric Touch's healing). */
    drain: DamageDrainSchema.optional(),
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

/** Every family follows the dial (the campaign's Enforce, Advise or Off) until the GM turns one off. */
export const DEFAULT_RULE_EXCEPTIONS: RuleExceptions = {};

/** Closed list: `rules.answer` replays the parked payload under GM authority. */
export const AskableCommandSchema = z.enum([
  "action.resolve",
  "action.use",
  "token.move",
  "actor.set-condition",
  "effect.end"
]);
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
    /** The player-facing sentence the block produced ("Borin has already used a Bonus Action this turn."). */
    message: z.string().min(1).max(300),
    /** The parked command, replayed verbatim on Allow. GM-only, never projected to any player. */
    command: z.object({ type: AskableCommandSchema, payload: z.unknown() }).strict(),
    createdAt: z.iso.datetime()
  })
  .strict();
export type PendingRuleAsk = z.infer<typeof PendingRuleAskSchema>;

/** A point on the battlemap, in image pixels. */
const VisionPointSchema = z.object({ x: z.number().min(0).max(100000), y: z.number().min(0).max(100000) }).strict();

/** A wall in image pixels (ADR-0023). A wall blocks sight, light and movement; a door does too while it is closed; a
 * window blocks movement only. `open` is a door's alone. */
export const VisionWallSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["wall", "door", "window"]),
    a: VisionPointSchema,
    b: VisionPointSchema,
    open: z.boolean().optional()
  })
  .strict();
export type VisionWall = z.infer<typeof VisionWallSchema>;

/** A light: placed on the map (`position`) or carried by a token (`actorId`), never both. Radii are in feet as the SRD
 * prints them: Bright Light out to `brightFeet`, and Dim Light for `dimFeet` more. */
export const VisionLightSchema = z
  .object({
    id: z.uuid(),
    position: VisionPointSchema.nullable().default(null),
    actorId: z.uuid().nullable().default(null),
    brightFeet: z.number().min(0).max(1000),
    dimFeet: z.number().min(0).max(1000)
  })
  .strict()
  .refine((light) => (light.position === null) !== (light.actorId === null), {
    message: "A light is either placed on the map or carried by a token."
  });
export type VisionLight = z.infer<typeof VisionLightSchema>;

/** The scene's dynamic vision (ADR-0023). Off by default, so a scene without it behaves as before. `measure` is the
 * map's size and scale, written by the server whenever the GM edits it, so feet convert to pixels without the map
 * catalog (a replay of the fight reads it too). `explored` is what the party has seen in this scene: a bitmap over the
 * map in `cellPx` squares, row-major, base64. GM-only as stored; players get their own projection. */
export const SceneVisionSchema = z
  .object({
    enabled: z.boolean().default(false),
    ambient: z.enum(["bright", "dim", "dark"]).default("bright"),
    walls: z.array(VisionWallSchema).max(1000).default([]),
    lights: z.array(VisionLightSchema).max(100).default([]),
    measure: z
      .object({
        width: z.number().positive().max(100000),
        height: z.number().positive().max(100000),
        pixelsPerFoot: z.number().positive().max(10000)
      })
      .strict()
      .nullable()
      .default(null),
    explored: z
      .object({
        cellPx: z.number().positive().max(100000),
        columns: z.number().int().min(1).max(256),
        rows: z.number().int().min(1).max(256),
        bits: z.string().max(11000)
      })
      .strict()
      .nullable()
      .default(null)
  })
  .strict();
export type SceneVision = z.infer<typeof SceneVisionSchema>;
export const EMPTY_SCENE_VISION: SceneVision = {
  enabled: false,
  ambient: "bright",
  walls: [],
  lights: [],
  measure: null,
  explored: null
};

/**
 * An area a spell left on the map that acts on creatures later (Spirit Guardians, Moonbeam, a wall of fire): the
 * server raises its save or deals its damage when a creature enters it or starts or ends its turn there. When and how
 * it acts is the spell's (`laterActionId` names the spell's later action with the zone); the numbers are the cast's.
 * GM-only: it names the caster, which may be hidden.
 */
export const SpellZoneSchema = z
  .object({
    /** The cast's command id. */
    id: z.string().min(1).max(120),
    spellId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    name: z.string().min(1).max(120),
    laterActionId: z.string().min(1).max(120),
    casterId: z.uuid(),
    /** The Concentration cast it ends with; null for a spell that lasts `rounds` from `startedRound`, or until ended. */
    castId: z.string().min(1).max(120).nullable(),
    rounds: z.number().int().min(1).max(100).nullable().default(null),
    startedRound: z.number().int().positive(),
    /** The slot level it was cast at, which its damage rolls at. */
    level: z.number().int().min(0).max(9),
    dc: z.number().int().min(1).max(40),
    /** The area placed on the map (an annotation); null until the GM places one. An Emanation needs none. */
    annotationId: z.string().min(1).max(120).nullable(),
    /** The template the GM places it with: the spell's own area. Null for an Emanation, which is its caster's. */
    area: ActionAreaSchema.nullable().default(null),
    /** Damage dealt so far, against a cap the spell prints (Guardian of Faith's 60). */
    damageDealt: z.number().int().nonnegative().max(100000).default(0),
    /** This turn's marks: who has entered it, and who has made its save or taken its damage. Cleared as each turn
     *  begins. */
    entered: z.array(z.uuid()).max(200).default([]),
    affected: z.array(z.uuid()).max(200).default([])
  })
  .strict();
export type SpellZone = z.infer<typeof SpellZoneSchema>;

/** Combat fields shared by the live combat and each parked scene: everything except the map and scene bookkeeping. */
const sceneCombatShape = {
  active: z.boolean().default(false),
  round: z.number().int().positive().default(1),
  turnActorId: z.uuid().nullable().default(null),
  initiative: z.array(InitiativeEntrySchema).max(200).default([]),
  tokens: z.array(EncounterTokenSchema).max(200).default([]),
  annotations: z.array(AnnotationSchema).max(300).default([]),
  /** The spell areas that act on creatures later (see SpellZoneSchema). GM-only. */
  spellZones: z.array(SpellZoneSchema).max(20).default([]),
  /** Action economy of the current turn's actor, reset on turn change. `actionInstance` holds remaining components
   * of an open compound action (Extra Attack) and `bonusActionInstance` those of a compound Bonus Action (Flurry of
   * Blows); `turnUses` is keyed `${actorId}:${actionId}`. */
  turn: z
    .object({
      actionUsed: z.boolean().default(false),
      bonusActionUsed: z.boolean().default(false),
      /** `slotLevel`: the slot a multi-attack spell (Scorching Ray) was cast with, which its later rays roll at. A
       *  component keyed "a|b" is filled by either action. A Multiattack's instance names it (`parentId`) and the
       *  replacements it has left, keyed by their actions ("roar": 1); neither is projected. */
      actionInstance: z
        .object({
          actorId: z.uuid(),
          components: z.record(z.string(), z.number().int().nonnegative()),
          slotLevel: z.number().int().min(1).max(9).optional(),
          parentId: z.string().max(120).optional(),
          replacements: z.record(z.string(), z.number().int().nonnegative()).optional()
        })
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
      rulesOverriddenFamilies: z.array(RuleFamilySchema).max(5).optional(),
      /** Who has expended a spell slot to cast a spell this turn (SRD: one per turn). Engine bookkeeping, never
       *  projected. */
      spellSlotCasters: z.array(z.uuid()).max(200).optional(),
      /** The turn's actor has made its one death save (SRD: at the start of its turn). Never projected. */
      deathSaveRolled: z.boolean().optional(),
      /** The turn's actor has made an attack roll on its turn (SRD Reckless Attack is decided with the first). Engine
       *  bookkeeping, never projected. */
      attackRolled: z.boolean().optional(),
      /** What this turn's attacks opened for an extra attack: the Light weapons its actor swung in the Attack action,
       *  and the creature a Cleave weapon hit; and the Loading weapons already fired in that action, which can't
       *  fire again in it. Engine bookkeeping, never projected. */
      extraAttacks: z
        .object({
          light: z
            .object({ actorId: z.uuid(), itemIds: z.array(z.string().max(120)).max(10) })
            .strict()
            .nullable()
            .default(null),
          loading: z
            .object({ actorId: z.uuid(), itemIds: z.array(z.string().max(120)).max(10) })
            .strict()
            .nullable()
            .default(null),
          cleave: z
            .object({ actorId: z.uuid(), itemId: z.string().max(120), targetId: z.uuid() })
            .strict()
            .nullable()
            .default(null)
        })
        .strict()
        .optional(),
      /** The turn's actor's actions beyond its one (SRD Action Surge, Haste): Action Surges taken and not yet used,
       *  whether Haste's limited action is used, and the Magic actions taken (Action Surge's isn't a second one).
       *  Engine bookkeeping, never projected. */
      extraActions: z
        .object({
          actorId: z.uuid(),
          surges: z.number().int().min(0).max(4).default(0),
          surgedThisTurn: z.boolean().default(false),
          hasteUsed: z.boolean().default(false),
          magicActions: z.number().int().min(0).max(10).default(0)
        })
        .strict()
        .optional()
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
   * no shapes means a fully hidden map. Rects are in image-pixel space. Players get the shapes verbatim; a creature
   * whose whole space lies under the fog is left out of their projections (ADR-0023). */
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
  /** GM-painted difficult terrain: disjoint image-pixel rects, snapped to whole cells on an unrotated grid.
   * Entering a cell whose centre lies in one costs double (SRD Difficult Terrain). Players and the table screen
   * receive only the parts the fog has revealed. */
  terrain: z
    .object({
      difficult: z
        .array(
          z
            .object({
              x: z.number().min(0).max(100000),
              y: z.number().min(0).max(100000),
              width: z.number().positive().max(100000),
              height: z.number().positive().max(100000)
            })
            .strict()
        )
        .max(1000)
        .default([])
    })
    .strict()
    .prefault({ difficult: [] }),
  /** Walls, doors, lights and what the party has seen (ADR-0023). With `enabled`, the server sends each player only
   * what their characters can see; scene dressing like fog, so a rewind keeps it. */
  vision: SceneVisionSchema.prefault({}),
  pendingSaves: z.array(PendingSaveSchema).max(100).default([]),
  pendingReactions: z.array(PendingReactionSchema).max(20).default([]),
  /** GM-only (see PendingDamageSchema). */
  pendingDamage: z.array(PendingDamageSchema).max(50).default([]),
  /** A player sees only their own (see PendingRuleAskSchema). */
  pendingRuleAsks: z.array(PendingRuleAskSchema).max(10).default([]),
  /** Claimed-PC actorIds whose owner still owes an initiative roll. */
  pendingInitiative: z.array(z.uuid()).max(200).default([])
};

/** A parked scene's frozen combat: same fields and invariants as the live combat, minus the map (the Scene owns that). */
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
        active.combat.spellZones.length > 0 ||
        active.combat.reactionsUsed.length > 0 ||
        Object.keys(active.combat.legendaryUsed).length > 0 ||
        active.combat.fog.enabled ||
        active.combat.fog.shapes.length > 0 ||
        active.combat.terrain.difficult.length > 0 ||
        active.combat.vision.enabled ||
        active.combat.vision.walls.length > 0 ||
        active.combat.vision.lights.length > 0 ||
        active.combat.vision.explored !== null ||
        active.combat.pendingSaves.length > 0 ||
        active.combat.pendingReactions.length > 0 ||
        active.combat.pendingDamage.length > 0 ||
        active.combat.pendingRuleAsks.length > 0 ||
        active.combat.pendingInitiative.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["scenes"],
        message: "The active scene's stored combat must be empty, because its live copy is the top-level combat."
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
    playerRandom: z.enum(["open", "gm-only"]).default("gm-only"),
    /** The table's one setting for typed dice (ADR-0012): whether players may type what their physical dice show, for
     *  every roll (checks, saves, attacks, damage, death saves, initiative, and rolled scores and hit points in the
     *  builder). Open by default, for tables that roll physical dice; "gm-only" refuses a player's typed faces and the
     *  server throws them. The GM may always type. */
    typedRolls: z.enum(["open", "gm-only"]).default("open"),
    /** A table rule raising a rolled hit-point level to the class average; "none" is the SRD (the roll stands). */
    hitPointRollFloor: z.enum(["none", "average"]).default("none")
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

/** A Short Rest the GM runs for several characters at once. Each player spends Hit Dice on their own device and
 *  says when they are done; the benefits land when the GM finishes it. */
export const PartyShortRestSchema = z
  .object({
    actorIds: z.array(z.uuid()).min(1).max(12),
    /** Members whose players are done choosing. The GM may finish without them. */
    done: z.array(z.uuid()).max(12).default([])
  })
  .strict();
export type PartyShortRest = z.infer<typeof PartyShortRestSchema>;

/** Game time and the rests waiting on the GM. The clock exists for the 16-hour rule between Long Rests; the GM
 *  moves it, and a party rest moves it by the rest's length. */
export const RestStateSchema = z
  .object({
    /** Whole hours of game time since the campaign's clock started. */
    clockHours: z.number().int().min(0).max(10_000_000).default(0),
    /** Characters whose players asked for a Long Rest, oldest first. */
    requests: z.array(z.uuid()).max(50).default([]),
    shortRest: PartyShortRestSchema.nullable().default(null)
  })
  .strict();
export type RestState = z.infer<typeof RestStateSchema>;

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
  partyVisibility: PartyVisibilitySchema.default("name-and-class"),
  /** Dice thrown before they count (see HeldRollSchema). GM-only. */
  heldRolls: z.array(HeldRollSchema).max(100).default([]),
  /** The GM's open calls for a roll. A player reads only their own part of each. */
  rollCalls: z.array(RollCallSchema).max(20).default([]),
  /** Game time, Long Rest requests and the party's Short Rest. Players see only their own characters' part. */
  rest: RestStateSchema.prefault({})
});
export type GameState = z.infer<typeof GameStateSchema>;
