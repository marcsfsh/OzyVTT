import { useState } from "react";
import { Alert, Button, IconButton, IconEyeOff, cx, useToast } from "@vtt/ui";
import { formatWorldDate, type CodexCalendar, type CodexInWorldDate, type GmCodexCalendar } from "@vtt/domain";
import { calendarApi } from "../api";
import { CalendarEditor, CampaignDateEditor } from "../CalendarEditor";
import { sameInWorldDate } from "../chronicle";
import { hourLabel } from "../../rest/game-date";
import "./shared.css";

/**
 * A date as the bar shows it: "Emberfall 15" while both dates share a year, since the month below names the year.
 * Across a year the full date shows, so the two never read as the same day.
 */
function barDate(calendar: CodexCalendar, date: CodexInWorldDate, other: CodexInWorldDate | null): string {
  if (other && other.year !== date.year) return formatWorldDate(calendar, date);
  return `${calendar.months[date.month]?.name ?? ""} ${date.day}`;
}

type GmDateBarProps = Readonly<{
  role: "gm";
  token: string;
  calendar: GmCodexCalendar | null;
  /** The game clock's hour, which goes with your date. */
  gameHours?: number | null;
  /** A phone's bar: the two dates and Publish, in less room. */
  tight?: boolean;
  onChanged: () => void | Promise<void>;
}>;

type PlayerDateBarProps = Readonly<{
  role: "player";
  calendar: CodexCalendar | null;
  /** A phone's bar: the day without the year. */
  tight?: boolean;
}>;

/**
 * Both dates in one bar, on Home and in Story. The GM's date is violet because only the GM sees it, and it opens a
 * date editor; the players' date is only ever a published copy of it, so Publish is the one way to move theirs. A
 * player's bar has their date alone, as Today.
 */
export function DateBar(props: GmDateBarProps | PlayerDateBarProps) {
  return props.role === "gm" ? <GmDateBar {...props} /> : <PlayerDateBar {...props} />;
}

function GmDateBar({ token, calendar, gameHours = null, tight = false, onChanged }: GmDateBarProps) {
  const { toast } = useToast();
  const [dateOpen, setDateOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = calendar?.currentDate ?? null;
  const published = calendar?.publishedDate ?? null;
  const same = sameInWorldDate(now, published);

  const change = async (write: () => Promise<unknown>, done: string, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await write();
      await onChanged();
      toast(done, { tone: "success" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  };
  // Name the date before the round trip, so the notice says what was published.
  const publish = () =>
    change(
      () => calendarApi.publish(token),
      calendar && now ? `Players now see ${formatWorldDate(calendar, now)}.` : "The date is published to players.",
      "Couldn't publish the date."
    );
  // Players then see no date at all until the next Publish.
  const unpublish = () =>
    change(() => calendarApi.unpublish(token), "Players no longer see a date.", "Couldn't hide the players' date.");

  const calendarEditor = editorOpen && (
    <CalendarEditor
      gmToken={token}
      calendar={calendar}
      onSaved={() => {
        setEditorOpen(false);
        void onChanged();
      }}
      onClose={() => setEditorOpen(false)}
    />
  );

  if (!calendar || calendar.months.length === 0)
    return (
      <div className={cx("cx-datebar", tight && "is-tight")}>
        <span className="cx-hint">The world has no calendar yet.</span>
        <Button variant="secondary" size="sm" onClick={() => setEditorOpen(true)}>
          Set up the calendar
        </Button>
        {calendarEditor}
      </div>
    );

  return (
    <div className={cx("cx-datebar", tight && "is-tight")} aria-label="The two dates" role="group">
      <span className="cx-datebar-part">
        <span className="cx-datebar-key">Yours</span>
        <button
          type="button"
          className="cx-datebar-date is-gm"
          aria-label={now ? `Your date is ${formatWorldDate(calendar, now)}. Change it.` : "Set your date"}
          title={now ? formatWorldDate(calendar, now) : undefined}
          onClick={() => setDateOpen(true)}
        >
          {now ? barDate(calendar, now, published) : "Set your date"}
        </button>
        {now && gameHours !== null && <span className="cx-datebar-hour">{hourLabel(gameHours)}</span>}
        <span className="cx-datebar-hidden">
          <IconEyeOff /> Hidden
        </span>
      </span>
      <span className="cx-datebar-part">
        <span className="cx-datebar-key">Players</span>
        <strong className="cx-datebar-date" title={published ? formatWorldDate(calendar, published) : undefined}>
          {published ? barDate(calendar, published, now) : "Not shared yet"}
        </strong>
      </span>
      <span className="cx-datebar-actions">
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
        <p className="cx-datebar-hint">
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
          gmToken={token}
          calendar={calendar}
          onSaved={() => {
            setDateOpen(false);
            void onChanged();
          }}
          onClose={() => setDateOpen(false)}
        />
      )}
      {calendarEditor}
    </div>
  );
}

function PlayerDateBar({ calendar, tight = false }: PlayerDateBarProps) {
  const today = calendar?.currentDate ?? null;
  return (
    <div className={cx("cx-datebar", tight && "is-tight")} role="group" aria-label="Today">
      <span className="cx-datebar-part">
        <span className="cx-datebar-key">Today</span>
        <strong className="cx-datebar-date">
          {calendar && today
            ? tight
              ? barDate(calendar, today, null)
              : formatWorldDate(calendar, today)
            : "Not shared yet"}
        </strong>
      </span>
    </div>
  );
}
