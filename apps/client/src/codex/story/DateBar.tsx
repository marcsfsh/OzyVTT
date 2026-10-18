import { useState } from "react";
import { Alert, Button, IconButton, IconEyeOff, useToast } from "@vtt/ui";
import { formatWorldDate, type CodexCalendar, type CodexInWorldDate, type GmCodexCalendar } from "@vtt/domain";
import { calendarApi } from "../api";
import { CalendarEditor, CampaignDateEditor } from "../CalendarEditor";
import { sameInWorldDate } from "../chronicle";
import { hourLabel } from "../../rest/game-date";

/**
 * A date as the bar shows it: "Emberfall 15" while both dates share a year, since the month below names the year.
 * Across a year the full date shows, so the two never read as the same day.
 */
function barDate(calendar: CodexCalendar, date: CodexInWorldDate, other: CodexInWorldDate | null): string {
  if (other && other.year !== date.year) return formatWorldDate(calendar, date);
  return `${calendar.months[date.month]?.name ?? ""} ${date.day}`;
}

/**
 * Both dates in one bar. Your date is the GM's, violet because only the GM sees it, and it opens a date editor;
 * the players' date is only ever a published copy of it, so Publish is the one way to move theirs. Publish is always
 * shown, and off with a reason while the two agree.
 */
export function GmDateBar({
  gmToken,
  calendar,
  gameHours = null,
  tight = false,
  onChanged
}: Readonly<{
  gmToken: string;
  calendar: GmCodexCalendar | null;
  /** The game clock's hour, which goes with your date. */
  gameHours?: number | null;
  /** A phone's bar: the two dates and Publish, in less room. */
  tight?: boolean;
  onChanged: () => void | Promise<void>;
}>) {
  const { toast } = useToast();
  const [dateOpen, setDateOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = calendar?.currentDate ?? null;
  const published = calendar?.publishedDate ?? null;
  const same = sameInWorldDate(now, published);

  const publish = async () => {
    if (!calendar) return;
    // Name the date before the round trip, so the notice says what was published.
    const shown = now ? formatWorldDate(calendar, now) : null;
    setBusy(true);
    setError(null);
    try {
      await calendarApi.publish(gmToken);
      await onChanged();
      toast(shown ? `Players now see ${shown}.` : "The date is published to players.", { tone: "success" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't publish the date.");
    } finally {
      setBusy(false);
    }
  };

  // Players then see no date at all until the next Publish.
  const unpublish = async () => {
    setBusy(true);
    setError(null);
    try {
      await calendarApi.unpublish(gmToken);
      await onChanged();
      toast("Players no longer see a date.", { tone: "success" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't hide the players' date.");
    } finally {
      setBusy(false);
    }
  };

  if (!calendar || calendar.months.length === 0)
    return (
      <div className={`story-datebar${tight ? " is-tight" : ""}`}>
        <span className="story-hint">The world has no calendar yet.</span>
        <Button variant="secondary" size="sm" onClick={() => setEditorOpen(true)}>
          Set up the calendar
        </Button>
        {editorOpen && (
          <CalendarEditor
            gmToken={gmToken}
            calendar={calendar}
            onSaved={() => {
              setEditorOpen(false);
              void onChanged();
            }}
            onClose={() => setEditorOpen(false)}
          />
        )}
      </div>
    );

  return (
    <div className={`story-datebar${tight ? " is-tight" : ""}`} aria-label="The two dates" role="group">
      <span className="story-datebar-part is-gm">
        <span className="story-datebar-key">Yours</span>
        <button
          type="button"
          className="story-datebar-date is-gm"
          aria-label={now ? `Your date is ${formatWorldDate(calendar, now)}. Change it.` : "Set your date"}
          title={now ? formatWorldDate(calendar, now) : undefined}
          onClick={() => setDateOpen(true)}
        >
          {now ? barDate(calendar, now, published) : "Set your date"}
        </button>
        {now && gameHours !== null && <span className="story-datebar-hour">{hourLabel(gameHours)}</span>}
        <span className="story-hiddenword">
          <IconEyeOff /> Hidden
        </span>
      </span>
      <span className="story-datebar-part">
        <span className="story-datebar-key">Players</span>
        <strong className="story-datebar-date" title={published ? formatWorldDate(calendar, published) : undefined}>
          {published ? barDate(calendar, published, now) : "Not shared yet"}
        </strong>
      </span>
      <span className="story-datebar-actions">
        <Button variant="secondary" size="sm" disabled={busy || same} onClick={() => void publish()}>
          Publish
        </Button>
        {published && (
          <IconButton label="Hide the date from players" size="sm" disabled={busy} onClick={() => void unpublish()}>
            <IconEyeOff />
          </IconButton>
        )}
        <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>
          Edit calendar
        </Button>
      </span>
      {!tight && (
        <p className="story-datebar-hint">
          {!now
            ? "Your date is the campaign's now, and new records are dated by it. The party sees it when you publish."
            : !published
              ? "The party has no date yet. Publish shares yours with them."
              : same
                ? "The party is on your date."
                : "You are ahead of the party. Publish moves their date to yours."}
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {dateOpen && (
        <CampaignDateEditor
          gmToken={gmToken}
          calendar={calendar}
          onSaved={() => {
            setDateOpen(false);
            void onChanged();
          }}
          onClose={() => setDateOpen(false)}
        />
      )}
      {editorOpen && (
        <CalendarEditor
          gmToken={gmToken}
          calendar={calendar}
          onSaved={() => {
            setEditorOpen(false);
            void onChanged();
          }}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}

/** The players' one date: the published date, called Today. */
export function PlayerDateBar({ calendar }: Readonly<{ calendar: CodexCalendar | null }>) {
  const today = calendar?.currentDate ?? null;
  return (
    <div className="story-datebar" role="group" aria-label="Today">
      <span className="story-datebar-part">
        <span className="story-datebar-key">Today</span>
        <strong className="story-datebar-date">
          {calendar && today ? formatWorldDate(calendar, today) : "Not shared yet"}
        </strong>
      </span>
    </div>
  );
}
