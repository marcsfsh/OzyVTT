import { command, read } from "../lib/command";
import { BUILDER_DRAFT_VERSION, type BuilderDraft } from "./build-payload";

/**
 * The character builder's parked draft, kept on the server: one per player session and one for the GM, which
 * follows the GM to any device. A reload, another tab or "Save & close" picks the build up where it was left.
 */

export type StoredDraft = Readonly<{
  /** ISO timestamp of the last save, shown on the resume banner. */
  updatedAt: string;
  draft: BuilderDraft;
}>;

/** The caller's parked draft, or null. One from another draft format is dropped rather than half-restored, which
 *  would produce a payload the server rejects; so is one the table could not be asked for. */
export async function loadDraft(): Promise<StoredDraft | null> {
  const reply = await read("character:draft", {});
  const stored = reply.ok ? (reply.draft ?? null) : null;
  return stored && stored.draft.version === BUILDER_DRAFT_VERSION ? stored : null;
}

/** Parks the draft, replacing the one parked before. */
export function saveDraft(draft: BuilderDraft): void {
  void command("character:save-draft", { draft });
}

export function discardDraft(): void {
  void command("character:discard-draft", {});
}

/** "3 minutes ago" / "yesterday" for the resume banner. */
export function describeWhen(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "earlier";
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** True when the draft holds anything worth offering to resume. */
export function draftHasProgress(draft: BuilderDraft): boolean {
  return Boolean(draft.speciesId || draft.backgroundId || draft.classId || draft.name.trim());
}
