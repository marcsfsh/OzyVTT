import {
  CODEX_PREP_LIMITS,
  CODEX_PREP_SECTION_TYPES,
  CodexPrepSectionSchema,
  type CodexPrepChecklistItem,
  type CodexPrepLink,
  type CodexPrepScene,
  type CodexPrepSection,
  type CodexPrepSectionType,
  type CodexPrepTemplate,
  type CodexPrepTemplateList,
  type CodexPrepTemplateSection
} from "@vtt/domain";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { CodexNotFoundError, CodexRevisionConflictError, CodexValidationError, id, isId } from "./validate.js";

/**
 * Session prep: the GM's library of prep templates (`codex_prep_templates`, the default in
 * `codex_meta.default_prep_template_id`) and the checks a session's prep sections pass. A session copies a template's
 * sections and owns the copy, so editing a template never changes a session. All of it is GM-only.
 */

/** The starting template ships in code, read-only. The GM duplicates it to make their own. */
export const BUILT_IN_TEMPLATE_ID = "00000000-0000-4000-8000-00000000b001";
const BUILT_IN_NAME = "Starting template";
const BUILT_IN_SECTIONS: readonly CodexPrepTemplateSection[] = [
  ["Strong start", "text", "Write the first scene the players walk into. Open with something happening."],
  ["Scenes", "scenes", "List the scenes that could happen, each with its place."],
  [
    "Secrets and clues",
    "checklist",
    "Write facts the players can discover. Link the page or hidden block each one reveals."
  ],
  ["Cast", "pages", "Pick the people the players could meet."],
  ["Places", "pages", "Pick the places the players could visit."],
  ["Clocks", "clocks", "Pick the deadlines that could fire this session."],
  ["Quests in play", "quests", "Pick the quests this session moves forward."],
  ["Rewards", "text", "Write the treasure and favours the players could earn."]
].map(([title, type, prompt], index) => ({
  id: `00000000-0000-4000-8000-00000000b1${String(index + 1).padStart(2, "0")}`,
  title: title!,
  prompt: prompt!,
  type: type as CodexPrepSectionType
}));
/** The title the migration and an older backup give free-text prep. */
const LEGACY_PREP_TITLE = "Prep notes";

const CONTROL_CHARS = /\p{Cc}/u;
/** Line breaks and tabs are fine in prose; other control characters are not. */
const PROSE_CONTROL_CHARS = /[^\P{Cc}\n\r\t]/u;

// ----- Inputs: loose, since a backup restore reads them from an untrusted file -----

export type PrepTemplateSectionInput = Readonly<{
  id?: string;
  title: string;
  prompt?: string | null;
  type: CodexPrepSectionType;
}>;
export type PrepTemplateInput = Readonly<{
  name: string;
  sections?: readonly PrepTemplateSectionInput[];
}>;
export type PrepChecklistItemInput = Readonly<{
  id?: string;
  text: string;
  done?: boolean;
  /** Read only on a restore; every other write stamps it. */
  doneAt?: string | null;
  link?: CodexPrepLink | null;
}>;
export type PrepSceneInput = Readonly<{ id?: string; title: string; placePageId?: string | null; notes?: string }>;
/** A section as a writer sends it: every nested id optional, and only the content key of its type is read. */
export type PrepSectionInput = Readonly<{
  id?: string;
  templateSectionId?: string | null;
  title: string;
  prompt?: string | null;
  type: CodexPrepSectionType;
  text?: string;
  items?: readonly PrepChecklistItemInput[];
  pageIds?: readonly string[];
  scenes?: readonly PrepSceneInput[];
  deadlineIds?: readonly string[];
  questIds?: readonly string[];
  encounterIds?: readonly string[];
}>;

// ----- Field checks -----

