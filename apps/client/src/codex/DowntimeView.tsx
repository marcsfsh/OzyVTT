import { useMemo, useState } from "react";
import { Alert, Badge, Button, Combobox, Field, Input, NumberField, Skeleton } from "@vtt/ui";
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
import { journalApi } from "./api";
import { ARCHIVED_META, charactersFor, type ArchivableActor } from "./characters";
import { deadlinesPassedBy, downtimeOf, downtimeProposedDate, downtimeSummaryLabel } from "./chronicle";
import { CodexEditor } from "./CodexEditor";
import { RecordRow } from "./RecordRow";
import { CodexIcon, EntityIcon } from "./icons";
import { newId } from "../lib/ids";

/**
 * The Downtime tracker: per-character totals, pending confirmations and history. A lens over the Journal's
 * `downtime` records, never a second store. Totals group by `characterPageId ?? who`; Edit on a history row
 * links an old free-text row to a character page.
 */
export type DowntimeViewProps = Readonly<{
  gmToken: string;
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  pages: readonly CodexPageSummary[];
  /** The table's roster, used only to tell whether a character is archived (see `characters.ts`). */
  actors?: readonly ArchivableActor[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  onOpenEntry: (entryId: string) => void;
  onOpenPage: (pageId: string) => void;
}>;

type DowntimeRow = Readonly<{ record: CodexChronicleRecord; payload: CodexDowntimePayload }>;

type DowntimeRecordRef = Readonly<{ id: string; inWorldLabel: string | null; realDate: string | null }>;
type DowntimeTotal = Readonly<{ key: string; name: string; pageId: string | null; days: number; last: string | null }>;

/** Days per person, most first. A linked character page wins over the typed name, and names the row. */
function downtimeTotals(
  rows: ReadonlyArray<Readonly<{ record: DowntimeRecordRef; payload: PlayerCodexDowntimePayload }>>,
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

/** The totals table both audiences read. */
function DowntimeTotalsTable({
  totals,
  onOpenPage
}: Readonly<{ totals: readonly DowntimeTotal[]; onOpenPage: (pageId: string) => void }>) {
  return (
    <table className="nh-table codex-downtime-totals">
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
                <button type="button" className="codex-md-link" onClick={() => onOpenPage(row.pageId!)}>
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

const titlesOf = (pages: ReadonlyArray<Readonly<{ id: string; title: string }>>) =>
  new Map(pages.map((page) => [page.id, page.title]));

export function DowntimeView({
  gmToken,
  records,
  calendar,
  pages,
  actors = [],
  loading,
  error,
  onChanged,
  onOpenEntry,
  onOpenPage
}: DowntimeViewProps) {
  /** A Combobox with `allowFreeText`: holds a character page id or the typed name, told apart by lookup. */
  const [whoValue, setWhoValue] = useState<string | null>(null);
  const [activity, setActivity] = useState("");
  const [days, setDays] = useState(7);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** A Confirm failure shows on the row it was pressed on. */
  const [rowError, setRowError] = useState<Readonly<{ id: string; message: string }> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editWho, setEditWho] = useState("");
  const [editActivity, setEditActivity] = useState("");
  const [editPageId, setEditPageId] = useState<string | null>(null);

  const rows = useMemo<readonly DowntimeRow[]>(
    () =>
      records
        .map((record) => ({ record, payload: downtimeOf(record) }))
        .filter((row): row is DowntimeRow => row.payload !== null),
    [records]
  );
  const pending = useMemo(() => rows.filter((row) => !row.payload.applied), [rows]);
  /** Same order and wording as "Who played": active characters first, archived last with a muted suffix. */
  const characterOptions = useMemo(
    () =>
      charactersFor(pages, actors).map((option) => ({
        id: option.id,
        label: option.title,
        icon: <EntityIcon type="character" />,
        ...(option.archived ? { meta: ARCHIVED_META } : {})
      })),
    [pages, actors]
  );
  /** `Combobox` silently truncates at 8 by default; offer the whole party (the list scrolls). */
  const characterLimit = Math.max(characterOptions.length, 1);
  const titles = useMemo(() => titlesOf(pages), [pages]);
  const pageTitle = (id: string | null) => (id ? (titles.get(id) ?? null) : null);
  /** A value that names a character page is a link; anything else is the free-text name the GM typed. */
  const whoPageId = whoValue && characterOptions.some((option) => option.id === whoValue) ? whoValue : null;
  const who = whoPageId ? "" : (whoValue ?? "");

  const totals = useMemo(() => downtimeTotals(rows, titles), [rows, titles]);

  const proposed = downtimeProposedDate(calendar, days);
  const log = async () => {
    if (busy || (!who.trim() && !whoPageId) || days < 0) return;
    setBusy(true);
    setFormError(null);
    try {
      await journalApi.createDowntime(gmToken, {
        playerText: note.trim(),
        downtime: {
          who: whoPageId ? (pageTitle(whoPageId) ?? who.trim()) : who.trim(),
          activity: activity.trim(),
          days: Math.max(0, Math.trunc(days)),
          ...(whoPageId ? { characterPageId: whoPageId } : {})
        },
        commandId: newId()
      });
      setWhoValue(null);
      setActivity("");
      setNote("");
      onChanged();
    } catch (logError) {
      setFormError(logError instanceof Error ? logError.message : "Couldn't log that downtime.");
    } finally {
      setBusy(false);
    }
  };
  /**
   * A 400 (no campaign date) is prevented by disabling Confirm. A 409 means this list is stale (applied
   * elsewhere), so `onChanged()` runs on failure too: the refetch drops the row and the message explains it.
   */
  const confirmRow = async (row: DowntimeRow) => {
    setRowError(null);
    try {
      await journalApi.applyDowntime(gmToken, row.record.id);
      onChanged();
    } catch (applyError) {
      setRowError({
        id: row.record.id,
        message: applyError instanceof Error ? applyError.message : "Couldn't move the clock."
      });
      onChanged();
    }
  };
  const saveEdit = async (id: string) => {
    setBusy(true);
    setFormError(null);
    try {
      await journalApi.update(gmToken, id, {
        downtime: { who: editWho.trim(), activity: editActivity.trim(), characterPageId: editPageId },
        commandId: newId()
      });
      setEditing(null);
      onChanged();
    } catch (editError) {
      setFormError(editError instanceof Error ? editError.message : "Couldn't save that change.");
    } finally {
      setBusy(false);
    }
  };

  const confirmLabel = (target: CodexInWorldDate | null) => {
    if (!calendar || !target) return "Confirm";
    const passes = deadlinesPassedBy(records, calendar, target);
    return `Move your date to ${formatWorldDate(calendar, target)}${passes > 0 ? ` (passes ${passes} deadline${passes === 1 ? "" : "s"})` : ""}`;
  };
  /** No campaign date means nothing to advance from; read from the calendar since that's the cause to name. */
  const noCampaignDate = !calendar?.currentDate;

  if (loading && rows.length === 0)
    return (
      <div className="codex-main-loading">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="text" />
        ))}
      </div>
    );

  return (
    <div className="codex-downtime">
      {error && (
        <Alert tone="danger" title="Couldn't load downtime">
          {error}
        </Alert>
      )}
      {formError && <Alert tone="danger">{formError}</Alert>}

      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">Log downtime</h3>
        {/* The same write the Journal composer uses. */}
        <div className="codex-downtime-form">
          {/* No help string: a 3-row field would stretch its neighbours (see `align-content: start` in codex.css). */}
          <Field label="Who" htmlFor="codex-downtime-who">
            {characterOptions.length > 0 ? (
              <Combobox
                id="codex-downtime-who"
                options={characterOptions}
                value={whoValue}
                onChange={setWhoValue}
                allowFreeText
                limit={characterLimit}
                ariaLabel="Who spent the time"
                placeholder="Search characters, or type a name"
              />
            ) : (
              <Input
                id="codex-downtime-who"
                value={who}
                placeholder="Vex"
                onChange={(event) => setWhoValue(event.target.value || null)}
              />
            )}
          </Field>
          <Field label="Activity" htmlFor="codex-downtime-activity">
            <Input
              id="codex-downtime-activity"
              value={activity}
              placeholder="Forging a blade"
              onChange={(event) => setActivity(event.target.value)}
            />
          </Field>
          <Field label="Days" htmlFor="codex-downtime-days">
            <NumberField
              id="codex-downtime-days"
              aria-label="Days"
              value={days}
              min={0}
              max={3650}
              onChange={(next) => setDays(next ?? 0)}
            />
          </Field>
          {/* The note becomes the record's player text, so it gets the same editor (with `[[` links) as the Journal. */}
          <Field label="Note" htmlFor="codex-downtime-note" className="codex-field-wide">
            <CodexEditor
              id="codex-downtime-note"
              token={gmToken}
              value={note}
              onChange={setNote}
              ariaLabel="Note"
              placeholder="Notes about this downtime"
              pages={pages}
              onNavigate={() => undefined}
              rows={3}
            />
          </Field>
        </div>
        {proposed && calendar && (
          <p className="codex-composer-hint">
            Logging this proposes moving your date to <strong>{formatWorldDate(calendar, proposed)}</strong>. Nothing
            moves until you confirm it below.
          </p>
        )}
        <Button variant="primary" disabled={busy || (!who.trim() && !whoPageId)} onClick={() => void log()}>
          Log downtime
        </Button>
      </section>

      {pending.length > 0 && (
        <section className="codex-downtime-section">
          <h3 className="codex-campaign-h">Pending confirmations</h3>
          {/* Shown once above the list: the cause is the campaign's and belongs to no one record. */}
          {noCampaignDate && (
            <Alert tone="warning">
              Set your date on the Calendar before passing time. Confirming moves the date forward, so it needs a date
              to start from.
            </Alert>
          )}
          <ul className="codex-downtime-pending">
            {pending.map((row) => (
              <li key={row.record.id} className="codex-downtime-pendingrow">
                <CodexIcon iconId="campfire" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{downtimeSummaryLabel(row.payload)}</span>
                {/* Secondary: "Log downtime" is this view's one primary action. */}
                <Button variant="secondary" size="sm" disabled={noCampaignDate} onClick={() => void confirmRow(row)}>
                  {confirmLabel(row.record.proposedDate)}
                </Button>
                {rowError?.id === row.record.id && <Alert tone="danger">{rowError.message}</Alert>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">Totals</h3>
        {totals.length === 0 ? (
          <p className="codex-list-empty">No downtime recorded yet.</p>
        ) : (
          <DowntimeTotalsTable totals={totals} onOpenPage={onOpenPage} />
        )}
      </section>

      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">History</h3>
        {rows.length === 0 ? (
          <p className="codex-list-empty">No downtime logged yet. Use the form above to log some.</p>
        ) : (
          <ul className="codex-downtime-history">
            {rows.map(({ record, payload }) => (
              <li key={record.id} className="codex-downtime-historyrow">
                {editing === record.id ? (
                  <div className="codex-downtime-edit">
                    <Field label="Who" htmlFor={`codex-dt-who-${record.id}`}>
                      <Input
                        id={`codex-dt-who-${record.id}`}
                        value={editWho}
                        onChange={(event) => setEditWho(event.target.value)}
                      />
                    </Field>
                    <Field label="Activity" htmlFor={`codex-dt-act-${record.id}`}>
                      <Input
                        id={`codex-dt-act-${record.id}`}
                        value={editActivity}
                        onChange={(event) => setEditActivity(event.target.value)}
                      />
                    </Field>
                    <Field
                      label="Character page"
                      htmlFor={`codex-dt-page-${record.id}`}
                      help="Days cannot be changed after logging. Delete the entry and log it again to correct it."
                    >
                      <Combobox
                        options={characterOptions}
                        value={editPageId}
                        onChange={setEditPageId}
                        limit={characterLimit}
                        ariaLabel="Link to a character page"
                        placeholder="Search characters"
                      />
                    </Field>
                    <div className="codex-conn-formactions">
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveEdit(record.id)}>
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <RecordRow
                      iconId="campfire"
                      title={downtimeSummaryLabel(payload)}
                      when={record.inWorldLabel ?? record.realDate}
                      onClick={() => onOpenEntry(record.id)}
                    >
                      {payload.characterPageId ? (
                        <Badge tone="info">{pageTitle(payload.characterPageId) ?? "Linked"}</Badge>
                      ) : (
                        <Badge>Not linked</Badge>
                      )}
                      {payload.applied ? (
                        <Badge tone="success">Confirmed</Badge>
                      ) : (
                        <Badge tone="caution">Pending</Badge>
                      )}
                    </RecordRow>
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
                      Edit
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The player's Downtime over their own chronicle. No Pending section: `applied` isn't on the player
 * payload, so it couldn't render one.
 */
export function PlayerDowntimeView({
  records,
  pages,
  onOpenEntry,
  onOpenPage
}: Readonly<{
  records: readonly PlayerCodexChronicleRecord[];
  pages: ReadonlyArray<Readonly<{ id: string; title: string }>>;
  onOpenEntry: (entryId: string) => void;
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
  const titles = useMemo(() => titlesOf(pages), [pages]);
  const totals = useMemo(() => downtimeTotals(rows, titles), [rows, titles]);

  if (rows.length === 0)
    return (
      <div className="codex-main-empty">
        <h3>No downtime yet</h3>
        <p>Downtime the GM logs for the party appears here.</p>
      </div>
    );
  return (
    <div className="codex-downtime">
      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">Totals</h3>
        <DowntimeTotalsTable totals={totals} onOpenPage={onOpenPage} />
      </section>
      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">History</h3>
        <ul className="codex-downtime-history">
          {rows.map(({ record, payload }) => (
            <li key={record.id} className="codex-downtime-historyrow">
              <RecordRow
                iconId="campfire"
                title={downtimeSummaryLabel(payload)}
                when={record.inWorldLabel ?? record.realDate}
                onClick={() => onOpenEntry(record.id)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
