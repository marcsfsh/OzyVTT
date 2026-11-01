import { useCallback, type ReactNode } from "react";
import type { CodexPageRevision } from "@vtt/domain";
import { Button, cx } from "@vtt/ui";
import { codexApi } from "../api";
import { useCodexQuery } from "../useCodexQuery";
import { whatChanged, type PageShape } from "./versions";

/** When a version was saved, as version history reads it (T rule 20): "Oct 25, 9:40 PM". */
export const versionWhen = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A page's saved versions, newest first, and the line on how often they are saved, read each time they open. */
export function useVersions(gmToken: string, pageId: string, open: boolean) {
  const listed = useCodexQuery(
    useCallback(
      () => (open ? codexApi.listRevisions(gmToken, pageId) : Promise.resolve([] as CodexPageRevision[])),
      [gmToken, pageId, open]
    ),
    { live: false }
  );
  const read = useCodexQuery(
    useCallback(() => (open ? codexApi.getSettings(gmToken) : Promise.resolve(null)), [gmToken, open]),
    { live: false }
  );
  const settings = read.error ? null : (read.data ?? null);
  // The line names the history setting; a failed read leaves it out.
  const line = !settings
    ? null
    : !settings.revisionHistory.enabled
      ? "Version history is off, so nothing new is being saved. These can still be restored. Change it in Settings."
      : settings.revisionHistory.windowMinutes > 0
        ? `One version is saved per ${settings.revisionHistory.windowMinutes} minutes, so the newest below can be that far behind the page. Change it in Settings.`
        : "Every save is kept as a version. Change it in Settings.";
  return {
    revisions: listed.error ? [] : (listed.data ?? []),
    loading: listed.loading,
    line,
    reload: listed.reload
  };
}

/** What a version changed on its way to the next newer one, the newest against the page now. */
export function versionLines(revisions: readonly CodexPageRevision[], now: PageShape): readonly string[] {
  return revisions.map((revision, index) => whatChanged(revision, revisions[index - 1] ?? now));
}

/**
 * Versions in the page's side column (F finding spec 2.5): Now, then each version as one line (its number, when, and
 * what changed after it), the chosen one lit, and the line on how often versions are saved. On a phone the chosen
 * version opens under its row with `opened`.
 */
export function VersionsColumn({
  revisions,
  lines,
  nowAt,
  line,
  chosen,
  onChoose,
  opened
}: Readonly<{
  revisions: readonly CodexPageRevision[];
  lines: readonly string[];
  nowAt: string | null;
  line: string | null;
  chosen: number | null;
  onChoose: (revisionId: number | null) => void;
  /** A phone's chosen version, opened under its row. */
  opened?: ReactNode;
}>) {
  return (
    <div className="cx-versions">
      <ul className="cx-versions-rows" aria-label="Versions">
        <li>
          <button
            type="button"
            className={cx("cx-version interactive", chosen === null && "is-on")}
            aria-current={chosen === null ? "true" : undefined}
            onClick={() => onChoose(null)}
          >
            <span className="cx-version-n">Now</span>
            <span className="cx-version-when">{nowAt ? versionWhen(nowAt) : ""}</span>
            <span className="cx-version-what">The page as it is</span>
          </button>
        </li>
        {revisions.map((revision, index) => (
          <li key={revision.id}>
            <button
              type="button"
              className={cx("cx-version interactive", chosen === revision.id && "is-on")}
              aria-current={chosen === revision.id ? "true" : undefined}
              onClick={() => onChoose(revision.id)}
            >
              <span className="cx-version-n">v{revision.rev}</span>
              <span className="cx-version-when">{versionWhen(revision.authoredAt)}</span>
              <span className="cx-version-what">{lines[index]}</span>
            </button>
            {chosen === revision.id && opened}
          </li>
        ))}
      </ul>
      {revisions.length === 0 && <p className="cx-hint">No earlier versions.</p>}
      {line && <p className="cx-hint">{line}</p>}
    </div>
  );
}

/** The one notice over a version being read (T rule 21): which version, what changed, and the two ways out. */
export function VersionBand({
  revision,
  what,
  onRestore,
  onBack
}: Readonly<{ revision: CodexPageRevision; what: string; onRestore: () => void; onBack?: () => void }>) {
  return (
    <div className="cx-version-band" role="status">
      <span className="cx-version-band-text">
        {`Reading v${revision.rev} from ${versionWhen(revision.authoredAt)} · ${what}`}
      </span>
      <span className="cx-version-band-actions">
        <Button size="sm" variant="primary" onClick={onRestore}>
          Restore this version
        </Button>
        {onBack && (
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to now
          </Button>
        )}
      </span>
    </div>
  );
}
