import { useState } from "react";
import { Alert, Button, Field, IconButton, IconPlus, IconX, Input, Modal, Select } from "@vtt/ui";
import { calendarApi, formatWorldDate, type CodexCalendar, type CodexCalendarEra } from "./api";

type EraDraft = Readonly<{ name: string; startYear: string }>;

/** A numeric draft field back to an integer, as the server does. */
const toYear = (raw: string) => Math.trunc(Number(raw) || 0);

/**
 * Build the PUT body from explicit keys, never by spreading the fetched calendar: it may carry
 * `publishedDate`, which the strict `CalendarSchema` rejects.
 */
function calendarBody(
  over: Readonly<{
    yearName: string;
    eras: readonly CodexCalendarEra[];
    months: CodexCalendar["months"];
    weekdays: readonly string[];
    currentDate: CodexCalendar["currentDate"];
  }>
): CodexCalendar {
  return {
    yearName: over.yearName,
    eras: over.eras,
    months: over.months,
    weekdays: over.weekdays,
    currentDate: over.currentDate ?? null
  };
}

/** The world's calendar: months, weekday names, eras and the GM's date. */
export function CalendarEditor({
  gmToken,
  calendar,
  onSaved,
  onClose
}: Readonly<{
  gmToken: string;
  calendar: CodexCalendar | null;
  onSaved: (calendar: CodexCalendar) => void;
  onClose: () => void;
}>) {
  // No calendar yet is a legitimate first run, so seed a default.
  const seed: CodexCalendar = calendar ?? {
    yearName: "",
    eras: [],
    months: [{ name: "Month 1", days: 30 }],
    weekdays: [],
    currentDate: null
  };
  const [yearName, setYearName] = useState(seed.yearName);
  const [eras, setEras] = useState<readonly EraDraft[]>(
    (seed.eras ?? []).map((era) => ({ name: era.name, startYear: String(era.startYear) }))
  );
  const [months, setMonths] = useState(seed.months.map((month) => ({ name: month.name, days: String(month.days) })));
  const [weekdays, setWeekdays] = useState(seed.weekdays.join(", "));
  const [curYear, setCurYear] = useState(seed.currentDate ? String(seed.currentDate.year) : "");
  const [curMonth, setCurMonth] = useState(seed.currentDate?.month ?? 0);
  const [curDay, setCurDay] = useState(seed.currentDate ? String(seed.currentDate.day) : "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMonth = (index: number, patch: Partial<{ name: string; days: string }>) =>
    setMonths((prev) => prev.map((month, idx) => (idx === index ? { ...month, ...patch } : month)));
  const addMonth = () => setMonths((prev) => [...prev, { name: `Month ${prev.length + 1}`, days: "30" }]);
  const removeMonth = (index: number) => setMonths((prev) => prev.filter((_, idx) => idx !== index));
  const setEra = (index: number, patch: Partial<EraDraft>) =>
    setEras((prev) => prev.map((era, idx) => (idx === index ? { ...era, ...patch } : era)));
  const addEra = () => setEras((prev) => [...prev, { name: "", startYear: curYear.trim() || "0" }]);
  const removeEra = (index: number) => setEras((prev) => prev.filter((_, idx) => idx !== index));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const calendarInput = calendarBody({
        yearName: yearName.trim(),
        // Drop nameless eras: an untouched Add row would otherwise become "Era" via the server's fallback.
        eras: eras
          .map((era) => ({ name: era.name.trim(), startYear: toYear(era.startYear) }))
          .filter((era) => era.name !== ""),
        months: months.map((month) => ({
          name: month.name.trim() || "Month",
          days: Math.max(1, Math.trunc(Number(month.days) || 1))
        })),
        weekdays: weekdays
          .split(",")
          .map((day) => day.trim())
          .filter(Boolean),
        currentDate:
          curYear.trim() === ""
            ? null
            : { year: toYear(curYear), month: curMonth, day: Math.max(1, Math.trunc(Number(curDay) || 1)) }
      });
      onSaved(await calendarApi.set(gmToken, calendarInput));
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn't save the calendar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Calendar" size="md" ariaLabel="Calendar">
      <div className="codex-calendar-editor">
        <div className="codex-cal-months">
          <div className="codex-cal-months-head">
            <strong>Eras</strong>
            <Button variant="ghost" size="sm" onClick={addEra}>
              <IconPlus /> Add era
            </Button>
          </div>
          {/* Eras are derived from the year, so adding one relabels existing history; the help says so. */}
          <p className="nh-field-help">
            A year belongs to the last era it has reached, so an era leads the year: <em>Third Age 1492</em>. Records
            already dated are re-labelled; their dates do not move.
          </p>
          {eras.length === 0 ? (
            <p className="codex-list-empty">No eras. Years read on their own.</p>
          ) : (
            eras.map((era, index) => (
              <div key={index} className="codex-cal-month">
                <Input
                  aria-label={`Era ${index + 1} name`}
                  value={era.name}
                  placeholder="Third Age"
                  onChange={(event) => setEra(index, { name: event.target.value })}
                />
                <Input
                  aria-label={`Era ${index + 1} first year`}
                  type="number"
                  inputMode="numeric"
                  placeholder="Year"
                  value={era.startYear}
                  onChange={(event) => setEra(index, { startYear: event.target.value })}
                />
                <IconButton label={`Remove era ${index + 1}`} size="sm" onClick={() => removeEra(index)}>
                  <IconX />
                </IconButton>
              </div>
            ))
          )}
        </div>
        <Field
          label="Era suffix"
          htmlFor="cal-year"
          help="Optional, shown after every year, e.g. DR or AE. Independent of the eras above."
        >
          <Input
            id="cal-year"
            value={yearName}
            placeholder="DR"
            onChange={(event) => setYearName(event.target.value)}
          />
        </Field>
        <div className="codex-cal-months">
          <div className="codex-cal-months-head">
            <strong>Months</strong>
            <Button variant="ghost" size="sm" onClick={addMonth}>
              <IconPlus /> Add month
            </Button>
          </div>
          {months.map((month, index) => (
            <div key={index} className="codex-cal-month">
              <Input
                aria-label={`Month ${index + 1} name`}
                value={month.name}
                onChange={(event) => setMonth(index, { name: event.target.value })}
              />
              <Input
                aria-label={`Month ${index + 1} length in days`}
                type="number"
                inputMode="numeric"
                value={month.days}
                onChange={(event) => setMonth(index, { days: event.target.value })}
              />
              <IconButton label={`Remove month ${index + 1}`} size="sm" onClick={() => removeMonth(index)}>
                <IconX />
              </IconButton>
            </div>
          ))}
        </div>
        <Field label="Weekday names" htmlFor="cal-week" help="Optional, comma-separated. Shown in dates when set.">
          <Input
            id="cal-week"
            value={weekdays}
            placeholder="Sul, Mol, Zor"
            onChange={(event) => setWeekdays(event.target.value)}
          />
        </Field>
        <Field
          label="Your date"
          htmlFor="cal-cur-year"
          help="The date a new record is given. Players see it only after you publish it. Clear the year to unset the date."
        >
          <div className="codex-cal-current">
            <Input
              id="cal-cur-year"
              aria-label="Current year"
              type="number"
              inputMode="numeric"
              placeholder="Year"
              value={curYear}
              onChange={(event) => setCurYear(event.target.value)}
            />
            <Select
              aria-label="Current month"
              value={String(curMonth)}
              onChange={(event) => setCurMonth(Number(event.target.value))}
            >
              {months.map((month, index) => (
                <option key={index} value={index}>
                  {month.name || `Month ${index + 1}`}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Current day"
              type="number"
              inputMode="numeric"
              placeholder="Day"
              value={curDay}
              onChange={(event) => setCurDay(event.target.value)}
            />
          </div>
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="codex-cal-foot">
          <Button variant="primary" size="sm" disabled={busy || months.length === 0} onClick={save}>
            Save calendar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The GM's clock on its own. Writes through the same `PUT /codex/calendar`, carrying the structure through
 * unchanged and touching only `currentDate`. Never publishes.
 */
export function CampaignDateEditor({
  gmToken,
  calendar,
  onSaved,
  onClose
}: Readonly<{
  gmToken: string;
  calendar: CodexCalendar;
  onSaved: (calendar: CodexCalendar) => void;
  onClose: () => void;
}>) {
  const [year, setYear] = useState(calendar.currentDate ? String(calendar.currentDate.year) : "");
  const [month, setMonth] = useState(calendar.currentDate?.month ?? 0);
  const [day, setDay] = useState(calendar.currentDate ? String(calendar.currentDate.day) : "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async (currentDate: CodexCalendar["currentDate"]) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await calendarApi.set(
          gmToken,
          calendarBody({
            yearName: calendar.yearName,
            eras: calendar.eras ?? [],
            months: calendar.months,
            weekdays: calendar.weekdays,
            currentDate
          })
        )
      );
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn't set the date.");
    } finally {
      setBusy(false);
    }
  };
  const parsed =
    year.trim() === "" ? null : { year: toYear(year), month, day: Math.max(1, Math.trunc(Number(day) || 1)) };

  return (
    <Modal open onClose={onClose} title="Your date" size="sm" ariaLabel="Your date">
      <div className="codex-calendar-editor">
        <Field
          label="Your date"
          htmlFor="date-year"
          help="The date a new record is given. Players see it only after you publish it."
        >
          <div className="codex-cal-current">
            <Input
              id="date-year"
              aria-label="Year"
              type="number"
              inputMode="numeric"
              placeholder="Year"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
            <Select aria-label="Month" value={String(month)} onChange={(event) => setMonth(Number(event.target.value))}>
              {calendar.months.map((each, index) => (
                <option key={index} value={index}>
                  {each.name || `Month ${index + 1}`}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Day"
              type="number"
              inputMode="numeric"
              placeholder="Day"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>
        </Field>
        {/* Read the typed numbers back as a date, era and weekday included. */}
        {parsed && (
          <p className="codex-composer-hint">
            Reads as <strong>{formatWorldDate(calendar, parsed)}</strong>.
          </p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="codex-cal-foot">
          <Button variant="primary" size="sm" disabled={busy || parsed === null} onClick={() => void write(parsed)}>
            Set the date
          </Button>
          {/* An undated campaign is a legitimate state. */}
          {calendar.currentDate && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void write(null)}>
              Clear the date
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
