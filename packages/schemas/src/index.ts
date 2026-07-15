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
