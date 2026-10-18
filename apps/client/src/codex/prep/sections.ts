import type { CodexPrepSection, CodexPrepSectionInput, CodexPrepSectionType } from "./contract";

/** What each section type is called and holds, in the order Add a section offers them. */
export const SECTION_TYPES: ReadonlyArray<Readonly<{ type: CodexPrepSectionType; label: string; holds: string }>> = [
  { type: "text", label: "Text", holds: "Holds free text, with the prompt shown while you write." },
  { type: "checklist", label: "Checklist", holds: "Holds items to tick. Each can link a page or a hidden block." },
  { type: "pages", label: "Linked pages", holds: "Holds pages you pick, such as the cast or the places." },
  { type: "scenes", label: "Scenes", holds: "Holds an ordered list. Each scene has a title, a place and notes." },
  { type: "clocks", label: "Clocks", holds: "Holds deadlines picked from the calendar." },
  { type: "quests", label: "Quests in play", holds: "Holds the quests you pick." },
  { type: "encounters", label: "Encounters", holds: "Holds table scenes you pick to run." }
];

export function sectionTypeLabel(type: CodexPrepSectionType): string {
  return SECTION_TYPES.find((entry) => entry.type === type)?.label ?? type;
}

/** A new, empty section of a type, added by hand: no template section behind it. */
export function emptySection(type: CodexPrepSectionType, title: string): CodexPrepSectionInput {
  const base = { title, prompt: null, templateSectionId: null } as const;
  switch (type) {
    case "text":
      return { ...base, type, text: "" };
    case "checklist":
      return { ...base, type, items: [] };
    case "pages":
      return { ...base, type, pageIds: [] };
    case "scenes":
      return { ...base, type, scenes: [] };
    case "clocks":
      return { ...base, type, deadlineIds: [] };
    case "quests":
      return { ...base, type, questIds: [] };
    case "encounters":
      return { ...base, type, sceneIds: [] };
  }
}

/** Whether a section holds anything a GM wrote or picked. */
export function sectionHasContent(section: CodexPrepSection): boolean {
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
      return section.sceneIds.length > 0;
  }
}

/** One list with an item moved from one index to another; out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
