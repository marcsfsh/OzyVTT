/**
 * One way to write a date and its time (theme rule 20, ADR-0074): "Oct 30, 7:40 PM", "Today, 8:41 PM" and "Yesterday,
 * 9:02 AM", with the year only when it isn't this one ("Oct 30, 2025, 7:40 PM"). Written in English with the app's
 * own words, so every list and history reads alike.
 */
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

/** The day alone: "Today", "Yesterday", "Nov 8", or "Nov 8, 2025" in another year. */
export function formatDay(at: Date | string | number, now: Date = new Date()): string {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "None";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}

/** The day and its time: "Today, 8:41 PM", "Oct 30, 7:40 PM". */
export function formatWhen(at: Date | string | number, now: Date = new Date()): string {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "None";
  return `${formatDay(date, now)}, ${TIME.format(date)}`;
}
