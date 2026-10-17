import type { CodexSession } from "@vtt/domain";

/** Free-text prep as the one Text section a write sends for it. */
export function prepNotes(text: string) {
  return [{ type: "text" as const, title: "Prep notes", text }];
}

/** The text of a session's Text sections, blank ones left out, for a test that reads prep back. */
export function prepNotesOf(session: Pick<CodexSession, "prep">): string {
  return session.prep
    .flatMap((section) => (section.type === "text" && section.text !== "" ? [section.text] : []))
    .join("\n");
}
