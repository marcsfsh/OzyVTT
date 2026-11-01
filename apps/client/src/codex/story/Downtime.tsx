import { useMemo, useState } from "react";
import { Alert, Button, Combobox, Field, Input, SideListGroup, SideListRow, cx } from "@vtt/ui";
import {
  dateToInstant,
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
import { campaignDeadlines, deadlineFired, deadlinesPassedBy, downtimeOf, downtimeSummaryLabel } from "../chronicle";
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
  onLog,
  variant = "card",
  only = null
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
  /** In the Downtime tab the side list carries the totals and the head carries Log downtime; the card keeps what
   *  waits to be confirmed and linking an old row. */
  variant?: "card" | "tab";
  /** The tab's chosen character: what waits is theirs alone. */
  only?: string | null;
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
  const pending = rows.filter(
    (row) =>
      !row.payload.applied &&
      (only === null || (row.payload.characterPageId ?? (row.payload.who.trim().toLowerCase() || "unnamed")) === only)
  );
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
    <section className={variant === "tab" ? "story-downtime-waits" : "story-card"} aria-label="Downtime">
      {variant === "card" && (
        <div className="story-card-head">
          <h3 className="story-eyebrow">Downtime</h3>
          <Button size="sm" onClick={onLog}>
            Log downtime
          </Button>
        </div>
      )}
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
              <li key={row.record.id} className="story-downtime-row is-waiting">
                <span className="story-downtime-lamp" aria-hidden="true" />
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
      {variant === "card" &&
        (totals.length === 0 ? (
          <p className="story-hint">No downtime logged yet.</p>
        ) : (
          <TotalsTable totals={totals} onOpenPage={onOpenPage} />
        ))}
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

/** The days between the GM's date and a deadline's, on the campaign's calendar; null without both dates. */
function daysLeft(calendar: GmCodexCalendar | null, date: CodexInWorldDate | null): number | null {
  if (!calendar?.currentDate || !date) return null;
  try {
    return dateToInstant(calendar, date) - dateToInstant(calendar, calendar.currentDate);
  } catch {
    return null;
  }
}

/** Close enough that the deadline reads in amber. */
const DEADLINE_CLOSE_DAYS = 3;

/**
 * The story's Downtime tab (F3 atlas spec 2.5): CHARACTERS with this month's days and DEADLINES with their days left at
 * the side, the chosen character at the right with Log downtime as the Cup, what waits to be confirmed, and their
 * downtime as rows. A lens over the chronicle's downtime records, as the card was; the chosen character is `?who=`.
 */
export function GmDowntimeTab({
  gmToken,
  records,
  calendar,
  pages,
  actors = [],
  phone = false,
  chosenKey,
  onChoose,
  onChanged,
  onOpenPage,
  onLog
}: Readonly<{
  gmToken: string;
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  pages: readonly CodexPageSummary[];
  actors?: readonly ArchivableActor[];
  phone?: boolean;
  chosenKey: string | null;
  onChoose: (key: string) => void;
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
  const keyOf = (payload: CodexDowntimePayload) =>
    payload.characterPageId ?? (payload.who.trim().toLowerCase() || "unnamed");
  const now = calendar?.currentDate ?? null;
  // This month on the campaign's calendar; with no date set, every day counts.
  const thisMonth = (row: GmRow) =>
    !now || (row.record.inWorldDate?.year === now.year && row.record.inWorldDate?.month === now.month);
  const people = useMemo(() => downtimeTotals(rows, titles), [rows, titles]);
  const monthDays = (key: string) =>
    rows.filter((row) => keyOf(row.payload) === key && thisMonth(row)).reduce((sum, row) => sum + row.payload.days, 0);
  const chosen = people.find((person) => person.key === chosenKey) ?? people[0] ?? null;
  const theirs = chosen ? rows.filter((row) => keyOf(row.payload) === chosen.key) : [];
  const deadlines = campaignDeadlines(records).filter((record) => !deadlineFired(record));

  const characterList = phone ? (
    <div className="nh-filterchips" role="group" aria-label="Characters">
      {people.map((person) => (
        <button
          key={person.key}
          type="button"
          className={cx("nh-filterchip", "interactive", chosen?.key === person.key && "is-on")}
          aria-pressed={chosen?.key === person.key}
          onClick={() => onChoose(person.key)}
        >
          {person.name} <span className="cx-tag-n">{person.days}</span>
        </button>
      ))}
    </div>
  ) : (
    <SideListGroup eyebrow="Characters">
      {people.map((person) => (
        <SideListRow
          key={person.key}
          label={person.name}
          leading={<EntityIcon type="character" />}
          count={person.days}
          current={chosen?.key === person.key}
          onSelect={() => onChoose(person.key)}
        />
      ))}
    </SideListGroup>
  );
  const deadlineList =
    deadlines.length === 0 ? null : (
      <SideListGroup eyebrow="Deadlines" className="story-downtime-deadlines">
        {deadlines.map((record) => {
          const left = daysLeft(calendar, record.inWorldDate);
          return (
            <SideListRow
              key={record.id}
              label={record.text.trim() || "A deadline"}
              count={
                left === null ? undefined : (
                  <span className={cx(left <= DEADLINE_CLOSE_DAYS && "is-close")}>{`${Math.max(0, left)}d`}</span>
                )
              }
              className={cx(left !== null && left <= DEADLINE_CLOSE_DAYS && "is-close")}
            />
          );
        })}
      </SideListGroup>
    );

  const detail = (
    <section className="story-downtime-person" aria-label={chosen ? chosen.name : "Characters' downtime"}>
      {chosen ? (
        <div className="story-downtime-head">
          <span className="story-downtime-face" aria-hidden="true">
            <EntityIcon type="character" />
          </span>
          <span className="story-downtime-who">
            <b>{chosen.name}</b>
            <small>{`${monthDays(chosen.key)} ${monthDays(chosen.key) === 1 ? "day" : "days"} of downtime ${now ? "this month" : "logged"}`}</small>
          </span>
          {!phone && (
            <Button variant="primary" onClick={onLog}>
              Log downtime
            </Button>
          )}
        </div>
      ) : (
        <div className="story-downtime-head">
          <p className="story-hint">No downtime logged yet.</p>
          {!phone && (
            <Button variant="primary" onClick={onLog}>
              Log downtime
            </Button>
          )}
        </div>
      )}
      {/* What waits to be confirmed, with its amber lamp and Confirm, and linking an old row: today's card parts. */}
      <GmDowntime
        variant="tab"
        only={chosen?.key ?? null}
        gmToken={gmToken}
        records={records}
        calendar={calendar}
        pages={pages}
        actors={actors}
        onChanged={onChanged}
        onOpenPage={onOpenPage}
        onLog={onLog}
      />
      {theirs.length > 0 && (
        <>
          <p className="nh-sidelist-eyebrow">Downtime</p>
          <ul className="story-downtime-rows" aria-label="Their downtime">
            {[...theirs].reverse().map(({ record, payload }) => (
              <li key={record.id} className="story-downtime-entry">
                <span className="story-downtime-when">{record.inWorldLabel ?? record.realDate ?? "Undated"}</span>
                <span className="story-downtime-days">{`${payload.days}d`}</span>
                <span className="story-downtime-what">
                  {payload.activity.trim() || record.text.trim() || "Downtime"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );

  return phone ? (
    <div className="story-downtime-tab is-phone">
      {characterList}
      {detail}
      <Button variant="primary" block onClick={onLog}>
        Log downtime
      </Button>
      {deadlineList}
    </div>
  ) : (
    <div className="story-downtime-tab">
      <nav className="story-downtime-side scroll-y" aria-label="Characters and deadlines">
        {characterList}
        {deadlineList}
      </nav>
      <div className="story-downtime-main scroll-y">{detail}</div>
    </div>
  );
}
