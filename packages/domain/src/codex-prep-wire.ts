// Session prep's HTTP shapes: the template library and a session's prep sections. Both are GM-only, so there is no
// player twin of anything here. Kept apart from `codex-wire.ts` so the session shape there can import it without a
// cycle. Each field's `.describe()` is its prose in the OpenAPI document.

import { z } from "zod";
import type { Wire } from "./wire.js";

export const CODEX_PREP_SECTION_TYPES = [
  "text",
  "checklist",
  "pages",
  "scenes",
  "clocks",
  "quests",
  "encounters"
] as const;
const CodexPrepSectionTypeSchema = z.enum(CODEX_PREP_SECTION_TYPES);
export type CodexPrepSectionType = z.infer<typeof CodexPrepSectionTypeSchema>;

/** The bounds every prep writer shares: the HTTP schemas, the store's validators and the backup restore. */
export const CODEX_PREP_LIMITS = {
  templates: 50,
  templateName: 80,
  templateSections: 24,
  sessionSections: 32,
  sectionTitle: 80,
  prompt: 280,
  text: 20_000,
  items: 48,
  itemText: 280,
  pages: 48,
  scenes: 24,
  sceneTitle: 120,
  sceneNotes: 4000,
  deadlines: 24,
  quests: 24,
  encounters: 20,
  /** All of one session's prep text together, the bound the free-text prep had. */
  totalText: 100_000
} as const;

const timestamp = () => z.iso.datetime();

// ----- Templates -----

/** A section as a template holds it. Its `id` is stable across edits and duplicates, and a session remembers it. */
export const CodexPrepTemplateSectionSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(CODEX_PREP_LIMITS.sectionTitle),
  prompt: z.string().max(CODEX_PREP_LIMITS.prompt).nullable(),
  type: CodexPrepSectionTypeSchema
});
export type CodexPrepTemplateSection = Wire<z.infer<typeof CodexPrepTemplateSectionSchema>>;

export const CodexPrepTemplateSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(CODEX_PREP_LIMITS.templateName),
    builtIn: z
      .boolean()
      .describe("The starting template ships with the app and is read-only. Duplicate it to edit a copy."),
    isDefault: z.boolean().describe("The template a new session copies when it names none."),
    sections: z.array(CodexPrepTemplateSectionSchema).max(CODEX_PREP_LIMITS.templateSections),
    rev: z.number().int().min(0).describe("The conflict token for `PATCH`; 0 on the built-in."),
    createdAt: timestamp().nullable().describe("Null on the built-in."),
    updatedAt: timestamp().nullable().describe("Null on the built-in.")
  })
  .describe(
    "A reusable plan for session prep: an ordered list of sections, each with a title, a prompt and a type. GM-only."
  );
export type CodexPrepTemplate = Wire<z.infer<typeof CodexPrepTemplateSchema>>;

export const CodexPrepTemplateListSchema = z.strictObject({
  templates: z.array(CodexPrepTemplateSchema),
  defaultTemplateId: z.uuid()
});
export type CodexPrepTemplateList = Wire<z.infer<typeof CodexPrepTemplateListSchema>>;

// ----- A session's prep -----

/** A checklist item's link: a page or quest, or one hidden block inside it. */
export const CodexPrepLinkSchema = z.strictObject({
  recordKind: z.enum(["page", "quest"]),
  recordId: z.uuid(),
  blockId: z.uuid().nullable()
});
export type CodexPrepLink = Wire<z.infer<typeof CodexPrepLinkSchema>>;

export const CodexPrepChecklistItemSchema = z.strictObject({
  id: z.uuid(),
  text: z.string().max(CODEX_PREP_LIMITS.itemText),
  done: z.boolean(),
  doneAt: timestamp().nullable(),
  link: CodexPrepLinkSchema.nullable()
});
export type CodexPrepChecklistItem = Wire<z.infer<typeof CodexPrepChecklistItemSchema>>;

