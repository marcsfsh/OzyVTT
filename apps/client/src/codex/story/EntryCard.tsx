import { Badge, Button, IconEyeOff } from "@vtt/ui";
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
} from "../chronicle";
import { CodexIcon } from "../icons";
import { CodexMarkdown } from "../CodexMarkdown";
import { FieldAudienceToggle } from "../shared/WhoSeesIt";

/**
 * One chronicle record in full, for the GM: its kind and date, the text players read, the hidden note, its payload,
 * who sees it, and what it offers (its page, pin, replay or session, Edit and Delete). A downtime not yet confirmed
 * says where confirming moves the GM's date before the button that does it.
 */
export function EntryCard({
  gmToken,
  record,
  records,
  calendar,
  pages,
  quests = [],
  focused = false,
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
  /** Names a quest event's quest. */
  quests?: ReadonlyArray<Readonly<{ id: string; title: string }>>;
  focused?: boolean;
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
  const downtime = downtimeOf(record);
  const milestone = milestoneOf(record);
  const standing = standingOf(record);
  const questEvent = questEventOf(record);
  // The server's proposed date: the server decides where the clock lands.
  const proposed = downtime && !downtime.applied ? record.proposedDate : null;
  const passing = proposed ? deadlinesPassedBy(records, calendar, proposed) : 0;
  const follow = (target: string) => {
    const page = pages.find((candidate) => candidate.title.toLowerCase() === target.toLowerCase());
    if (page) onOpenPage(page.id);
  };

  return (
    <article
      id={`codex-entry-${record.id}`}
      aria-current={focused ? "true" : undefined}
      aria-label={`${meta.label}: ${record.title ?? chronicleWhenLabel(record)}`}
      className={`story-entry${focused ? " is-focused" : ""}${record.revealedToPlayers ? "" : " is-hidden"}`}
    >
      <header className="story-entry-head">
        <CodexIcon iconId={meta.iconId} className="story-entry-kindicon" />
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {isDeadline && <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>}
        <span className="story-entry-when">{chronicleWhenLabel(record)}</span>
        {record.sessionId && onOpenSession ? (
          <button type="button" className="story-linkbutton" onClick={() => onOpenSession(record.sessionId!)}>
            {record.sessionNumber !== null ? `Session ${record.sessionNumber}` : "This session"}
          </button>
        ) : (
          record.sessionNumber !== null && <span className="story-entry-when">Session {record.sessionNumber}</span>
        )}
        <span className="story-grow" />
        <FieldAudienceToggle
          field={isEvent ? "this event" : "this entry"}
          hidden={!record.revealedToPlayers}
          onChange={(hidden) => onReveal(!hidden)}
        />
      </header>
      {record.title && <h4 className="story-entry-title">{record.title}</h4>}
      {record.text.trim() && (
        <div className="story-entry-body">
          <CodexMarkdown text={record.text} token={gmToken} onNavigate={follow} />
        </div>
      )}
      {record.gmText && (
        <div className="story-hiddennote">
          <span className="story-hiddennote-label">
            <IconEyeOff /> Hidden
          </span>
          <CodexMarkdown text={record.gmText} token={gmToken} onNavigate={follow} />
        </div>
      )}
      {record.tags.length > 0 && (
        <ul className="story-tags" aria-label="Entry tags">
          {record.tags.map((tag) => (
            <li key={tag}>
              <Badge>{tag}</Badge>
            </li>
          ))}
        </ul>
      )}
      {downtime && (
        <div className="story-downtime">
          <p className="story-payload">{downtimeSummaryLabel(downtime)}</p>
          {downtime.applied ? (
            <p className="story-hint">Your date has already been moved for this downtime.</p>
          ) : proposed && calendar ? (
            <div className="story-downtime-apply">
              <span>
                Move your date to {formatWorldDate(calendar, proposed)}
                {passing > 0 ? `. This passes ${passing} ${passing === 1 ? "deadline" : "deadlines"}.` : ""}
              </span>
              <Button variant="secondary" onClick={onApplyDowntime}>
                Confirm
              </Button>
            </div>
          ) : (
            <p className="story-hint">Set your date in the date bar to move the clock from this downtime.</p>
          )}
        </div>
      )}
      {milestone && <p className="story-payload">{milestoneSummaryLabel(milestone)}</p>}
      {questEvent && (
        <p className="story-payload">
          {questEventLabel(questEvent, quests.find((quest) => quest.id === questEvent.questId)?.title ?? null)}
        </p>
      )}
      {standing && (
        <p className="story-payload">
          {standingChangeLabel(standing, pages.find((page) => page.id === standing.factionPageId)?.title ?? null)}
        </p>
      )}
      <footer className="story-entry-foot">
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
