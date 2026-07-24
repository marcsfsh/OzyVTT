import { useState } from "react";
import { Button, Field, Input, Modal } from "@vtt/ui";
import { calendarApi, type CodexCalendar } from "./api";

/** The GM defines the world's calendar: its months (name + length), weekday names, and an era suffix. */
export function CalendarEditor({ gmToken, calendar, onSaved, onClose }: Readonly<{ gmToken: string; calendar: CodexCalendar; onSaved: (calendar: CodexCalendar) => void; onClose: () => void }>) {
  const [yearName, setYearName] = useState(calendar.yearName);
  const [months, setMonths] = useState(calendar.months.map((month) => ({ name: month.name, days: String(month.days) })));
  const [weekdays, setWeekdays] = useState(calendar.weekdays.join(", "));
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
        weekdays: weekdays.split(",").map((day) => day.trim()).filter(Boolean)
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
        <Field label="Weekday names" htmlFor="cal-week" help="Comma-separated, optional"><Input id="cal-week" value={weekdays} placeholder="Sul, Mol, Zor, …" onChange={(event) => setWeekdays(event.target.value)} /></Field>
        {error && <p className="codex-rail-error" role="alert">{error}</p>}
        <div className="codex-cal-foot"><Button variant="primary" size="sm" disabled={busy || months.length === 0} onClick={save}>Save calendar</Button></div>
      </div>
    </Modal>
  );
}
