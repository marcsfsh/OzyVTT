import { useMemo, useState } from "react";
import { Alert, Badge, Button, Combobox, Field, Input, NumberField, Skeleton } from "@vtt/ui";
import {
  formatWorldDate, journalApi,
  type CodexChronicleRecord, type CodexDowntimePayload, type CodexInWorldDate, type CodexPageSummary,
  type GmCodexCalendar, type PlayerCodexChronicleRecord
} from "./api";
import { deadlinesPassedBy, downtimeOf, downtimeProposedDate, downtimeSummaryLabel } from "./chronicle";
import { CodexEditor } from "./CodexEditor";
import { CodexIcon, EntityIcon } from "./icons";
import { newId } from "../lib/ids";

/**
 * D12 — the Downtime tracker: per-character totals, pending confirmations, and history in one place.
 *
 * **A lens over the Journal, never a second store** (invariant 7). Every row here is a `downtime`
 * chronicle record the Journal already carries; there is deliberately no aggregation endpoint, because
 * a server aggregate would be a second read path with its own per-audience visibility arms to keep in
 * step with the projections that already exist.
 *
 * Totals group by `characterPageId ?? who`, which is the point of D12's new field: before it, "Vex",
 * "vex" and "Vex the Bold" were three people. The **Edit** action on a history row is the adoption path
 * for everything recorded before the field existed — it is what lets a GM point an old free-text row at
 * a real character page.
 */
