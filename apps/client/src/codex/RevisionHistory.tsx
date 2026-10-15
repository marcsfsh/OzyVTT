import { useCallback } from "react";
import { Button, Modal } from "@vtt/ui";
import { codexApi } from "./api";
import { useCodexQuery } from "./useCodexQuery";

/** A page's saved versions, newest first, each restorable. Read each time it opens. */
export function RevisionHistory({
  gmToken,
  pageId,
  onRestore,
  onClose
}: Readonly<{
  gmToken: string;
  pageId: string;
  onRestore: (revisionId: number) => void;
  onClose: () => void;
}>) {
  const listed = useCodexQuery(
    useCallback(() => codexApi.listRevisions(gmToken, pageId), [gmToken, pageId]),
    { live: false }
  );
  const revisions = listed.error ? [] : (listed.data ?? []);
  // The hint names the history setting; a failed read leaves it out.
  const read = useCodexQuery(
    useCallback(() => codexApi.getSettings(gmToken), [gmToken]),
    { live: false }
  );
  const settings = read.error ? null : (read.data ?? null);
  return (
    <Modal open onClose={onClose} title="Version history" size="md" ariaLabel="Version history">
      {settings && (
        <p className="codex-composer-hint">
          {!settings.revisionHistory.enabled
            ? "Version history is off, so nothing new is being saved. These can still be restored. Change it in Settings."
            : settings.revisionHistory.windowMinutes > 0
              ? `One version is saved per ${settings.revisionHistory.windowMinutes} minutes, so the newest below can be that far behind the page. Change it in Settings.`
              : "Every save is kept as a version. Change it in Settings."}
        </p>
      )}
      {revisions.length === 0 ? (
        <p className="codex-preview-empty">No earlier versions.</p>
      ) : (
        <ul className="codex-revisions">
          {revisions.map((revision) => (
            <li key={revision.id} className="codex-revision">
              <div>
                <strong>v{revision.rev}</strong> ·{" "}
                <span className="codex-revision-when">{new Date(revision.authoredAt).toLocaleString()}</span>
              </div>
              <div className="codex-revision-title">{revision.title}</div>
              <Button variant="secondary" size="sm" onClick={() => onRestore(revision.id)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
