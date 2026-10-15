import { Field, Input, Select } from "@vtt/ui";
import type { CodexCalendarMonth, CodexInWorldDate } from "@vtt/domain";

/** A date as typed: strings, so a half-typed year isn't coerced and saved. */
export type DateDraft = Readonly<{ dateYear: string; dateMonth: string; dateDay: string }>;

export function dateDraftOf(date: CodexInWorldDate | null): DateDraft {
  return date
    ? { dateYear: String(date.year), dateMonth: String(date.month), dateDay: String(date.day) }
    : { dateYear: "", dateMonth: "0", dateDay: "" };
}

/** The typed date, or null while the year is blank. */
export function dateOfDraft(draft: DateDraft): CodexInWorldDate | null {
  if (!draft.dateYear.trim()) return null;
  return {
    year: Math.trunc(Number(draft.dateYear) || 0),
    month: Number(draft.dateMonth || 0),
    day: Math.max(1, Math.trunc(Number(draft.dateDay) || 1))
  };
}

/** Year, month and day for an in-world date. Month and day wait for a year. The caller lays out the row. */
export function InWorldDateFields({
  idPrefix,
  draft,
  months,
  onChange,
  yearHelp
}: Readonly<{
  idPrefix: string;
  draft: DateDraft;
  months: readonly CodexCalendarMonth[];
  onChange: (patch: Partial<DateDraft>) => void;
  yearHelp?: string;
}>) {
  const undated = !draft.dateYear.trim();
  return (
    <>
      <Field label="Year" htmlFor={`${idPrefix}-year`} help={yearHelp}>
        <Input
          id={`${idPrefix}-year`}
          type="number"
          inputMode="numeric"
          value={draft.dateYear}
          placeholder="1492"
          onChange={(event) => onChange({ dateYear: event.target.value })}
        />
      </Field>
      <Field label="Month" htmlFor={`${idPrefix}-month`}>
        <Select
          id={`${idPrefix}-month`}
          value={draft.dateMonth}
          disabled={undated}
          onChange={(event) => onChange({ dateMonth: event.target.value })}
        >
          {months.map((month, index) => (
            <option key={index} value={String(index)}>
              {month.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Day" htmlFor={`${idPrefix}-day`}>
        <Input
          id={`${idPrefix}-day`}
          type="number"
          inputMode="numeric"
          value={draft.dateDay}
          placeholder="1"
          disabled={undated}
          onChange={(event) => onChange({ dateDay: event.target.value })}
        />
      </Field>
    </>
  );
}
