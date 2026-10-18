import { useMemo, useState } from "react";
import { Alert, Button, Combobox, Field, Input } from "@vtt/ui";
import {
  formatWorldDate,
  type CodexChronicleRecord,
  type CodexDowntimePayload,
  type CodexInWorldDate,
  type CodexPageSummary,
  type GmCodexCalendar,
  type PlayerCodexChronicleRecord,
  type PlayerCodexDowntimePayload
} from "@vtt/domain";
import { journalApi } from "../api";
import { ARCHIVED_META, charactersFor, type ArchivableActor } from "../characters";
import { deadlinesPassedBy, downtimeOf, downtimeSummaryLabel } from "../chronicle";
import { EntityIcon } from "../icons";
import { newId } from "../../lib/ids";

/**
 * Downtime in the chronicle: days per person, what waits to be confirmed, and linking an old row to a character
 * page. A lens over the chronicle's downtime records, never a second store. Totals count a linked character page
 * once, however its `who` was typed.
 */

type DowntimeRef = Readonly<{ id: string; inWorldLabel: string | null; realDate: string | null }>;
export type DowntimeTotal = Readonly<{
  key: string;
  name: string;
  pageId: string | null;
  days: number;
  last: string | null;
}>;

export function downtimeTotals(
  rows: ReadonlyArray<Readonly<{ record: DowntimeRef; payload: PlayerCodexDowntimePayload }>>,
  titles: ReadonlyMap<string, string>
): DowntimeTotal[] {
  const byPerson = new Map<
    string,
    { key: string; name: string; pageId: string | null; days: number; last: string | null }
  >();
  for (const { record, payload } of rows) {
    const key = payload.characterPageId ?? (payload.who.trim().toLowerCase() || "unnamed");
    const name = (payload.characterPageId && titles.get(payload.characterPageId)) || payload.who.trim() || "Unnamed";
    const when = record.inWorldLabel ?? record.realDate ?? null;
    const existing = byPerson.get(key);
    if (existing) {
      existing.days += payload.days;
      existing.last = when ?? existing.last;
    } else byPerson.set(key, { key, name, pageId: payload.characterPageId, days: payload.days, last: when });
  }
  return [...byPerson.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

function TotalsTable({
  totals,
  onOpenPage
}: Readonly<{ totals: readonly DowntimeTotal[]; onOpenPage: (pageId: string) => void }>) {
  return (
    <table className="nh-table story-downtime-totals">
      <thead>
        <tr>
          <th scope="col">Who</th>
          <th scope="col">Days</th>
          <th scope="col">Last downtime</th>
        </tr>
      </thead>
      <tbody>
        {totals.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              {row.pageId ? (
                <button type="button" className="story-linkbutton" onClick={() => onOpenPage(row.pageId!)}>
                  {row.name}
                </button>
              ) : (
                row.name
              )}
            </th>
            <td>{row.days}</td>
            <td>{row.last ?? "None"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type GmRow = Readonly<{ record: CodexChronicleRecord; payload: CodexDowntimePayload }>;

export function GmDowntime({
  gmToken,
  records,
  calendar,
  pages,
  actors = [],
  onChanged,
  onOpenPage,
  onLog
}: Readonly<{
  gmToken: string;
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  pages: readonly CodexPageSummary[];
  actors?: readonly ArchivableActor[];
  onChanged: () => void | Promise<void>;
  onOpenPage: (pageId: string) => void;
  /** Opens the chronicle's composer on Downtime. */
  onLog: () => void;
}>) {
  const rows = useMemo<readonly GmRow[]>(
    () =>
      records
        .map((record) => ({ record, payload: downtimeOf(record) }))
        .filter((row): row is GmRow => row.payload !== null),
    [records]
  );
  const titles = useMemo(() => new Map(pages.map((page) => [page.id, page.title])), [pages]);
  const totals = useMemo(() => downtimeTotals(rows, titles), [rows, titles]);
  const pending = rows.filter((row) => !row.payload.applied);
  const options = useMemo(
    () =>
      charactersFor(pages, actors).map((option) => ({
        id: option.id,
        label: option.title,
        icon: <EntityIcon type="character" />,
        ...(option.archived ? { meta: ARCHIVED_META } : {})
      })),
    [pages, actors]
  );
  const [rowError, setRowError] = useState<Readonly<{ id: string; message: string }> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editWho, setEditWho] = useState("");
  const [editActivity, setEditActivity] = useState("");
  const [editPageId, setEditPageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noDate = !calendar?.currentDate;

  const confirmLabel = (target: CodexInWorldDate | null) => {
    if (!calendar || !target) return "Confirm";
    const passes = deadlinesPassedBy(records, calendar, target);
    return `Move your date to ${formatWorldDate(calendar, target)}${passes > 0 ? ` (passes ${passes} deadline${passes === 1 ? "" : "s"})` : ""}`;
  };
  // A stale list answers 409; the read afterwards drops the row and the message says why.
  const confirmRow = async (row: GmRow) => {
    setRowError(null);
    try {
      await journalApi.applyDowntime(gmToken, row.record.id);
    } catch (cause) {
      setRowError({ id: row.record.id, message: cause instanceof Error ? cause.message : "Couldn't move the clock." });
    }
    await onChanged();
  };
  const saveEdit = async (id: string) => {
    setError(null);
    try {
      await journalApi.update(gmToken, id, {
        downtime: { who: editWho.trim(), activity: editActivity.trim(), characterPageId: editPageId },
        commandId: newId()
      });
      setEditing(null);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that change.");
    }
  };

  return (
    <section className="story-card" aria-label="Downtime">
      <div className="story-card-head">
        <h3 className="story-eyebrow">Downtime</h3>
        <Button variant="ghost" size="sm" onClick={onLog}>
          Log downtime
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {pending.length > 0 && (
        <>
          {noDate && (
            <Alert tone="warning">
              Set your date before passing time. Confirming moves the date forward, so it needs a date to start from.
            </Alert>
          )}
          <ul className="story-downtime-pending" aria-label="Waiting to be confirmed">
            {pending.map((row) => (
              <li key={row.record.id} className="story-downtime-row">
                <span>{downtimeSummaryLabel(row.payload)}</span>
                <Button variant="secondary" disabled={noDate} onClick={() => void confirmRow(row)}>
                  {confirmLabel(row.record.proposedDate)}
                </Button>
                {rowError?.id === row.record.id && <Alert tone="danger">{rowError.message}</Alert>}
              </li>
            ))}
          </ul>
        </>
      )}
      {totals.length === 0 ? (
        <p className="story-hint">No downtime logged yet.</p>
      ) : (
        <TotalsTable totals={totals} onOpenPage={onOpenPage} />
      )}
      {rows.some((row) => !row.payload.characterPageId) && (
        <details className="story-downtime-link">
          <summary>Link a row to a character</summary>
          <ul className="story-downtime-history">
            {rows
              .filter((row) => !row.payload.characterPageId || editing === row.record.id)
              .map(({ record, payload }) => (
                <li key={record.id} className="story-downtime-row">
                  {editing === record.id ? (
                    <div className="story-downtime-edit">
                      <Field label="Who" htmlFor={`dt-who-${record.id}`}>
                        <Input
                          id={`dt-who-${record.id}`}
                          value={editWho}
                          onChange={(event) => setEditWho(event.target.value)}
                        />
                      </Field>
                      <Field label="Activity" htmlFor={`dt-act-${record.id}`}>
                        <Input
                          id={`dt-act-${record.id}`}
                          value={editActivity}
                          onChange={(event) => setEditActivity(event.target.value)}
                        />
                      </Field>
                      <Field
                        label="Character page"
                        htmlFor={`dt-page-${record.id}`}
                        help="Days can't change after logging. Delete the record and log it again to correct them."
                      >
                        <Combobox
                          id={`dt-page-${record.id}`}
                          options={options}
                          value={editPageId}
                          onChange={setEditPageId}
                          limit={Math.max(options.length, 1)}
                          ariaLabel="Link to a character page"
                          placeholder="Search characters"
                        />
                      </Field>
                      <div className="story-row-actions">
                        <Button variant="secondary" size="sm" onClick={() => void saveEdit(record.id)}>
                          Save
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span>{downtimeSummaryLabel(payload)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(record.id);
                          setEditWho(payload.who);
                          setEditActivity(payload.activity);
                          setEditPageId(payload.characterPageId);
                        }}
                      >
                        Link
                      </Button>
                    </>
                  )}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The players' downtime: days per person over their own chronicle. Nothing waits on a player to confirm. */
export function PlayerDowntime({
  records,
  pages,
  onOpenPage
}: Readonly<{
  records: readonly PlayerCodexChronicleRecord[];
  pages: ReadonlyArray<Readonly<{ id: string; title: string }>>;
  onOpenPage: (pageId: string) => void;
}>) {
  const rows = useMemo(
    () =>
      records
        .map((record) => ({ record, payload: downtimeOf(record) }))
        .filter((row): row is { record: PlayerCodexChronicleRecord; payload: PlayerCodexDowntimePayload } =>
          Boolean(row.payload)
        ),
    [records]
  );
  const titles = useMemo(() => new Map(pages.map((page) => [page.id, page.title])), [pages]);
  const totals = useMemo(() => downtimeTotals(rows, titles), [rows, titles]);
  if (totals.length === 0) return null;
  return (
    <section className="story-card" aria-label="Downtime">
      <h3 className="story-eyebrow">Downtime</h3>
      <TotalsTable totals={totals} onOpenPage={onOpenPage} />
    </section>
  );
}
