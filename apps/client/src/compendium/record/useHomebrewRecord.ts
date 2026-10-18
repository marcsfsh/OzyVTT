import { useCallback, useMemo, useRef, useState } from "react";
import type { SaveStatus } from "@vtt/ui";
import { useConfirm } from "../../components/feedback";
import { ApiError } from "../../lib/api";
import {
  conflictOf,
  homebrewApi,
  invalidIssuesOf,
  type HomebrewConflict,
  type HomebrewDependent,
  type HomebrewRecordDocument,
  type HomebrewRecordSummary,
  type RecordAudience
} from "../../homebrew/api";
import { trackClosingSave } from "../../homebrew/closingSaves";
import { forStorage, withDefaults } from "../../homebrew/defaults";
import type { Draft } from "../../homebrew/schema";
import { useAutosave } from "../../homebrew/useAutosave";
import { useSchemaContext } from "../../homebrew/useSchemaContext";
import { duplicateNameNote, issueReason, publishIssues, type BlockedReason } from "../../homebrew/validate";
import { typeLabel } from "../../homebrew/types";

/** "Hemomancy", "Hemomancy and Bloodline" or "Hemomancy, Bloodline and 2 more", quoted. */
export function dependentNames(dependents: readonly HomebrewDependent[]): string {
  const quoted = dependents.map((dependent) => `"${dependent.name}"`);
  if (quoted.length === 1) return quoted[0]!;
  if (quoted.length <= 3) return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
  return `${quoted.slice(0, 2).join(", ")} and ${quoted.length - 2} more`;
}

const nameOf = (record: Draft): string => (typeof record.name === "string" ? record.name : "");

/** A save that met a newer copy: what the other device changed, and the server's copy to merge into. */
export type Conflict = Readonly<{ details: HomebrewConflict | null; server: HomebrewRecordDocument }>;

/**
 * One homebrew record being worked on: its draft, the autosave, the publish checklist and every state change, held
 * once so Card, Edit, Sharing and History are views of the same draft and moving between them loses nothing. A save
 * that meets a newer copy keeps the other device's changes beside this one's for the GM to merge.
 */
