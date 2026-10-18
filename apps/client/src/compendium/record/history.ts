import type { HomebrewRevisionSummary } from "../../homebrew/api";
import type { Kind } from "../kinds";
import { fieldWord } from "./words";

/**
 * A record's history as its table reads it: each publish is a version the players got, numbered from the first, and
 * the edits between two versions fold into one row with every field they changed. A change of who sees it, an archive
 * or a pack switch keeps a row of its own, since it moved no body.
 */
export type HistoryRow = Readonly<{
  key: string;
  /** The history row whose body this row holds, for Compare and Restore; null when it holds no body of its own. */
  revisionId: number | null;
  label: string;
  /** A version players got; null for the edits between. */
  version: number | null;
  at: string;
  device: HomebrewRevisionSummary["device"];
  /** Several devices wrote the edits this row folds together. */
  devices: number;
  changed: readonly string[];
  /** The edits after the last publish of a published record: what Update would put live. */
  notLive: boolean;
  edits: number;
}>;

const BODY_EVENTS = new Set<HomebrewRevisionSummary["event"]>([
  "create",
  "edit",
  "import",
  "duplicate",
  "revert",
  "discard",
  "publish"
]);

const AUDIENCE_WORD: Readonly<Record<HomebrewRevisionSummary["audience"], string>> = {
  hidden: "Hidden",
  everyone: "Everyone",
  characters: "Chosen characters"
};

/** The rows newest first, as the server lists the history. */
export function historyRows(revisions: readonly HomebrewRevisionSummary[], kind: Kind): HistoryRow[] {
  const oldestFirst = [...revisions].reverse();
  let versions = 0;
  const rows: HistoryRow[] = [];
  let run: HomebrewRevisionSummary[] = [];
  const closeRun = (notLive: boolean) => {
    if (run.length === 0) return;
    const last = run.at(-1)!;
    const fields = [...new Set(run.flatMap((entry) => entry.changedFields))];
    const first = run[0]!;
    const label = (() => {
      if (notLive) return "Changes not live";
      if (run.length === 1) {
        if (first.event === "create") return "Made";
        if (first.event === "duplicate") return "Copied";
        if (first.event === "import") return "Imported";
        if (first.event === "revert") return "An old version put back";
        if (first.event === "discard") return "Changes discarded";
        return "An edit";
      }
      return `${run.length} edits`;
    })();
    rows.push({
      key: `run-${last.id}`,
      revisionId: last.id,
      label,
      version: null,
      at: last.at,
      device: last.device,
      devices: new Set(run.map((entry) => entry.deviceKey ?? entry.device)).size,
      changed: fields.map((field) => fieldWord(kind, field)),
      notLive,
      edits: run.length
    });
    run = [];
  };
  for (const entry of oldestFirst) {
    if (entry.event === "publish") {
      closeRun(false);
      versions += 1;
      rows.push({
        key: `v-${entry.id}`,
        revisionId: entry.id,
        label: `Version ${versions}`,
        version: versions,
        at: entry.at,
        device: entry.device,
        devices: 1,
        changed: versions === 1 ? ["First release"] : entry.changedFields.map((field) => fieldWord(kind, field)),
        notLive: false,
        edits: 0
      });
      continue;
    }
    if (BODY_EVENTS.has(entry.event)) {
      run.push(entry);
      continue;
    }
    closeRun(false);
    rows.push({
      key: `e-${entry.id}`,
      revisionId: null,
      label: rowEventWord(entry),
      version: null,
      at: entry.at,
      device: entry.device,
      devices: 1,
      changed: entry.event === "share" ? [`Who sees it: ${AUDIENCE_WORD[entry.audience]}`] : [],
      notLive: false,
      edits: 0
    });
  }
  // Edits after the last publish of a record still published wait for Update.
  const last = oldestFirst.at(-1);
  const published = last?.state === "published" && versions > 0;
  closeRun(published && (run.at(-1)?.pending ?? false));
  return rows.reverse();
}

function rowEventWord(entry: HomebrewRevisionSummary): string {
  switch (entry.event) {
    case "unpublish":
      return "Unpublished";
    case "share":
      return "Who sees it";
    case "archive":
      return "Archived";
    case "restore":
      return "Restored";
    case "pack":
      return "Pack switched";
    default:
      return "A change";
  }
}

/** The two rows History compares when it opens: the newest body against the version before it. */
export function defaultPicks(rows: readonly HistoryRow[]): readonly string[] {
  const withBody = rows.filter((row) => row.revisionId !== null);
  return withBody.slice(0, 2).map((row) => row.key);
}