function sectionTitle(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > CODEX_PREP_LIMITS.sectionTitle || CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError(`A section title is 1 to ${CODEX_PREP_LIMITS.sectionTitle} printable characters.`);
  return trimmed;
}
function templateName(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > CODEX_PREP_LIMITS.templateName || CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError(`A template name is 1 to ${CODEX_PREP_LIMITS.templateName} printable characters.`);
  return trimmed;
}
function prompt(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > CODEX_PREP_LIMITS.prompt || PROSE_CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError(`A section prompt is up to ${CODEX_PREP_LIMITS.prompt} printable characters.`);
  return trimmed || null;
}
function sectionType(value: unknown): CodexPrepSectionType {
  if (typeof value !== "string" || !(CODEX_PREP_SECTION_TYPES as readonly string[]).includes(value))
    throw new CodexValidationError(
      "A section is Text, Checklist, Linked pages, Scenes, Clocks, Quests in play or Encounters."
    );
  return value as CodexPrepSectionType;
}
/** Prose: kept as written (no trim), bounded, and free of control characters other than line breaks and tabs. */
function prose(value: unknown, max: number, what: string): string {
  const text = typeof value === "string" ? value : "";
  if (text.length > max || PROSE_CONTROL_CHARS.test(text))
    throw new CodexValidationError(`${what} is up to ${max} printable characters.`);
  return text;
}
/** One line: trimmed, bounded and printable. Blank is allowed, so a row can be added before it is typed. */
function line(value: unknown, max: number, what: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > max || CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError(`${what} is up to ${max} printable characters.`);
  return trimmed;
}
/** A list of record ids: validated and deduped; more than `max` is refused. */
function idList(value: readonly string[] | undefined, max: number, what: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CodexValidationError(`${what} must be a list.`);
  const out = [...new Set(value.map((raw) => id(String(raw))))];
  if (out.length > max) throw new CodexValidationError(`${what} holds at most ${max}.`);
  return out;
}
/** A writer's own id when it sent a valid one, else a fresh one. */
function keptId(value: string | undefined): string {
  return value === undefined ? freshId() : id(value);
}
function link(value: CodexPrepLink | null | undefined): CodexPrepLink | null {
  if (value === null || value === undefined) return null;
  if (value.recordKind !== "page" && value.recordKind !== "quest")
    throw new CodexValidationError("A checklist item links a page or a quest.");
  return {
    recordKind: value.recordKind,
    recordId: id(value.recordId),
    blockId: value.blockId === null || value.blockId === undefined ? null : id(value.blockId)
  };
}
function timestampOrNull(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

// ----- Template sections -----

/** A template's sections, in order. Ids are kept when sent and unique; a missing one is minted. */
export function templateSections(value: readonly PrepTemplateSectionInput[] | undefined): CodexPrepTemplateSection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CodexValidationError("A template's sections must be a list.");
  if (value.length > CODEX_PREP_LIMITS.templateSections)
    throw new CodexValidationError(`A template holds at most ${CODEX_PREP_LIMITS.templateSections} sections.`);
  const seen = new Set<string>();
  return value.map((section) => {
    const sectionId = keptId(section.id);
    if (seen.has(sectionId)) throw new CodexValidationError("Two sections share an id. Give each its own.");
    seen.add(sectionId);
    return {
      id: sectionId,
      title: sectionTitle(section.title),
      prompt: prompt(section.prompt),
      type: sectionType(section.type)
    };
  });
}

// ----- A session's prep -----

/** How a prep write treats checklist ticks: compared with the prep it replaces, or (a restore) kept as stored. */
type PrepWriteMode = Readonly<{ now: string; previous?: readonly CodexPrepSection[]; restore?: boolean }>;

/**
 * A session's prep sections, checked and normalised. Section, item and scene ids are kept when sent and must be
 * unique across the prep, since a tick or the current scene names one by id alone. `doneAt` is the server's: it
 * keeps the previous stamp while an item stays done and stamps `now` when an item turns done.
 */