export const CodexPrepSceneSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().max(CODEX_PREP_LIMITS.sceneTitle),
  placePageId: z.uuid().nullable(),
  notes: z.string().max(CODEX_PREP_LIMITS.sceneNotes)
});
export type CodexPrepScene = Wire<z.infer<typeof CodexPrepSceneSchema>>;

const sectionBase = {
  id: z.uuid(),
  templateSectionId: z.uuid().nullable(),
  title: z.string().min(1).max(CODEX_PREP_LIMITS.sectionTitle),
  prompt: z.string().max(CODEX_PREP_LIMITS.prompt).nullable()
};
const ids = (max: number) => z.array(z.uuid()).max(max);

export const CodexPrepSectionSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...sectionBase, type: z.literal("text"), text: z.string().max(CODEX_PREP_LIMITS.text) }),
  z.strictObject({
    ...sectionBase,
    type: z.literal("checklist"),
    items: z.array(CodexPrepChecklistItemSchema).max(CODEX_PREP_LIMITS.items)
  }),
  z.strictObject({ ...sectionBase, type: z.literal("pages"), pageIds: ids(CODEX_PREP_LIMITS.pages) }),
  z.strictObject({
    ...sectionBase,
    type: z.literal("scenes"),
    scenes: z.array(CodexPrepSceneSchema).max(CODEX_PREP_LIMITS.scenes)
  }),
  z.strictObject({ ...sectionBase, type: z.literal("clocks"), deadlineIds: ids(CODEX_PREP_LIMITS.deadlines) }),
  z.strictObject({ ...sectionBase, type: z.literal("quests"), questIds: ids(CODEX_PREP_LIMITS.quests) }),
  z.strictObject({ ...sectionBase, type: z.literal("encounters"), encounterIds: ids(CODEX_PREP_LIMITS.encounters) })
]);
export type CodexPrepSection = Wire<z.infer<typeof CodexPrepSectionSchema>>;
/** One section of each type, by its type. */
export type CodexPrepSectionOf<T extends CodexPrepSectionType> = Extract<CodexPrepSection, { type: T }>;

// ----- Writes -----

/** A checklist item as a write sends it. `doneAt` is the server's: it is accepted, so a read item can be sent back. */
export type CodexPrepChecklistItemInput = Readonly<{
  id?: string;
  text: string;
  done?: boolean;
  doneAt?: string | null;
  link?: CodexPrepLink | null;
}>;
export type CodexPrepSceneInput = Readonly<{ id?: string; title: string; placePageId?: string | null; notes?: string }>;
type CodexPrepSectionInputBase = Readonly<{
  id?: string;
  templateSectionId?: string | null;
  title: string;
  prompt?: string | null;
}>;
/** A section as a write sends it: every nested id optional, so the server mints new ones. A read section is one. */
export type CodexPrepSectionInput =
  | (CodexPrepSectionInputBase & Readonly<{ type: "text"; text?: string }>)
  | (CodexPrepSectionInputBase & Readonly<{ type: "checklist"; items?: readonly CodexPrepChecklistItemInput[] }>)
  | (CodexPrepSectionInputBase & Readonly<{ type: "pages"; pageIds?: readonly string[] }>)
  | (CodexPrepSectionInputBase & Readonly<{ type: "scenes"; scenes?: readonly CodexPrepSceneInput[] }>)
  | (CodexPrepSectionInputBase & Readonly<{ type: "clocks"; deadlineIds?: readonly string[] }>)
  | (CodexPrepSectionInputBase & Readonly<{ type: "quests"; questIds?: readonly string[] }>)
  | (CodexPrepSectionInputBase & Readonly<{ type: "encounters"; encounterIds?: readonly string[] }>);
/** A template section as a write sends it. */
export type CodexPrepTemplateSectionInput = Readonly<{
  id?: string;
  title: string;
  prompt?: string | null;
  type: CodexPrepSectionType;
}>;
