import { Badge, Button, GmOnlyTag, RevealSwitch } from "@vtt/ui";
import { formatWorldDate, type CodexChronicleRecord, type CodexPageSummary, type GmCodexCalendar } from "@vtt/domain";
import {
  CHRONICLE_KIND_META,
  chronicleWhenLabel,
  deadlineFired,
  deadlinesPassedBy,
  deadlineStateLabel,
  deadlineStateTone,
  downtimeOf,
  downtimeSummaryLabel,
  milestoneOf,
  milestoneSummaryLabel,
  questEventLabel,
  questEventOf,
  standingChangeLabel,
  standingOf
} from "./chronicle";
import { CodexIcon } from "./icons";
import { CodexMarkdown } from "./CodexMarkdown";

/** One row of the GM's Journal: both text layers, its reveal switch, its payload and the jumps it offers. */
export function JournalEntryCard({
  gmToken,
  record,
  records,
  calendar,
  pages,
  focused,
  onOpenPage,
  onOpenMarker,
  onOpenReplay,
  onOpenSession,
  onReveal,
  onApplyDowntime,
  onEdit,
  onRemove
}: Readonly<{
  gmToken: string;
  record: CodexChronicleRecord;
  /** The whole chronicle, for the deadlines a downtime would pass. */
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  pages: readonly CodexPageSummary[];
  /** Arrived at from a search hit or a link. */
  focused: boolean;
  onOpenPage: (pageId: string) => void;
  onOpenMarker?: (markerId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  onOpenSession?: (sessionId: string) => void;
  onReveal: (revealed: boolean) => void;
  onApplyDowntime: () => void;
  onEdit: () => void;
  onRemove: () => void;
}>) {
  const meta = CHRONICLE_KIND_META[record.kind];
  const isEvent = record.kind === "event";
  const isDeadline = record.kind === "deadline";
  const fired = deadlineFired(record);
  // Payloads are only opened through their kind gates (`chronicle.ts`).
  const downtime = downtimeOf(record);
  const milestone = milestoneOf(record);
  const standing = standingOf(record);
  const questEvent = questEventOf(record);
  // The server's proposed date, since the server decides where the clock lands.
  const proposed = downtime && !downtime.applied ? record.proposedDate : null;
  // Counted against the whole chronicle, beyond this group. Zero says nothing.
  const passing = proposed ? deadlinesPassedBy(records, calendar, proposed) : 0;
  return (
    <article
      id={`codex-entry-${record.id}`}
      aria-current={focused ? "true" : undefined}
      className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${isEvent ? " is-event" : ""}${isDeadline ? " is-deadline" : ""}${downtime ? " is-downtime" : ""}${focused ? " is-focused" : ""}`}
    >
      <header className="codex-entry-head">
        <div className="codex-entry-meta">
          <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {isDeadline && <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>}
          <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
          {/* `sessionId` present: a link. Null with a number: a deleted, once-revealed session's bare label. */}
          {record.sessionId && onOpenSession ? (
            <button type="button" className="codex-entry-sessionlink" onClick={() => onOpenSession(record.sessionId!)}>
              {record.sessionNumber !== null ? `Session ${record.sessionNumber}` : "This session"}
            </button>
          ) : (
            record.sessionNumber !== null && <span className="codex-entry-when">Session {record.sessionNumber}</span>
          )}
        </div>
        <RevealSwitch
          revealed={record.revealedToPlayers}
          onChange={onReveal}
          ariaLabel={isEvent ? "Show this event to players" : "Show this entry to players"}
        />
      </header>
      {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
      {record.text.trim() && (
        <div className="codex-entry-body">
          <CodexMarkdown
            text={record.text}
            token={gmToken}
            onNavigate={(target) => {
              const page = pages.find((candidate) => candidate.title.toLowerCase() === target.toLowerCase());
              if (page) onOpenPage(page.id);
            }}
          />
        </div>
      )}
      {record.gmText && (
        <div className="codex-entry-gm">
          <GmOnlyTag />
          <CodexMarkdown text={record.gmText} token={gmToken} />
        </div>
      )}
      {/* Read-only; tag navigation lives in Pages. */}
      {record.tags.length > 0 && (
        <ul className="codex-entry-tags" aria-label="Entry tags">
          {record.tags.map((tag) => (
            <li key={tag}>
              <Badge>{tag}</Badge>
            </li>
          ))}
        </ul>
      )}
      {/* Confirm is the only control on this row that moves the clock, and only while unapplied. */}
      {downtime && (
        <div className="codex-downtime">
          <p className="codex-downtime-what">{downtimeSummaryLabel(downtime)}</p>
          {downtime.applied ? (
            <p className="codex-downtime-state">Your date has already been moved for this downtime.</p>
          ) : proposed && calendar ? (
            <div className="codex-downtime-apply">
              <span className="codex-downtime-proposal">
                Move your date to {formatWorldDate(calendar, proposed)}
                {passing > 0 ? `. This passes ${passing} ${passing === 1 ? "deadline" : "deadlines"}.` : ""}
              </span>
              {/* Default size: grows its own paint to 44px with no ::after overhang into the footer buttons below. */}
              <Button variant="secondary" onClick={onApplyDowntime}>
                Confirm
              </Button>
            </div>
          ) : (
            <p className="codex-downtime-state">Set your date on the Calendar to move the clock from this downtime.</p>
          )}
        </div>
      )}
      {milestone && <p className="codex-downtime-what">{milestoneSummaryLabel(milestone)}</p>}
      {/* A quest-history row has no prose; this sentence is the whole record. */}
      {questEvent && <p className="codex-downtime-what">{questEventLabel(questEvent, null)}</p>}
      {standing && (
        <p className="codex-downtime-what">
          {standingChangeLabel(standing, pages.find((page) => page.id === standing.factionPageId)?.title ?? null)}
        </p>
      )}
      {/* Event rows only offer "Open page": edit and delete happen on the page. */}
      <footer className="codex-entry-foot">
        {isEvent && (
          <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.id)}>
            Open page
          </Button>
        )}
        {!isEvent && record.attachPageId && (
          <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.attachPageId!)}>
            Open page
          </Button>
        )}
        {record.attachMarkerId && onOpenMarker && (
          <Button variant="ghost" size="sm" onClick={() => onOpenMarker(record.attachMarkerId!)}>
            Open pin
          </Button>
        )}
        {record.kind === "combat" && record.sourceEncounterId !== null && onOpenReplay && (
          <Button variant="ghost" size="sm" onClick={() => onOpenReplay(record.sourceEncounterId!)}>
            Open replay
          </Button>
        )}
        {!isEvent && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
        {!isEvent && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Delete
          </Button>
        )}
      </footer>
    </article>
  );
}
