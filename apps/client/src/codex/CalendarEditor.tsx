import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@vtt/ui";
import { calendarApi, type CodexCalendar } from "./api";

/** The GM defines the world's calendar: its months (name + length), weekday names, an era suffix, and "today". */
export function CalendarEditor({ gmToken, calendar, onSaved, onClose }: Readonly<{ gmToken: string; calendar: CodexCalendar; onSaved: (calendar: CodexCalendar) => void; onClose: () => void }>) {
  const [yearName, setYearName] = useState(calendar.yearName);
  const [months, setMonths] = useState(calendar.months.map((month) => ({ name: month.name, days: String(month.days) })));
  const [weekdays, setWeekdays] = useState(calendar.weekdays.join(", "));
  const [curYear, setCurYear] = useState(calendar.currentDate ? String(calendar.currentDate.year) : "");
  const [curMonth, setCurMonth] = useState(calendar.currentDate?.month ?? 0);
  const [curDay, setCurDay] = useState(calendar.currentDate ? String(calendar.currentDate.day) : "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMonth = (index: number, patch: Partial<{ name: string; days: string }>) => setMonths((prev) => prev.map((month, idx) => (idx === index ? { ...month, ...patch } : month)));
  const addMonth = () => setMonths((prev) => [...prev, { name: `Month ${prev.length + 1}`, days: "30" }]);
  const removeMonth = (index: number) => setMonths((prev) => prev.filter((_, idx) => idx !== index));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const calendarInput: CodexCalendar = {
        yearName: yearName.trim(),
        months: months.map((month) => ({ name: month.name.trim() || "Month", days: Math.max(1, Math.trunc(Number(month.days) || 1)) })),
        weekdays: weekdays.split(",").map((day) => day.trim()).filter(Boolean),
        currentDate: curYear.trim() === "" ? null : { year: Math.trunc(Number(curYear) || 0), month: curMonth, day: Math.max(1, Math.trunc(Number(curDay) || 1)) }
      };
      onSaved(await calendarApi.set(gmToken, calendarInput));
      onClose();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Couldn't save the calendar."); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="World calendar" size="md" ariaLabel="World calendar">
      <div className="codex-calendar-editor">
        <Field label="Era suffix" htmlFor="cal-year" help="Shown after the year, e.g. DR or AE"><Input id="cal-year" value={yearName} placeholder="DR" onChange={(event) => setYearName(event.target.value)} /></Field>
        <div className="codex-cal-months">
          <div className="codex-cal-months-head"><strong>Months</strong><Button variant="ghost" size="sm" onClick={addMonth}>+ Add month</Button></div>
          {months.map((month, index) => (
            <div key={index} className="codex-cal-month">
              <Input aria-label={`Month ${index + 1} name`} value={month.name} onChange={(event) => setMonth(index, { name: event.target.value })} />
              <Input aria-label={`Month ${index + 1} length in days`} type="number" inputMode="numeric" value={month.days} onChange={(event) => setMonth(index, { days: event.target.value })} />
              <button type="button" className="codex-rels-remove" aria-label={`Remove month ${index + 1}`} onClick={() => removeMonth(index)}>✕</button>
            </div>
          ))}
        </div>
        <Field label="Weekday names" htmlFor="cal-week" help="Comma-separated, optional — shown in dates when set"><Input id="cal-week" value={weekdays} placeholder="Sul, Mol, Zor, …" onChange={(event) => setWeekdays(event.target.value)} /></Field>
        <Field label="Current date — the world's “now”" htmlFor="cal-cur-year" help="Optional; marks Today on the timeline. Clear the year to unset.">
          <div className="codex-cal-current">
            <Input id="cal-cur-year" aria-label="Current year" type="number" inputMode="numeric" placeholder="Year" value={curYear} onChange={(event) => setCurYear(event.target.value)} />
            <Select aria-label="Current month" value={String(curMonth)} onChange={(event) => setCurMonth(Number(event.target.value))}>
              {months.map((month, index) => <option key={index} value={index}>{month.name || `Month ${index + 1}`}</option>)}
            </Select>
            <Input aria-label="Current day" type="number" inputMode="numeric" placeholder="Day" value={curDay} onChange={(event) => setCurDay(event.target.value)} />
          </div>
        </Field>
        {error && <p className="codex-rail-error" role="alert">{error}</p>}
        <div className="codex-cal-foot"><Button variant="primary" size="sm" disabled={busy || months.length === 0} onClick={save}>Save calendar</Button></div>
      </div>
    </Modal>
  );
}