export function prepSections(value: readonly PrepSectionInput[] | undefined, mode: PrepWriteMode): CodexPrepSection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CodexValidationError("A session's prep must be a list of sections.");
  if (value.length > CODEX_PREP_LIMITS.sessionSections)
    throw new CodexValidationError(`A session's prep holds at most ${CODEX_PREP_LIMITS.sessionSections} sections.`);
  const previousItems = new Map(
    (mode.previous ?? [])
      .flatMap((section) => (section.type === "checklist" ? section.items : []))
      .map((item) => [item.id, item])
  );
  const seen = new Set<string>();
  const unique = (value: string | undefined) => {
    const kept = keptId(value);
    if (seen.has(kept)) throw new CodexValidationError("Two parts of this prep share an id. Give each its own.");
    seen.add(kept);
    return kept;
  };
  const sections = value.map((section): CodexPrepSection => {
    const base = {
      id: unique(section.id),
      templateSectionId:
        section.templateSectionId === null || section.templateSectionId === undefined
          ? null
          : id(section.templateSectionId),
      title: sectionTitle(section.title),
      prompt: prompt(section.prompt)
    };
    switch (sectionType(section.type)) {
      case "text":
        return { ...base, type: "text", text: prose(section.text, CODEX_PREP_LIMITS.text, "A Text section") };
      case "checklist": {
        const items = section.items ?? [];
        if (!Array.isArray(items) || items.length > CODEX_PREP_LIMITS.items)
          throw new CodexValidationError(`A checklist holds at most ${CODEX_PREP_LIMITS.items} items.`);
        return {
          ...base,
          type: "checklist",
          items: items.map((item): CodexPrepChecklistItem => {
            const itemId = unique(item.id);
            const done = item.done === true;
            const before = previousItems.get(itemId);
            const doneAt = !done
              ? null
              : mode.restore
                ? (timestampOrNull(item.doneAt) ?? mode.now)
                : before?.done
                  ? before.doneAt
                  : mode.now;
            return {
              id: itemId,
              text: line(item.text, CODEX_PREP_LIMITS.itemText, "A checklist item"),
              done,
              doneAt,
              link: link(item.link)
            };
          })
        };
      }
      case "pages":
        return { ...base, type: "pages", pageIds: idList(section.pageIds, CODEX_PREP_LIMITS.pages, "Linked pages") };
      case "scenes": {
        const scenes = section.scenes ?? [];
        if (!Array.isArray(scenes) || scenes.length > CODEX_PREP_LIMITS.scenes)
          throw new CodexValidationError(`A Scenes section holds at most ${CODEX_PREP_LIMITS.scenes} scenes.`);
        return {
          ...base,
          type: "scenes",
          scenes: scenes.map((scene): CodexPrepScene => ({
            id: unique(scene.id),
            title: line(scene.title, CODEX_PREP_LIMITS.sceneTitle, "A scene title"),
            placePageId: scene.placePageId === null || scene.placePageId === undefined ? null : id(scene.placePageId),
            notes: prose(scene.notes, CODEX_PREP_LIMITS.sceneNotes, "A scene's notes")
          }))
        };
      }
      case "clocks":
        return {
          ...base,
          type: "clocks",
          deadlineIds: idList(section.deadlineIds, CODEX_PREP_LIMITS.deadlines, "A Clocks section")
        };
      case "quests":
        return {
          ...base,
          type: "quests",
          questIds: idList(section.questIds, CODEX_PREP_LIMITS.quests, "Quests in play")
        };
      case "encounters":
        return {
          ...base,
          type: "encounters",
          encounterIds: idList(section.encounterIds, CODEX_PREP_LIMITS.encounters, "An Encounters section")
        };
    }
  });
  if (prepText(sections).length > CODEX_PREP_LIMITS.totalText)
    throw new CodexValidationError(`A session's prep is limited to ${CODEX_PREP_LIMITS.totalText} characters.`);
  return sections;
}

/** Every piece of prose in the prep, one per line: the GM layer of a session's search row and links. */
export function prepText(prep: readonly CodexPrepSection[]): string {
  const parts: string[] = [];
  for (const section of prep) {
    switch (section.type) {
      case "text":
        parts.push(section.text);
        break;
      case "checklist":
        for (const item of section.items) parts.push(item.text);
        break;
      case "scenes":
        for (const scene of section.scenes) parts.push(scene.title, scene.notes);
        break;
      case "pages":
      case "clocks":
      case "quests":
      case "encounters":
        break;
    }
  }
  return parts.filter((part) => part.trim() !== "").join("\n");
}