export type DowntimeViewProps = Readonly<{
  gmToken: string;
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  pages: readonly CodexPageSummary[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  onOpenEntry: (entryId: string) => void;
  onOpenPage: (pageId: string) => void;
}>;

type DowntimeRow = Readonly<{ record: CodexChronicleRecord; payload: CodexDowntimePayload }>;

export function DowntimeView({ gmToken, records, calendar, pages, loading, error, onChanged, onOpenEntry, onOpenPage }: DowntimeViewProps) {
  /**
   * ONE control, one state. "Who" used to be two text boxes bound to the same `who`: a Combobox that
   * rendered while `who` was empty and a bare Input beside it that was always there. Typing a free-text
   * name into the lower one made `who` truthy, which swapped the Combobox above it for a THIRD input
   * carrying the same value — two boxes with identical text, one labelled "Who" and one "Or type a
   * name", focus in the second, on the first control of D12's flagship surface. The Combobox's own
   * `allowFreeText` mode exists for exactly this field (the styleguide names it), so it holds either a
   * character page's id or the raw text, and the two are told apart by looking it up.
   */
  const [whoValue, setWhoValue] = useState<string | null>(null);
  const [activity, setActivity] = useState("");
  const [days, setDays] = useState(7);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editWho, setEditWho] = useState("");
  const [editActivity, setEditActivity] = useState("");
  const [editPageId, setEditPageId] = useState<string | null>(null);

  const rows = useMemo<readonly DowntimeRow[]>(
    () => records
      .map((record) => ({ record, payload: downtimeOf<CodexDowntimePayload>(record) }))
      .filter((row): row is DowntimeRow => row.payload !== null),
    [records]
  );
  const pending = useMemo(() => rows.filter((row) => !row.payload.applied), [rows]);
  const characterOptions = useMemo(
    () => pages.filter((page) => page.entityType === "character").map((page) => ({ id: page.id, label: page.title, icon: <EntityIcon type="character" /> })),
    [pages]
  );
  /**
   * **The whole party is reachable, not the first eight of it.** `Combobox` pages at `limit = 8` by
   * default and truncates SILENTLY (`Combobox.tsx:64`, `.slice(0, limit)` — no "8 of 13" line, no
   * scroll cue), so a campaign with nine character pages simply lost the ninth: absent from the
   * unfiltered list below, and on the edit row — which has no `allowFreeText` escape — a ninth
   * character could not be linked at all. The same default truncated the thirteen damage types
   * elsewhere; `TagInput` already defeats it exactly this way (`TagInput.tsx:153`), and
   * `.nh-combobox-list` scrolls at 17rem, so a party-sized list is safe to offer whole.
   */
  const characterLimit = Math.max(characterOptions.length, 1);
  const pageTitle = (id: string | null) => (id ? pages.find((page) => page.id === id)?.title ?? null : null);
  /** A value that names a character page is a link; anything else is the free-text name the GM typed. */
  const whoPageId = whoValue && characterOptions.some((option) => option.id === whoValue) ? whoValue : null;
  const who = whoPageId ? "" : whoValue ?? "";

  /** Totals by person. `characterPageId` wins, so a linked row totals with its page whatever `who` says. */
  const totals = useMemo(() => {
    const map = new Map<string, { key: string; name: string; pageId: string | null; days: number; last: string | null }>();
    for (const { record, payload } of rows) {
      const key = payload.characterPageId ?? (payload.who.trim().toLowerCase() || "—");
      const name = pageTitle(payload.characterPageId) ?? (payload.who.trim() || "Unnamed");
      const existing = map.get(key);
      const when = record.inWorldLabel ?? record.realDate ?? null;
      if (existing) { existing.days += payload.days; existing.last = when ?? existing.last; }
      else map.set(key, { key, name, pageId: payload.characterPageId, days: payload.days, last: when });
    }
    return [...map.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  }, [rows, pages]);

  const proposed = downtimeProposedDate(calendar, days);
  const log = async () => {
    if (busy || (!who.trim() && !whoPageId) || days < 0) return;
    setBusy(true); setFormError(null);
    try {
      await journalApi.createDowntime(gmToken, {
        playerText: note.trim(),
        downtime: {
          who: whoPageId ? pageTitle(whoPageId) ?? who.trim() : who.trim(),
          activity: activity.trim(), days: Math.max(0, Math.trunc(days)),
          ...(whoPageId ? { characterPageId: whoPageId } : {})
        },
        commandId: newId()
      });
      setWhoValue(null); setActivity(""); setNote("");
      onChanged();
    } catch (logError) { setFormError(logError instanceof Error ? logError.message : "Couldn't log that downtime."); }
    finally { setBusy(false); }
  };
  const confirmRow = async (row: DowntimeRow) => {
    setFormError(null);
    try { await journalApi.applyDowntime(gmToken, row.record.id); onChanged(); }
    catch (applyError) { setFormError(applyError instanceof Error ? applyError.message : "Couldn't move the clock."); }
  };
  const saveEdit = async (id: string) => {
    setBusy(true); setFormError(null);
    try {
      await journalApi.update(gmToken, id, {
        downtime: { who: editWho.trim(), activity: editActivity.trim(), characterPageId: editPageId },
        commandId: newId()
      });
      setEditing(null); onChanged();
    } catch (editError) { setFormError(editError instanceof Error ? editError.message : "Couldn't save that change."); }
    finally { setBusy(false); }
  };

  const confirmLabel = (target: CodexInWorldDate | null) => {
    if (!calendar || !target) return "Confirm";
    const passes = deadlinesPassedBy(records, calendar, target);
    return `Move your date to ${formatWorldDate(calendar, target)}${passes > 0 ? ` (passes ${passes} deadline${passes === 1 ? "" : "s"})` : ""}`;
  };

  if (loading && rows.length === 0) return <div className="codex-main-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>;

  return (
    <div className="codex-downtime">
      {error && <Alert tone="danger" title="Couldn't load downtime">{error}</Alert>}
      {formError && <Alert tone="danger">{formError}</Alert>}

      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">Log downtime</h3>
        {/* The SAME write the Journal composer uses — one write path, two doors. */}
        <div className="codex-downtime-form">
          <Field label="Who" htmlFor="codex-downtime-who" help="Pick a character page, or type a name.">
            {characterOptions.length > 0
              ? <Combobox id="codex-downtime-who" options={characterOptions} value={whoValue} onChange={setWhoValue} allowFreeText limit={characterLimit}
                  ariaLabel="Who spent the time" placeholder="Search characters, or type a name" />
              : <Input id="codex-downtime-who" value={who} placeholder="Vex" onChange={(event) => setWhoValue(event.target.value || null)} />}
          </Field>
          <Field label="Activity" htmlFor="codex-downtime-activity"><Input id="codex-downtime-activity" value={activity} placeholder="Forging a blade" onChange={(event) => setActivity(event.target.value)} /></Field>
          <Field label="Days" htmlFor="codex-downtime-days"><NumberField id="codex-downtime-days" aria-label="Days" value={days} min={0} max={3650} onChange={(next) => setDays(next ?? 0)} /></Field>
          {/* D13, one editor everywhere: this note becomes a journal record's player text, so it gets the
              SAME writing surface the journal composer gives the same field — toolbar, `[[` autocomplete,
              Edit/View. It was the last bare `Textarea` left in the suite, which meant typing `[[` here
              silently did nothing while the identical write through the Journal linked pages properly. */}
          <Field label="Note" htmlFor="codex-downtime-note" className="codex-field-wide">
            <CodexEditor id="codex-downtime-note" token={gmToken} value={note} onChange={setNote}
              ariaLabel="Note" placeholder="Notes about this downtime" pages={pages} onNavigate={() => undefined} rows={3} />
          </Field>
        </div>
        {proposed && calendar && <p className="codex-composer-hint">Logging this proposes moving your date to <strong>{formatWorldDate(calendar, proposed)}</strong>. Nothing moves until you confirm it below.</p>}
        <Button variant="primary" disabled={busy || (!who.trim() && !whoPageId)} onClick={() => void log()}>Log downtime</Button>
      </section>

      {pending.length > 0 && (
        <section className="codex-downtime-section">
          <h3 className="codex-campaign-h">Pending confirmations</h3>
          <ul className="codex-downtime-pending">
            {pending.map((row) => (
              <li key={row.record.id} className="codex-downtime-pendingrow">
                <CodexIcon iconId="campfire" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{downtimeSummaryLabel(row.payload)}</span>
                {/* Secondary, not primary: the row already states the consequence in words, and this view's
                    one primary action is "Log downtime" above (§5, one primary per view). */}
                <Button variant="secondary" size="sm" onClick={() => void confirmRow(row)}>{confirmLabel(row.record.proposedDate)}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">Totals</h3>
        {totals.length === 0
          ? <p className="codex-list-empty">No downtime recorded yet.</p>
          : <table className="nh-table codex-downtime-totals">
              <thead><tr><th scope="col">Who</th><th scope="col">Days</th><th scope="col">Last downtime</th></tr></thead>
              <tbody>
                {totals.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      {row.pageId
                        ? <button type="button" className="codex-md-link" onClick={() => onOpenPage(row.pageId!)}>{row.name}</button>
                        : row.name}
                    </th>
                    <td>{row.days}</td>
                    <td>{row.last ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>}
      </section>

      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">History</h3>
        {rows.length === 0
          ? <p className="codex-list-empty">No downtime logged yet. Use the form above to log some.</p>
          : <ul className="codex-downtime-history">
              {rows.map(({ record, payload }) => (
                <li key={record.id} className="codex-downtime-historyrow">
                  {editing === record.id ? (
                    <div className="codex-downtime-edit">
                      <Field label="Who" htmlFor={`codex-dt-who-${record.id}`}><Input id={`codex-dt-who-${record.id}`} value={editWho} onChange={(event) => setEditWho(event.target.value)} /></Field>
                      <Field label="Activity" htmlFor={`codex-dt-act-${record.id}`}><Input id={`codex-dt-act-${record.id}`} value={editActivity} onChange={(event) => setEditActivity(event.target.value)} /></Field>
                      <Field label="Character page" htmlFor={`codex-dt-page-${record.id}`} help="Days cannot be changed after logging. Delete the entry and log it again to correct it.">
                        <Combobox options={characterOptions} value={editPageId} onChange={setEditPageId} limit={characterLimit} ariaLabel="Link to a character page" placeholder="Search characters" />
                      </Field>
                      <div className="codex-conn-formactions">
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveEdit(record.id)}>Save</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="codex-campaign-recentitem" onClick={() => onOpenEntry(record.id)}>
                        <CodexIcon iconId="campfire" className="codex-ent-icon codex-campaign-recentglyph" />
                        <span className="codex-list-title">{downtimeSummaryLabel(payload)}</span>
                        {payload.characterPageId
                          ? <Badge tone="info">{pageTitle(payload.characterPageId) ?? "Linked"}</Badge>
                          : <Badge>Not linked</Badge>}
                        {payload.applied ? <Badge tone="success">Confirmed</Badge> : <Badge tone="caution">Pending</Badge>}
                        <span className="codex-campaign-recentwhen">{record.inWorldLabel ?? record.realDate ?? ""}</span>
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(record.id); setEditWho(payload.who); setEditActivity(payload.activity); setEditPageId(payload.characterPageId); }}>Edit</Button>
                    </>
                  )}
                </li>
              ))}
            </ul>}
      </section>
    </div>
  );
}

/**
 * D12/D14 — the player's Downtime, the same lens over their own chronicle.
 *
 * No Pending section, and by construction rather than by a role check: `applied` is on the GM payload
 * and has no field on the player's, so this component could not render one.
 */
export function PlayerDowntimeView({ records, pages, onOpenEntry, onOpenPage }: Readonly<{
  records: readonly PlayerCodexChronicleRecord[];
  pages: ReadonlyArray<Readonly<{ id: string; title: string }>>;
  onOpenEntry: (entryId: string) => void;
  onOpenPage: (pageId: string) => void;
}>) {
  const rows = useMemo(
    () => records
      .map((record) => ({ record, payload: downtimeOf(record) }))
      .filter((row): row is { record: PlayerCodexChronicleRecord; payload: NonNullable<ReturnType<typeof downtimeOf>> } => row.payload !== null),
    [records]
  );
  const pageTitle = (id: string | null) => (id ? pages.find((page) => page.id === id)?.title ?? null : null);
  const totals = useMemo(() => {
    const map = new Map<string, { key: string; name: string; pageId: string | null; days: number; last: string | null }>();
    for (const { record, payload } of rows) {
      const key = payload.characterPageId ?? (payload.who.trim().toLowerCase() || "—");
      const name = pageTitle(payload.characterPageId) ?? (payload.who.trim() || "Unnamed");
      const existing = map.get(key);
      const when = record.inWorldLabel ?? record.realDate ?? null;
      if (existing) { existing.days += payload.days; existing.last = when ?? existing.last; }
      else map.set(key, { key, name, pageId: payload.characterPageId, days: payload.days, last: when });
    }
    return [...map.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  }, [rows, pages]);

  if (rows.length === 0) return <div className="codex-main-empty"><h3>No downtime yet</h3><p>Downtime the GM logs for the party appears here.</p></div>;
  return (
    <div className="codex-downtime">
      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">Totals</h3>
        <table className="nh-table codex-downtime-totals">
          <thead><tr><th scope="col">Who</th><th scope="col">Days</th><th scope="col">Last downtime</th></tr></thead>
          <tbody>
            {totals.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.pageId ? <button type="button" className="codex-md-link" onClick={() => onOpenPage(row.pageId!)}>{row.name}</button> : row.name}</th>
                <td>{row.days}</td>
                <td>{row.last ?? "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="codex-downtime-section">
        <h3 className="codex-campaign-h">History</h3>
        <ul className="codex-downtime-history">
          {rows.map(({ record, payload }) => (
            <li key={record.id} className="codex-downtime-historyrow">
              <button type="button" className="codex-campaign-recentitem" onClick={() => onOpenEntry(record.id)}>
                <CodexIcon iconId="campfire" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{downtimeSummaryLabel(payload)}</span>
                <span className="codex-campaign-recentwhen">{record.inWorldLabel ?? record.realDate ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
