import type { CodexPrepSection, CodexPrepSectionInput } from "@vtt/domain";

/** The title the server gives free-text prep. */
const PREP_NOTES_TITLE = "Prep notes";

/** The text of the prep's first Text section: what the session editor's one prep box edits. */
export function prepNotes(prep: readonly CodexPrepSection[]): string {
  return prep.find((section) => section.type === "text")?.text ?? "";
}

/** The prep with its first Text section's text replaced, or a "Prep notes" section added when it has none. */
export function withPrepNotes(prep: readonly CodexPrepSection[], text: string): CodexPrepSectionInput[] {
  const first = prep.findIndex((section) => section.type === "text");
  if (first === -1) return text.trim() ? [...prep, { type: "text", title: PREP_NOTES_TITLE, text }] : [...prep];
  return prep.map((section, index) => (index === first && section.type === "text" ? { ...section, text } : section));
}

/** Every Text section's text, for a read-only view of the prep. */
export function prepText(prep: readonly CodexPrepSection[]): string {
  return prep.flatMap((section) => (section.type === "text" && section.text.trim() ? [section.text] : [])).join("\n\n");
}
