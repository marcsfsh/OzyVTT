import { z } from "zod";

/** Version 1 is intentionally small; it establishes the import contract before an adapter exists. */
export const ACTOR_SCHEMA_VERSION = 1;
export const ActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: z.enum(["player-character", "monster", "npc"]),
  visibility: z.enum(["public", "gm-only"]).default("public"),
  hp: z.object({ current: z.number().int(), maximum: z.number().int().positive(), temporary: z.number().int().nonnegative().default(0) }),
  armorClass: z.number().int().positive().optional(),
  initiative: z.number().int().optional(),
  ownerSessionId: z.string().uuid().nullable().default(null),
  notes: z.string().max(10000).optional()
});

export type Actor = z.infer<typeof ActorSchema>;

/** Immutable reusable content imported from JSON; mutable HP/position/ownership live elsewhere. */
export const ACTOR_DEFINITION_SCHEMA_VERSION = 1;
const DiceFormulaSchema = z.string().regex(/^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i, "Use a safe dice formula such as 1d8 + 3.");
const AbilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const ActionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1).max(120), activation: z.enum(["action", "bonus-action", "reaction", "other"]), description: z.string().min(1).max(12000),
  attack: z.object({ bonus: z.number().int(), reachFeet: z.number().int().positive().optional(), rangeFeet: z.number().int().positive().optional() }).optional(),
  save: z.object({ ability: AbilitySchema, dc: z.number().int().min(1).max(40) }).optional(),
  damage: z.array(z.object({ formula: DiceFormulaSchema, type: z.string().min(1).max(40) })).max(8).default([])
});
export const ActorDefinitionSchema = z.object({
  schemaId: z.enum(["vtt.actor-character", "vtt.actor-monster"]), schemaVersion: z.literal(ACTOR_DEFINITION_SCHEMA_VERSION),
  source: z.object({ name: z.string().min(1).max(200), version: z.string().min(1).max(80), externalId: z.string().max(200).optional() }),
  name: z.string().min(1).max(120), summary: z.string().max(280).optional(), size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]),
  abilityScores: z.object({ str: z.number().int().min(1).max(30), dex: z.number().int().min(1).max(30), con: z.number().int().min(1).max(30), int: z.number().int().min(1).max(30), wis: z.number().int().min(1).max(30), cha: z.number().int().min(1).max(30) }),
  proficiencyBonus: z.number().int().min(0).max(12), armorClass: z.number().int().min(1).max(40), hitPoints: z.object({ maximum: z.number().int().positive(), formula: DiceFormulaSchema.optional() }), initiativeBonus: z.number().int().min(-20).max(30).default(0), speedFeet: z.number().int().nonnegative(),
  actions: z.array(ActionSchema).max(100).default([]), token: z.object({ disposition: z.enum(["friendly", "hostile", "neutral"]).default("neutral"), footprint: z.object({ width: z.number().int().positive().max(4), height: z.number().int().positive().max(4) }).default({ width: 1, height: 1 }) }).default({ disposition: "neutral", footprint: { width: 1, height: 1 } }), extensions: z.record(z.string(), z.unknown()).default({})
}).superRefine((actor, context) => {
  if (actor.schemaId === "vtt.actor-character" && actor.token.disposition !== "friendly") context.addIssue({ code: z.ZodIssueCode.custom, path: ["token", "disposition"], message: "Player-character definitions must use the friendly disposition." });
});
export type ActorDefinition = z.infer<typeof ActorDefinitionSchema>;
