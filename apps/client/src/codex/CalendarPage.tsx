import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Crumb,
  Field,
  IconButton,
  IconDrag,
  IconEyeOff,
  IconPlus,
  IconX,
  Input,
  SaveState,
  SideListGroup,
  SideListRow,
  Skeleton,
  type SaveStatus
} from "@vtt/ui";
import { formatWorldDate, type CodexCalendar, type CodexCalendarMove, type GmCodexCalendar } from "@vtt/domain";
import { newId } from "../lib/ids";
import { calendarApi } from "./api";
import { CampaignDateEditor, calendarBody, toYear } from "./CalendarEditor";
import { useReorder } from "./prep/reorder";
import { CodexPhoneBar } from "./shell/PhoneBar";
import "./templates/templates.css";
import "./calendar-page.css";

export const CALENDAR_PARTS = ["months", "eras", "weekdays", "suffix", "yours", "players"] as const;
export type CalendarPart = (typeof CALENDAR_PARTS)[number];

export const calendarPartOf = (raw: string | null): CalendarPart =>
  CALENDAR_PARTS.find((part) => part === raw) ?? "months";

type Row = Readonly<{ id: string; name: string }>;
type MonthRow = Readonly<{ id: string; name: string; days: string }>;
type EraRow = Readonly<{ id: string; name: string; startYear: string }>;
type Draft = Readonly<{
  yearName: string;
  months: readonly MonthRow[];
  eras: readonly EraRow[];
  weekdays: readonly Row[];
}>;

const draftOf = (calendar: CodexCalendar | null): Draft => ({
  yearName: calendar?.yearName ?? "",
  months: (calendar?.months ?? [{ name: "Month 1", days: 30 }]).map((month) => ({
    id: newId(),
    name: month.name,
    days: String(month.days)
  })),
  eras: (calendar?.eras ?? []).map((era) => ({ id: newId(), name: era.name, startYear: String(era.startYear) })),
  weekdays: (calendar?.weekdays ?? []).map((name) => ({ id: newId(), name }))
});

/** The PUT body for a draft, with the GM's date carried through: the date has its own small dialog. */
const bodyOf = (draft: Draft, currentDate: CodexCalendar["currentDate"]): CodexCalendar =>
  calendarBody({
    yearName: draft.yearName.trim(),
    // A nameless era is an untouched Add row, never an era called "Era".
    eras: draft.eras
      .map((era) => ({ name: era.name.trim(), startYear: toYear(era.startYear) }))
      .filter((era) => era.name !== ""),
    months: draft.months.map((month) => ({
      name: month.name.trim() || "Month",
      days: Math.max(1, Math.trunc(Number(month.days) || 1))
    })),
    weekdays: draft.weekdays.map((day) => day.name.trim()).filter(Boolean),
    currentDate: currentDate ?? null
  });

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;
const ERAS_LINE =
  "A year belongs to the last era it has reached, so an era leads the year: Third Age 1492. Records already dated " +
  "are re-labelled; their dates do not move.";

/** How long typing rests before the calendar saves. */
const SAVE_AFTER_MS = 700;

/**
 * The calendar as its own page (F time spec 2.4): CALENDAR (months, eras, weekdays, the year suffix) and DATES (yours
 * and the players') at the side, the chosen part's rows at the right. It saves as you go through today's
 * `PUT /codex/calendar`, after today's check: a change that moves dates players can see waits under the rows until
 * the GM saves it anyway or undoes it. Your date keeps its small dialog. GM-only.
 */