/** Whether a section holds anything a GM wrote or picked. */
function hasContent(section: CodexPrepSection): boolean {
  switch (section.type) {
    case "text":
      return section.text.trim() !== "";
    case "checklist":
      return section.items.length > 0;
    case "pages":
      return section.pageIds.length > 0;
    case "scenes":
      return section.scenes.length > 0;
    case "clocks":
      return section.deadlineIds.length > 0;
    case "quests":
      return section.questIds.length > 0;
    case "encounters":
      return section.encounterIds.length > 0;
  }
}

/** An empty section of a template section's type, linked back to it. */
function emptySection(templateSection: CodexPrepTemplateSection, sectionId: string): CodexPrepSection {
  const base = {
    id: sectionId,
    templateSectionId: templateSection.id,
    title: templateSection.title,
    prompt: templateSection.prompt
  };
  switch (templateSection.type) {
    case "text":
      return { ...base, type: "text", text: "" };
    case "checklist":
      return { ...base, type: "checklist", items: [] };
    case "pages":
      return { ...base, type: "pages", pageIds: [] };
    case "scenes":
      return { ...base, type: "scenes", scenes: [] };
    case "clocks":
      return { ...base, type: "clocks", deadlineIds: [] };
    case "quests":
      return { ...base, type: "quests", questIds: [] };
    case "encounters":
      return { ...base, type: "encounters", encounterIds: [] };
  }
}

/** A new session's prep: one empty section per template section, each with a fresh id. */
export function prepFromTemplate(template: CodexPrepTemplate): CodexPrepSection[] {
  return template.sections.map((section) => emptySection(section, freshId()));
}

/**
 * Re-applies a template and keeps what was written. Each template section takes the content and id of an existing
 * section that still matches it: the same template section and type first, else the same title (case-insensitive)
 * and type. The template's title and prompt win. A section that matches nothing is kept after the template's when
 * it holds anything, so nothing written is lost.
 */
export function reapplyTemplate(prep: readonly CodexPrepSection[], template: CodexPrepTemplate): CodexPrepSection[] {
  const unmatched = [...prep];
  const take = (found: (section: CodexPrepSection) => boolean) => {
    const index = unmatched.findIndex(found);
    return index === -1 ? null : unmatched.splice(index, 1)[0]!;
  };
  const fold = (title: string) => title.trim().toLowerCase();
  const next = template.sections.map((templateSection) => {
    const kept =
      take((section) => section.templateSectionId === templateSection.id && section.type === templateSection.type) ??
      take((section) => fold(section.title) === fold(templateSection.title) && section.type === templateSection.type);
    if (!kept) return emptySection(templateSection, freshId());
    return {
      ...kept,
      templateSectionId: templateSection.id,
      title: templateSection.title,
      prompt: templateSection.prompt
    };
  });
  return [...next, ...unmatched.filter(hasContent)];
}

/** Free-text prep from before sections, as one Text section. Blank prep becomes none. */
export function legacyPrep(body: string): CodexPrepSection[] {
  if (!body.trim()) return [];
  return [{ id: freshId(), templateSectionId: null, title: LEGACY_PREP_TITLE, prompt: null, type: "text", text: body }];
}

/** Stored prep, read defensively: a section that no longer parses is dropped, so a bad row can't lock a session. */
export function parseStoredPrep(raw: string | null | undefined): CodexPrepSection[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((section) => {
    const result = CodexPrepSectionSchema.safeParse(section);
    return result.success ? [result.data] : [];
  });
}

/** Every checklist item and scene of a prep, with the section it sits in. */
export function prepItems(prep: readonly CodexPrepSection[]) {
  return prep.flatMap((section) =>
    section.type === "checklist" ? section.items.map((item) => ({ section, item })) : []
  );
}
export function prepScenes(prep: readonly CodexPrepSection[]) {
  return prep.flatMap((section) =>
    section.type === "scenes" ? section.scenes.map((scene) => ({ section, scene })) : []
  );
}

// ----- The template library -----