export function useHomebrewRecord({
  token,
  initial,
  records
}: Readonly<{ token: string; initial: HomebrewRecordDocument; records: readonly HomebrewRecordSummary[] }>) {
  const { confirm, dialog } = useConfirm();
  const [doc, setDoc] = useState(initial);
  // Missing keys are filled from `defaults.ts`, so older, duplicated and imported records arrive complete.
  const [draft, setDraft] = useState<Draft>(() => withDefaults(initial.type, initial.record));
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const { ctx, spells } = useSchemaContext(initial.id, initial.type, records, doc.references);

  // `docRef` shadows `doc` because publish and Who sees it read the revision right after `await flush()`, before
  // React renders again.
  const docRef = useRef(doc);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const pendingConflict = useRef<HomebrewConflict | null>(null);

  const adopt = useCallback((next: HomebrewRecordDocument) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  const autosave = useAutosave<Draft>({
    draft,
    rev: initial.rev,
    // What the server holds, so filled-in defaults count as unsaved and reach the store.
    baseline: initial.record,
    save: async (body, expectedRev) => {
      try {
        // `forStorage` drops editor-only row ids; the `.strict()` rider unions would reject them.
        const next = await homebrewApi.update(token, docRef.current.id, forStorage(body), expectedRev);
        adopt(next);
        return next.rev;
      } catch (error) {
        if (error instanceof ApiError && error.isConflict) pendingConflict.current = conflictOf(error);
        throw error;
      }
    },
    resync: async () => {
      const server = await homebrewApi.get(token, docRef.current.id);
      setConflict({ details: pendingConflict.current, server });
      return server.rev;
    },
    isConflict: (error) => error instanceof ApiError && error.isConflict,
    onUnmountFlush: (pending) => trackClosingSave(initial.id, pending)
  });

  /** Puts a merge in place: the server's copy with the fields the GM kept from this device, saved over it. */
  const resolve = (merged: Draft) => {
    if (!conflict) return;
    adopt(conflict.server);
    autosave.markSaved(conflict.server.rev, withDefaults(conflict.server.type, conflict.server.record));
    setDraft(merged);
    setConflict(null);
    setActionError(null);
  };

  /** Everything outstanding before publish. `publishIssues` runs the record's own schema, so the list is no looser
      than the store. */
  const issues = useMemo(() => publishIssues(doc.type, draft, ctx, doc.id), [doc.type, doc.id, draft, ctx]);
  /** The server's issues for what the shared schema cannot check: identity and references. Shown only once the
      local list is empty, because until then the stored verdict describes an older body. */
  const serverIssues = useMemo(
    () =>
      issues.length > 0 || doc.validity.valid
        ? []
        : doc.validity.issues.map((issue) => issueReason(doc.type, issue)).filter((reason) => reason !== null),
    [issues.length, doc.type, doc.validity]
  );
  const checklist: readonly BlockedReason[] = issues.length > 0 ? issues : serverIssues;

  /** Every state change bumps the revision on the server, so each re-baselines the autosave. */
  const runStateChange = async (action: () => Promise<HomebrewRecordDocument>) => {
    setBusy(true);
    setActionError(null);
    try {
      // Flush first, so a reveal never briefly shares the body from before the last edit.
      await autosave.flush();
      const next = await action();
      adopt(next);
      autosave.markSaved(next.rev, draftRef.current);
      return true;
    } catch (error) {
      if (error instanceof ApiError) setActionError(invalidIssuesOf(error)[0]?.message ?? error.message);
      else setActionError(error instanceof Error ? error.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** The published records an action would break, asked of the server first. A failed read never blocks the action. */
  const dependentsFor = async (which: "ifRemoved" | "ifUpdated"): Promise<readonly HomebrewDependent[]> => {
    try {
      await autosave.flush();
      return (await homebrewApi.usages(token, docRef.current.id)).dependents[which];
    } catch {
      return [];
    }
  };

  const publish = async () => {
    if (docRef.current.state === "published" && docRef.current.pendingChanges) {
      const breaks = await dependentsFor("ifUpdated");
      if (
        breaks.length > 0 &&
        !(await confirm({
          title: "Put these changes live?",
          body: `${dependentNames(breaks)} ${breaks.length === 1 ? "depends" : "depend"} on this as it is now and would stop working.`,
          confirmLabel: "Update anyway",
          danger: true
        }))
      )
        return false;
    }
    return runStateChange(() => homebrewApi.publish(token, docRef.current.id, docRef.current.rev));
  };

  const discard = async () => {
    const confirmed = await confirm({
      title: "Discard these changes?",
      body: "The published version stays as it is, and the editor goes back to it.",
      confirmLabel: "Discard",
      danger: true
    });
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    try {
      // Flushed first, so a save still in flight cannot land after the discard and bring the changes back.
      await autosave.flush();
      const next = await homebrewApi.discard(token, docRef.current.id, docRef.current.rev);
      adopt(next);
      const filled = withDefaults(next.type, next.record);
      setDraft(filled);
      autosave.markSaved(next.rev, filled);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't discard those changes.");
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    const breaks = await dependentsFor("ifRemoved");
    if (
      breaks.length > 0 &&
      !(await confirm({
        title: "Unpublish this?",
        body: `${dependentNames(breaks)} ${breaks.length === 1 ? "depends" : "depend"} on it and would stop working until it is published again.`,
        confirmLabel: "Unpublish anyway",
        danger: true
      }))
    )
      return;
    await runStateChange(() => homebrewApi.unpublish(token, docRef.current.id, docRef.current.rev));
  };

  const setAudience = (audience: RecordAudience) =>
    void runStateChange(() => homebrewApi.setAudience(token, docRef.current.id, audience, docRef.current.rev));

  const restore = () => runStateChange(() => homebrewApi.restore(token, docRef.current.id));

  /** Archive asks first, and names the published records it would break. Restore brings it back. */
  const archive = async () => {
    const name = nameOf(draftRef.current).trim() || `this ${typeLabel(docRef.current.type)}`;
    const breaks = await dependentsFor("ifRemoved");
    const breaksLine =
      breaks.length > 0
        ? ` ${dependentNames(breaks)} ${breaks.length === 1 ? "depends" : "depend"} on it and would stop working.`
        : "";
    const confirmed = await confirm({
      title: "Archive this?",
      body: `"${name}" stops appearing in the character builder, the monster pickers and inventory lists. Characters already built from it are unaffected. You can restore it later.${breaksLine}`,
      confirmLabel: "Archive",
      // A plain archive is a reversible caution; it is a danger only when it breaks a published record.
      danger: breaks.length > 0
    });
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    try {
      await autosave.flush();
      await homebrewApi.remove(token, docRef.current.id);
      const next = await homebrewApi.get(token, docRef.current.id);
      adopt(next);
      autosave.markSaved(next.rev, draftRef.current);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't archive that record.");
    } finally {
      setBusy(false);
    }
  };

  /** Puts an old version back as the editor's copy: changes not live for a published record, until Update. */
  const restoreVersion = async (revisionId: number) => {
    setBusy(true);
    setActionError(null);
    try {
      await autosave.flush();
      const next = await homebrewApi.restoreRevision(token, docRef.current.id, revisionId, docRef.current.rev);
      adopt(next);
      const filled = withDefaults(next.type, next.record);
      setDraft(filled);
      autosave.markSaved(next.rev, filled);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't restore that version.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const status: SaveStatus = autosave.status;
  const archived = !!doc.deletedAt;
  const published = doc.state === "published";
  return {
    doc,
    draft,
    setDraft,
    ctx,
    spells,
    checklist,
    nameNote: duplicateNameNote(doc.type, nameOf(draft), ctx),
    status,
    retry: autosave.retry,
    savedDraft: autosave.savedDraft,
    conflict,
    resolve,
    actionError,
    busy,
    archived,
    published,
    /** A published record's edits wait for Update, so players never lose it mid-edit. */
    pending: published && doc.pendingChanges,
    publish,
    discard,
    unpublish,
    setAudience,
    restore,
    archive,
    restoreVersion,
    dialog
  };
}

export type HomebrewRecordState = ReturnType<typeof useHomebrewRecord>;
