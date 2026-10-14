import { BUILDER_DRAFT_VERSION, type BuilderDraft } from "./build-payload";

/**
 * Draft persistence for the character builder: the in-progress build parks in `localStorage`,
 * keyed per session, so a reload or "Save & close" never loses work on this device. Every caller
 * goes through `loadDraft` / `saveDraft` / `clearDraft`, so the store can move server-side later.
 */

export type StoredDraft = Readonly<{
  id: string;
  /** ISO timestamp of the last write, shown on the resume banner. */
  updatedAt: string;
  draft: BuilderDraft;
}>;

const KEY_PREFIX = "vtt.character-draft.";
const storageKey = (sessionKey: string) => `${KEY_PREFIX}${sessionKey}`;

/** Private-mode / quota-safe: a browser that refuses storage loses resume, not the wizard. */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the draft stays in memory */
  }
}

export function loadDraft(sessionKey: string): StoredDraft | null {
  const raw = readRaw(storageKey(sessionKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    // A draft from an older shape is dropped rather than half-restored, which would produce a payload
    // the server rejects.
    if (!parsed?.draft || parsed.draft.version !== BUILDER_DRAFT_VERSION) return null;
    return { id: parsed.id ?? sessionKey, updatedAt: parsed.updatedAt ?? "", draft: parsed.draft };
  } catch {
    return null;
  }
}

export function saveDraft(sessionKey: string, draft: BuilderDraft): void {
  const record: StoredDraft = { id: sessionKey, updatedAt: new Date().toISOString(), draft };
  writeRaw(storageKey(sessionKey), JSON.stringify(record));
}

export function clearDraft(sessionKey: string): void {
  try {
    localStorage.removeItem(storageKey(sessionKey));
  } catch {
    /* nothing to clear */
  }
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