type TemplateRowRaw = {
  id: string;
  name: string;
  sections_json: string;
  rev: number;
  created_at: string;
  updated_at: string;
};
const TEMPLATE_COLUMNS = "id, name, sections_json, rev, created_at, updated_at";

/** A stored template as the GM wrote it; its default flag comes from `codex_meta`. */
export type StoredPrepTemplate = Readonly<{
  id: string;
  name: string;
  sections: readonly CodexPrepTemplateSection[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

function parseTemplateSections(raw: string): CodexPrepTemplateSection[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? templateSections(parsed as PrepTemplateSectionInput[]) : [];
  } catch {
    return [];
  }
}
function toStored(row: TemplateRowRaw): StoredPrepTemplate {
  return {
    id: row.id,
    name: row.name,
    sections: parseTemplateSections(row.sections_json),
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function storedRow(db: CodexDb, templateId: string): TemplateRowRaw | undefined {
  if (!isId(templateId)) return undefined;
  return db.database.prepare(`SELECT ${TEMPLATE_COLUMNS} FROM codex_prep_templates WHERE id = ?`).get(templateId) as
    TemplateRowRaw | undefined;
}

/** The GM's templates, by name and then creation. The backup exports these. */
export function listStoredTemplates(db: CodexDb): StoredPrepTemplate[] {
  return (
    db.database
      .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM codex_prep_templates ORDER BY name COLLATE NOCASE, created_at, id`)
      .all() as TemplateRowRaw[]
  ).map(toStored);
}

/** The stored default when it still exists, else the built-in. */
export function defaultTemplateId(db: CodexDb): string {
  const row = db.database.prepare("SELECT default_prep_template_id AS id FROM codex_meta WHERE id = 1").get() as {
    id: string | null;
  };
  return row.id !== null && storedRow(db, row.id) ? row.id : BUILT_IN_TEMPLATE_ID;
}
/** The stored pointer as it is, for the backup. */
export function storedDefaultTemplateId(db: CodexDb): string | null {
  const row = db.database.prepare("SELECT default_prep_template_id AS id FROM codex_meta WHERE id = 1").get() as {
    id: string | null;
  };
  return row.id;
}

function builtIn(isDefault: boolean): CodexPrepTemplate {
  return {
    id: BUILT_IN_TEMPLATE_ID,
    name: BUILT_IN_NAME,
    builtIn: true,
    isDefault,
    sections: BUILT_IN_SECTIONS,
    rev: 0,
    createdAt: null,
    updatedAt: null
  };
}
function fromStored(stored: StoredPrepTemplate, isDefault: boolean): CodexPrepTemplate {
  return { ...stored, builtIn: false, isDefault, sections: [...stored.sections] };
}

export function listTemplates(db: CodexDb): CodexPrepTemplateList {
  const defaultId = defaultTemplateId(db);
  return {
    templates: [
      builtIn(defaultId === BUILT_IN_TEMPLATE_ID),
      ...listStoredTemplates(db).map((stored) => fromStored(stored, stored.id === defaultId))
    ],
    defaultTemplateId: defaultId
  };
}

/** One template, the built-in included; null when there is none with that id. */
export function getTemplate(db: CodexDb, templateId: string): CodexPrepTemplate | null {
  const defaultId = defaultTemplateId(db);
  if (templateId === BUILT_IN_TEMPLATE_ID) return builtIn(defaultId === BUILT_IN_TEMPLATE_ID);
  const row = storedRow(db, templateId);
  return row ? fromStored(toStored(row), row.id === defaultId) : null;
}

/** A template that must exist; not-found otherwise. */
export function requireTemplate(db: CodexDb, templateId: string): CodexPrepTemplate {
  const template = getTemplate(db, id(templateId));
  if (!template) throw new CodexNotFoundError("That template no longer exists.");
  return template;
}

const BUILT_IN_REFUSAL = "The starting template can't be changed. Duplicate it to make your own.";

/** Leaf write of a whole, already-checked template (create, duplicate and restore). */
export function insertTemplate(db: CodexDb, template: StoredPrepTemplate): void {
  db.database
    .prepare(`INSERT INTO codex_prep_templates (${TEMPLATE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      template.id,
      template.name,
      JSON.stringify(template.sections),
      template.rev,
      template.createdAt,
      template.updatedAt
    );
}

function guardTemplateCount(db: CodexDb): void {
  const { n } = db.database.prepare("SELECT COUNT(*) AS n FROM codex_prep_templates").get() as { n: number };
  if (n >= CODEX_PREP_LIMITS.templates)
    throw new CodexValidationError(
      `The library holds at most ${CODEX_PREP_LIMITS.templates} templates. Delete one to make room.`
    );
}

export function createTemplate(db: CodexDb, input: PrepTemplateInput): CodexPrepTemplate {
  const now = stamp(db);
  const template: StoredPrepTemplate = {
    id: freshId(),
    name: templateName(input.name),
    sections: templateSections(input.sections),
    rev: 1,
    createdAt: now,
    updatedAt: now
  };
  guardTemplateCount(db);
  write(db, () => insertTemplate(db, template));
  return getTemplate(db, template.id)!;
}

/** Rename it, or send its sections whole to add, remove, edit or reorder them. */
export function updateTemplate(
  db: CodexDb,
  templateId: string,
  input: Readonly<{ name?: string; sections?: readonly PrepTemplateSectionInput[] }>,
  expectedRev: number | undefined
): CodexPrepTemplate {
  if (templateId === BUILT_IN_TEMPLATE_ID) throw new CodexValidationError(BUILT_IN_REFUSAL);
  const row = storedRow(db, templateId);
  if (!row) throw new CodexNotFoundError("That template no longer exists.");
  const existing = toStored(row);
  if (expectedRev !== undefined && expectedRev !== existing.rev)
    throw new CodexRevisionConflictError("This template was changed somewhere else after you opened it.");
  const name = input.name === undefined ? existing.name : templateName(input.name);
  const sections = input.sections === undefined ? existing.sections : templateSections(input.sections);
  write(db, () => {
    db.database
      .prepare("UPDATE codex_prep_templates SET name = ?, sections_json = ?, rev = ?, updated_at = ? WHERE id = ?")
      .run(name, JSON.stringify(sections), existing.rev + 1, stamp(db), templateId);
  });
  return getTemplate(db, templateId)!;
}

/** Sessions made from it keep their prep. Deleting the default makes the built-in the default. */
export function deleteTemplate(db: CodexDb, templateId: string): void {
  if (templateId === BUILT_IN_TEMPLATE_ID) throw new CodexValidationError(BUILT_IN_REFUSAL);
  if (!storedRow(db, templateId)) return;
  write(db, () => {
    db.database.prepare("DELETE FROM codex_prep_templates WHERE id = ?").run(templateId);
    db.database
      .prepare("UPDATE codex_meta SET default_prep_template_id = NULL WHERE default_prep_template_id = ?")
      .run(templateId);
  });
}

/** A copy the GM owns. Section ids are kept, so a session made from the original re-applies the copy cleanly. */
export function duplicateTemplate(db: CodexDb, templateId: string, name: string | undefined): CodexPrepTemplate {
  const source = requireTemplate(db, templateId);
  const now = stamp(db);
  const copy: StoredPrepTemplate = {
    id: freshId(),
    name:
      name === undefined
        ? templateName(`${source.name} copy`.slice(0, CODEX_PREP_LIMITS.templateName))
        : templateName(name),
    sections: source.sections,
    rev: 1,
    createdAt: now,
    updatedAt: now
  };
  guardTemplateCount(db);
  write(db, () => insertTemplate(db, copy));
  return getTemplate(db, copy.id)!;
}

/** The built-in is stored as no choice at all, so it stays the fallback. */
export function setDefaultTemplate(db: CodexDb, templateId: string): string {
  const template = requireTemplate(db, templateId);
  write(db, () => writeDefaultTemplate(db, template.builtIn ? null : template.id));
  return template.id;
}

/** Leaf write of the default pointer alone. */
export function writeDefaultTemplate(db: CodexDb, templateId: string | null): void {
  db.database.prepare("UPDATE codex_meta SET default_prep_template_id = ? WHERE id = 1").run(templateId);
}
