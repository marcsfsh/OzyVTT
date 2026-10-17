import { z } from "zod";
import { AbilityIdSchema, BuilderAbilityMethodSchema } from "./state.js";
import type { Wire } from "./wire.js";

const DraftSlug = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);
const DraftOfferKey = z.string().min(1).max(200);
const DraftIncrease = z.object({ ability: AbilityIdSchema, amount: z.number().int().min(1).max(3) }).strict();
const atMostKeys = (limit: number) => (record: Readonly<Record<string, unknown>>) =>
  Object.keys(record).length <= limit;

/**
 * The character builder's in-progress build, exactly as the wizard keeps it: what it chose so far, before any sheet exists. The
 * server parks it for its owner and hands it back; `character.create` validates the build itself when it is made.
 */
export const CharacterDraftSchema = z
  .object({
    /** The wizard's draft format; a draft from another format is dropped whole, so nothing is half-restored. */
    version: z.number().int().min(1).max(100),
    speciesId: DraftSlug.nullable(),
    backgroundId: DraftSlug.nullable(),
    classId: DraftSlug.nullable(),
    level: z.number().int().min(1).max(20),
    /** A multiclass build: the class each level went to, in order (index 0 is level 1, `classId`). Absent for one
     *  class. */
    classLevels: z.array(DraftSlug).min(1).max(20).optional(),
    subclassId: DraftSlug.nullable(),
    abilityMethod: BuilderAbilityMethodSchema,
    abilityPool: z
      .array(z.object({ id: z.string().min(1).max(40), value: z.number().int().min(1).max(30) }).strict())
      .max(12),
    poolAssignment: z.partialRecord(AbilityIdSchema, z.string().max(40).nullable()),
    spendScores: z.partialRecord(AbilityIdSchema, z.number().int().min(1).max(30)),
    backgroundBonus: z.array(DraftIncrease).max(6),
    /** "roll" leaves the throws to the server when the character is made. */
    hpMode: z.enum(["average", "entries", "roll"]),
    hpEntries: z.array(z.number().int().min(1).max(20)).max(19),
    /** The server ability roll the pool came from (`builder.roll-abilities`). */
    abilityRollId: z.uuid().optional(),
    /** Offer key to the option ids chosen for it. */
    picks: z.record(DraftOfferKey, z.array(z.string().min(1).max(120)).max(40)).refine(atMostKeys(300), {
      message: "Too many answered offers."
    }),
    /** Offer key to the +2 split an Ability Score Improvement took. */
    asiIncreases: z.record(DraftOfferKey, z.array(DraftIncrease).max(6)).refine(atMostKeys(40), {
      message: "Too many ability score improvements."
    }),
    name: z.string().max(120)
  })
  .strict();
export type CharacterDraft = Wire<z.infer<typeof CharacterDraftSchema>>;
