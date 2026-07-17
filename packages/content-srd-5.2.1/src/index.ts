/**
 * Typed access to the committed SRD 5.2.1 content bundles. Server-side only by design:
 * clients receive content through server projections/commands, never by importing this package
 * (ADR-0001 server authority; ADR-0007 canonical content format).
 */
import { createRequire } from "node:module";
import { z } from "zod";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";

const require = createRequire(import.meta.url);

export const ConditionReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(4000)
});
export type ConditionReference = z.infer<typeof ConditionReferenceSchema>;

export const ContentAttributionSchema = z.object({
  license: z.literal("CC-BY-4.0"),
  attribution: z.string().min(1),
  source: z.object({
    name: z.string(), author: z.string(), publisher: z.string(), permalink: z.string(),
    vendoredFrom: z.string(), retrieved: z.string()
  })
});
export type ContentAttribution = z.infer<typeof ContentAttributionSchema>;

let monstersCache: readonly ActorDefinition[] | null = null;
let conditionsCache: readonly ConditionReference[] | null = null;
let attributionCache: ContentAttribution | null = null;

/** All SRD 5.2.1 monster definitions, validated on first load and cached. */
export function loadMonsterDefinitions(): readonly ActorDefinition[] {
  monstersCache ??= z.array(ActorDefinitionSchema).parse(require("../bundles/monsters.v1.json"));
  return monstersCache;
}

/** The 15 SRD 5.2.1 conditions as reference text (Blinded, Charmed, ... Unconscious). */
export function loadConditions(): readonly ConditionReference[] {
  conditionsCache ??= z.array(ConditionReferenceSchema).parse(require("../bundles/conditions.v1.json"));
  return conditionsCache;
}

/** CC BY 4.0 attribution that must accompany any surface displaying this content. */
export function loadAttribution(): ContentAttribution {
  attributionCache ??= ContentAttributionSchema.parse(require("../bundles/attribution.json"));
  return attributionCache;
}