export function CalendarPage({
  gmToken,
  phone,
  part,
  onPart,
  onBack
}: Readonly<{
  gmToken: string;
  phone: boolean;
  part: CalendarPart;
  onPart: (part: CalendarPart) => void;
  onBack: () => void;
}>) {
  const [saved, setSaved] = useState<GmCodexCalendar | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(null));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Readonly<{ body: CodexCalendar; moves: readonly CodexCalendarMove[] }> | null>(
    null
  );
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    let live = true;
    calendarApi
      .get(gmToken)
      .then((calendar) => {
        if (!live) return;
        setSaved(calendar);
        setDraft(draftOf(calendar));
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "Couldn't load the calendar.");
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [gmToken]);

  const commit = useCallback(
    async (body: CodexCalendar) => {
      setStatus("saving");
      setPending(null);
      try {
        setSaved(await calendarApi.set(gmToken, body));
        setStatus("saved");
        setError(null);
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Couldn't save the calendar.");
      }
    },
    [gmToken]
  );

  const save = useCallback(async () => {
    dirtyRef.current = false;
    const body = bodyOf(draft, saved?.currentDate ?? null);
    try {
      // Ask first when the new shape would move a date players can already see.
      const moves = await calendarApi.check(gmToken, body);
      if (dirtyRef.current) return;
      if (moves.length > 0) {
        setPending({ body, moves });
        setStatus("dirty");
        return;
      }
      await commit(body);
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Couldn't save the calendar.");
    }
  }, [draft, saved, gmToken, commit]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => void save(), SAVE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [draft, save]);

  const edit = (next: (prev: Draft) => Draft) => {
    dirtyRef.current = true;
    setPending(null);
    setStatus("dirty");
    setDraft(next);
  };
  const undo = () => {
    dirtyRef.current = false;
    setPending(null);
    setStatus("saved");
    setDraft(draftOf(saved));
  };

  const datesAct = async (run: () => Promise<GmCodexCalendar>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      setSaved(await run());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const shown: CodexCalendar = bodyOf(draft, saved?.currentDate ?? null);
  const yearDays = shown.months.reduce((sum, month) => sum + month.days, 0);
  const now = saved?.currentDate ?? null;
  const published = saved?.publishedDate ?? null;

  const parts: ReadonlyArray<
    Readonly<{ part: CalendarPart; label: string; count: string; group: "calendar" | "dates" }>
  > = [
    { part: "months", label: "Months", count: String(draft.months.length), group: "calendar" },
    { part: "eras", label: "Eras", count: String(draft.eras.length), group: "calendar" },
    { part: "weekdays", label: "Weekdays", count: String(draft.weekdays.length), group: "calendar" },
    { part: "suffix", label: "Year suffix", count: draft.yearName.trim() || "None", group: "calendar" },
    { part: "yours", label: "Your date", count: "", group: "dates" },
    { part: "players", label: "Players' date", count: "", group: "dates" }
  ];

  const side = phone ? (
    <div className="nh-filterchips" role="group" aria-label="Calendar parts">
      {parts.map((each) => (
        <button
          key={each.part}
          type="button"
          className={`nh-filterchip interactive${each.part === part ? " is-on" : ""}`}
          aria-pressed={each.part === part}
          onClick={() => onPart(each.part)}
        >
          {each.label} {each.count && <span className="cx-tag-n">{each.count}</span>}
        </button>
      ))}
    </div>
  ) : (
    <>
      {(["calendar", "dates"] as const).map((group) => (
        <SideListGroup key={group} eyebrow={group === "calendar" ? "Calendar" : "Dates"} className="cal-sidelist">
          {parts
            .filter((each) => each.group === group)
            .map((each) => (
              <SideListRow
                key={each.part}
                label={each.label}
                count={each.count || undefined}
                current={each.part === part}
                onSelect={() => onPart(each.part)}
              />
            ))}
        </SideListGroup>
      ))}
    </>
  );

  const warning = pending && (
    <Alert tone="warning" title="This moves dates players can see">
      <ul className="codex-cal-moves">
        {pending.moves.map((move) => (
          <li key={`${move.kind}:${move.id}`}>
            <strong>{move.title}</strong>{" "}
            {move.unpasses
              ? `reads as approaching again (${move.after})`
              : `moves from ${move.before} to ${move.after}`}
          </li>
        ))}
      </ul>
      The raw dates are kept, so a later calendar can put them back.
      <span className="cal-warning-actions">
        <Button variant="ghost" size="sm" onClick={undo}>
          Undo the change
        </Button>
        <Button variant="primary" size="sm" onClick={() => void commit(pending.body)}>
          Save anyway
        </Button>
      </span>
    </Alert>
  );

  const body = !loaded ? (
    <Skeleton variant="text" />
  ) : (
    <CalendarPartView
      part={part}
      draft={draft}
      yearDays={yearDays}
      shown={shown}
      now={now}
      published={published}
      busy={busy}
      edit={edit}
      onChangeDate={() => setDateOpen(true)}
      onPublish={() => void datesAct(() => calendarApi.publish(gmToken), "Couldn't publish the date.")}
      onUnpublish={() => void datesAct(() => calendarApi.unpublish(gmToken), "Couldn't hide the players' date.")}
    />
  );

  return (
    <div className={`cal-page${phone ? " is-phone" : ""}`}>
      {phone ? (
        <CodexPhoneBar back={{ label: "Story", onClick: onBack }} title="Calendar" />
      ) : (
        <header className="cal-head">
          <Crumb label="Story" onClick={onBack} />
          <h2 className="cal-title">Calendar</h2>
          <span className="cal-grow" />
          <SaveState status={status} onRetry={() => void save()} />
        </header>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="cal-cols">
        <nav className="cal-nav scroll-y" aria-label="Calendar parts">
          {side}
        </nav>
        <section className="cal-main scroll-y" aria-label={parts.find((each) => each.part === part)?.label}>
          {body}
          {warning}
        </section>
      </div>
      {dateOpen && saved && (
        <CampaignDateEditor
          gmToken={gmToken}
          calendar={saved}
          onSaved={(calendar) => {
            setSaved(calendar as GmCodexCalendar);
            setDateOpen(false);
          }}
          onClose={() => setDateOpen(false)}
        />
      )}
    </div>
  );
}

/** The chosen part: its name with its action, one line, then its rows. */
function CalendarPartView({
  part,
  draft,
  yearDays,
  shown,
  now,
  published,
  busy,
  edit,
  onChangeDate,
  onPublish,
  onUnpublish
}: Readonly<{
  part: CalendarPart;
  draft: Draft;
  yearDays: number;
  shown: CodexCalendar;
  now: CodexCalendar["currentDate"];
  published: CodexCalendar["currentDate"];
  busy: boolean;
  edit: (next: (prev: Draft) => Draft) => void;
  onChangeDate: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
}>) {
  const months = useReorder(
    draft.months,
    (next) => edit((prev) => ({ ...prev, months: next })),
    (month) => month.name || "Month"
  );
  const patch = <K extends "months" | "eras" | "weekdays">(key: K, id: string, change: Partial<Draft[K][number]>) =>
    edit((prev) => ({
      ...prev,
      [key]: (prev[key] as readonly { id: string }[]).map((row) => (row.id === id ? { ...row, ...change } : row))
    }));
  const remove = (key: "months" | "eras" | "weekdays", id: string) =>
    edit((prev) => ({ ...prev, [key]: (prev[key] as readonly { id: string }[]).filter((row) => row.id !== id) }));

  switch (part) {
    case "months":
      return (
        <>
          <PartHead
            title="Months"
            line={`${plural(draft.months.length, "month")} · a year of ${yearDays} days`}
            action="Add month"
            onAction={() =>
              edit((prev) => ({
                ...prev,
                months: [...prev.months, { id: newId(), name: `Month ${prev.months.length + 1}`, days: "30" }]
              }))
            }
          />
          <p className="cal-hint" id="cal-months-hint">
            Drag a month by its handle, or press Alt and an arrow key, to change the order.
          </p>
          <ol className="cal-rows" ref={(element) => void (months.listRef.current = element)} aria-label="Months">
            {months.shown.map((month, index) => (
              <li
                key={month.id}
                data-reorder-row
                className={`cal-row${months.draggingIndex === index ? " is-dragging" : ""}`}
                onKeyDown={months.onRowKeyDown(index)}
              >
                <button
                  type="button"
                  className="tpl-handle"
                  aria-label={`Move ${month.name || `month ${index + 1}`}`}
                  aria-describedby="cal-months-hint"
                  {...months.handleProps(index)}
                >
                  <IconDrag />
                </button>
                <Input
                  aria-label={`Month ${index + 1} name`}
                  value={month.name}
                  onChange={(event) => patch("months", month.id, { name: event.target.value })}
                />
                <Input
                  aria-label={`Month ${index + 1} length in days`}
                  className="cal-days"
                  type="number"
                  inputMode="numeric"
                  value={month.days}
                  onChange={(event) => patch("months", month.id, { days: event.target.value })}
                />
                <IconButton
                  label={`Remove month ${index + 1}`}
                  size="sm"
                  disabled={draft.months.length <= 1}
                  onClick={() => remove("months", month.id)}
                >
                  <IconX />
                </IconButton>
              </li>
            ))}
          </ol>
          <span className="nh-sr-only" role="status">
            {months.announcement}
          </span>
        </>
      );
    case "eras":
      return (
        <>
          <PartHead
            title="Eras"
            line={ERAS_LINE}
            action="Add era"
            onAction={() =>
              edit((prev) => ({
                ...prev,
                eras: [...prev.eras, { id: newId(), name: "", startYear: String(now?.year ?? 0) }]
              }))
            }
          />
          {draft.eras.length === 0 ? (
            <p className="cal-hint">No eras. Years read on their own.</p>
          ) : (
            <ul className="cal-rows" aria-label="Eras">
              {draft.eras.map((era, index) => (
                <li key={era.id} className="cal-row">
                  <Input
                    aria-label={`Era ${index + 1} name`}
                    value={era.name}
                    placeholder="Third Age"
                    onChange={(event) => patch("eras", era.id, { name: event.target.value })}
                  />
                  <Input
                    aria-label={`Era ${index + 1} first year`}
                    className="cal-days"
                    type="number"
                    inputMode="numeric"
                    placeholder="Year"
                    value={era.startYear}
                    onChange={(event) => patch("eras", era.id, { startYear: event.target.value })}
                  />
                  <IconButton label={`Remove era ${index + 1}`} size="sm" onClick={() => remove("eras", era.id)}>
                    <IconX />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case "weekdays":
      return (
        <>
          <PartHead
            title="Weekdays"
            line={
              draft.weekdays.length === 0
                ? "No weekday names. Dates read without them."
                : `A week of ${draft.weekdays.length} days, shown in dates.`
            }
            action="Add weekday"
            onAction={() => edit((prev) => ({ ...prev, weekdays: [...prev.weekdays, { id: newId(), name: "" }] }))}
          />
          {draft.weekdays.length > 0 && (
            <ul className="cal-rows" aria-label="Weekdays">
              {draft.weekdays.map((day, index) => (
                <li key={day.id} className="cal-row">
                  <Input
                    aria-label={`Weekday ${index + 1} name`}
                    value={day.name}
                    placeholder="Sul"
                    onChange={(event) => patch("weekdays", day.id, { name: event.target.value })}
                  />
                  <IconButton
                    label={`Remove weekday ${index + 1}`}
                    size="sm"
                    onClick={() => remove("weekdays", day.id)}
                  >
                    <IconX />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case "suffix":
      return (
        <>
          <PartHead title="Year suffix" line="Optional, shown after every year, such as DR. The eras are separate." />
          <Field label="Year suffix" htmlFor="cal-page-suffix">
            <Input
              id="cal-page-suffix"
              value={draft.yearName}
              placeholder="DR"
              onChange={(event) => {
                const yearName = event.target.value;
                edit((prev) => ({ ...prev, yearName }));
              }}
            />
          </Field>
        </>
      );
    case "yours":
      return (
        <>
          <PartHead
            title="Your date"
            line="The date a new record is given. Players see it only after you publish it."
            action={now ? "Change your date" : "Set your date"}
            onAction={onChangeDate}
          />
          <p className="cal-date">{now ? formatWorldDate(shown, now) : "Not set"}</p>
        </>
      );
    case "players":
      return (
        <>
          <PartHead
            title="Players' date"
            line="Only ever a published copy of your date. Publish is the one way to move it."
          />
          <p className="cal-date is-players">{published ? formatWorldDate(shown, published) : "Not shared yet"}</p>
          <span className="cal-date-actions">
            <Button variant="secondary" size="sm" disabled={busy || !now} onClick={onPublish}>
              Publish your date
            </Button>
            {published && (
              <Button size="sm" disabled={busy} onClick={onUnpublish}>
                <IconEyeOff /> Hide the date from players
              </Button>
            )}
          </span>
        </>
      );
  }
}

function PartHead({
  title,
  line,
  action,
  onAction
}: Readonly<{ title: string; line: string; action?: string; onAction?: () => void }>) {
  return (
    <>
      <div className="cal-part-head">
        <h3 className="cal-part-title">{title}</h3>
        {action && onAction && (
          <Button size="sm" onClick={onAction}>
            {action.startsWith("Add") && <IconPlus />} {action}
          </Button>
        )}
      </div>
      <p className="cal-part-line">{line}</p>
    </>
  );
}
