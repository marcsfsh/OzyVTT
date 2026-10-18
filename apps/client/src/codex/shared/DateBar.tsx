import { useState } from "react";
import { Button, IconButton, IconEyeOff, cx } from "@vtt/ui";
import { formatWorldDate, weekdayOf, type CodexCalendar, type CodexInWorldDate } from "@vtt/domain";
import { calendarApi } from "../api";
import { sameInWorldDate } from "../chronicle";
import "./shared.css";

/** "Galeday, Emberfall 14, 412 SR", or the day alone in a tight bar ("Emberfall 14"). */
export function worldDateLabel(calendar: CodexCalendar, date: CodexInWorldDate, tight = false): string {
  if (tight) return `${calendar.months[date.month]?.name ?? ""} ${date.day}`;
  const weekday = weekdayOf(calendar, date);
  return `${weekday ? `${weekday}, ` : ""}${formatWorldDate(calendar, date)}`;
}

/**
 * Both dates in one bar for the GM: your date, the players' date and Publish, which copies yours onto theirs. A
 * player's bar has their date alone, as Today. `tight` shortens the words for a phone.
 */
export function DateBar({
  calendar,
  role,
  token,
  tight = false,
  onPublished,
  className
}: Readonly<{
  calendar:
    | (CodexCalendar & Readonly<{ currentDate: CodexInWorldDate | null; publishedDate?: CodexInWorldDate | null }>)
    | null;
  role: "gm" | "player";
  token: string;
  tight?: boolean;
  onPublished?: () => void;
  className?: string;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!calendar) return null;
  const date = (value: CodexInWorldDate | null | undefined) =>
    value ? worldDateLabel(calendar, value, tight) : "No date yet";
  if (role === "player")
    return (
      <div className={cx("cx-datebar", tight && "is-tight", className)}>
        <span className="cx-datebar-key">Today</span>
        <span className="cx-datebar-value">{date(calendar.currentDate)}</span>
      </div>
    );
  const published = calendar.publishedDate ?? null;
  const same = sameInWorldDate(calendar.currentDate, published);
  const change = async (write: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await write();
      onPublished?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  };
  const publish = () => change(() => calendarApi.publish(token), "Couldn't publish the date.");
  // Players then see no date at all until the next Publish.
  const unpublish = () => change(() => calendarApi.unpublish(token), "Couldn't hide the players' date.");
  return (
    <div className={cx("cx-datebar", tight && "is-tight", className)}>
      <span className="cx-datebar-key">{tight ? "Yours" : "Your date"}</span>
      <span className="cx-datebar-value is-gm">{date(calendar.currentDate)}</span>
      <span className="cx-datebar-key">{tight ? "Players" : "Players' date"}</span>
      <span className="cx-datebar-value">{date(published)}</span>
      <span className="cx-grow" />
      {!tight && published && (
        <IconButton label="Hide the date from players" size="sm" disabled={busy} onClick={() => void unpublish()}>
          <IconEyeOff />
        </IconButton>
      )}
      {!tight && (
        <Button size="sm" disabled={busy || same || !calendar.currentDate} onClick={() => void publish()}>
          Publish
        </Button>
      )}
      {error && (
        <span className="cx-datebar-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
