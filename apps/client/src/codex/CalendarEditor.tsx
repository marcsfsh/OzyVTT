import { useState } from "react";
import { Alert, Button, Field, IconButton, IconPlus, IconX, Input, Modal, Select } from "@vtt/ui";
import { calendarApi, type CodexCalendar } from "./api";

/** The GM defines the world's calendar: its months (name + length), weekday names, an era suffix, and "today". */
export function CalendarEditor({ gmToken, calendar, onSaved, onClose }: Readonly<{ gmToken: string; calendar: CodexCalendar | null; onSaved: (calendar: CodexCalendar) => void; onClose: () => void }>) {
  // A missing calendar is a legitimate first-run state (D17 gives the section a real empty state),
  // so the editor seeds itself from the system default rather than refusing to open.
  const seed: CodexCalendar = calendar ?? { yearName: "", months: [{ name: "Month 1", days: 30 }], weekdays: [], currentDate: null };
  const [yearName, setYearName] = useState(seed.yearName);
  const [months, setMonths] = useState(seed.months.map((month) => ({ name: month.name, days: String(month.days) })));
  const [weekdays, setWeekdays] = useState(seed.weekdays.join(", "));
  const [curYear, setCurYear] = useState(seed.currentDate ? String(seed.currentDate.year) : "");
  const [curMonth, setCurMonth] = useState(seed.currentDate?.month ?? 0);
  const [curDay, setCurDay] = useState(seed.currentDate ? String(seed.currentDate.day) : "1");
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
    <Modal open onClose={onClose} title="Calendar" size="md" ariaLabel="Calendar">
      <div className="codex-calendar-editor">
        <Field label="Era suffix" htmlFor="cal-year" help="Shown after the year, e.g. DR or AE"><Input id="cal-year" value={yearName} placeholder="DR" onChange={(event) => setYearName(event.target.value)} /></Field>
        <div className="codex-cal-months">
          <div className="codex-cal-months-head"><strong>Months</strong><Button variant="ghost" size="sm" onClick={addMonth}><IconPlus /> Add month</Button></div>
          {months.map((month, index) => (
            <div key={index} className="codex-cal-month">
              <Input aria-label={`Month ${index + 1} name`} value={month.name} onChange={(event) => setMonth(index, { name: event.target.value })} />
              <Input aria-label={`Month ${index + 1} length in days`} type="number" inputMode="numeric" value={month.days} onChange={(event) => setMonth(index, { days: event.target.value })} />
              <IconButton label={`Remove month ${index + 1}`} size="sm" onClick={() => removeMonth(index)}><IconX /></IconButton>
            </div>
          ))}
        </div>
        <Field label="Weekday names" htmlFor="cal-week" help="Comma-separated, optional — shown in dates when set"><Input id="cal-week" value={weekdays} placeholder="Sul, Mol, Zor, …" onChange={(event) => setWeekdays(event.target.value)} /></Field>
        <Field label="Your date" htmlFor="cal-cur-year" help="The GM's own clock — what a new record is dated at. Players only see it once you publish. Clear the year to unset.">
          <div className="codex-cal-current">
            <Input id="cal-cur-year" aria-label="Current year" type="number" inputMode="numeric" placeholder="Year" value={curYear} onChange={(event) => setCurYear(event.target.value)} />
            <Select aria-label="Current month" value={String(curMonth)} onChange={(event) => setCurMonth(Number(event.target.value))}>
              {months.map((month, index) => <option key={index} value={index}>{month.name || `Month ${index + 1}`}</option>)}
            </Select>
            <Input aria-label="Current day" type="number" inputMode="numeric" placeholder="Day" value={curDay} onChange={(event) => setCurDay(event.target.value)} />
          </div>
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="codex-cal-foot"><Button variant="primary" size="sm" disabled={busy || months.length === 0} onClick={save}>Save calendar</Button></div>
      </div>
    </Modal>
  );
}
