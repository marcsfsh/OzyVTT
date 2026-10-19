import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  IconPlus,
  Modal,
  SegmentedControl,
  Skeleton,
  Input,
  FilterChips,
  FilterFlyout,
  FiltersButton
} from "@vtt/ui";
import type { CodexChronicleRecord, CodexSession } from "@vtt/domain";
import { calendarApi, journalApi } from "../api";
import { CHRONICLE_FILTER_KINDS, CHRONICLE_KIND_META } from "../chronicle";
import { CodexMarkdown } from "../CodexMarkdown";
import { usePageLinks } from "../pageLinks";
import { prepSessionApi } from "../prep/api";
import { atlasPath, pagePath, pathForSection, sessionPath, templatePath } from "../routes";
import { sessionTitle } from "../sessions";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useGmCodex, usePlayerCodex } from "../shell/context";
import { useCodexQuery } from "../useCodexQuery";
import { GmChronicle, PlayerChronicle, recordLine } from "./Chronicle";
import { DateBar } from "../shared/DateBar";
import { GmDowntime, PlayerDowntime } from "./Downtime";
import { EntryCard } from "./EntryCard";
import { EntryComposer, type ComposerKind } from "./EntryComposer";
import { realDateLabel, sessionDays, type StoryRecord } from "./model";
import { SessionPage } from "./SessionPage";
import {
  PlayerSessionPage,
  RecapCards,
  SessionRows,
  SessionsFlyout,
  StoryBar,
  defaultSessionId,
  sessionFilterCount,
  useSortedSessions,
  useSessionFilter,
  type ListedSession
} from "./Sessions";
import { TIMELINE_ZOOMS, Timeline, type NextSessionCard, type TimelineZoom } from "./Timeline";
import { useChronicleActions } from "./actions";
import { useActionError, useReadRecaps } from "./state";
import "./story.css";

/**
 * Story's sections in the Codex shell: Chronicle (`/codex/story`), Timeline (`/codex/timeline`) and Sessions
 * (`/codex/sessions[/:id]`), for the GM and for players. A phone reads Story as the timeline, under Campaign's switch.
 */

type View = "chronicle" | "timeline" | "sessions";
const VIEW_PATH: Readonly<Record<View, string>> = {
  chronicle: pathForSection("story"),
  timeline: pathForSection("timeline"),
  sessions: pathForSection("sessions")
};
const FLYOUT_ID = "story-filters";

const kindsOf = (query: URLSearchParams) => (query.get("kind") ?? "").split(",").filter(Boolean);
const zoomOf = (query: URLSearchParams, fallback: TimelineZoom): TimelineZoom => {
  const raw = query.get("zoom");
  return raw === "ages" || raw === "year" || raw === "month" ? raw : fallback;
};
const numberOf = (query: URLSearchParams, key: string) => {
  const raw = query.get(key);
  return raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Math.trunc(Number(raw)) : null;
};

/** The chronicle filtered by the address: kinds, a tag and words. */
function filterRecords<R extends StoryRecord & Readonly<{ tags: readonly string[]; gmText?: string | null }>>(
  records: readonly R[],
  query: URLSearchParams
): R[] {
  const kinds = kindsOf(query);
  const tag = query.get("tag");
  const needle = (query.get("q") ?? "").trim().toLowerCase();
  return records.filter(
    (record) =>
      (kinds.length === 0 || kinds.includes(record.kind)) &&
      (!tag || record.tags.includes(tag)) &&
      (!needle ||
        record.text.toLowerCase().includes(needle) ||
        (record.title ?? "").toLowerCase().includes(needle) ||
        (record.gmText ?? "").toLowerCase().includes(needle))
  );
}

function ChronicleFilters({
  records,
  open,
  onClose
}: Readonly<{
  records: ReadonlyArray<StoryRecord & Readonly<{ tags: readonly string[] }>>;
  open: boolean;
  onClose: () => void;
}>) {
  const { query, setFilter } = useCodexShell();
  const tags = useMemo(() => [...new Set(records.flatMap((record) => record.tags))].sort(), [records]);
  return (
    <FilterFlyout id={FLYOUT_ID} open={open} title="Chronicle" onClose={onClose}>
      <Input
        aria-label="Filter the chronicle"
        placeholder="Filter the chronicle"
        value={query.get("q") ?? ""}
        onChange={(event) => setFilter({ q: event.target.value || null })}
      />
      <span className="story-eyebrow">Kind</span>
      <FilterChips
        label="Kind"
        options={CHRONICLE_FILTER_KINDS.map((kind) => ({ value: kind, label: CHRONICLE_KIND_META[kind].label }))}
        selected={kindsOf(query)}
        onChange={(next) => setFilter({ kind: next.join(",") || null })}
      />
      {tags.length > 0 && (
        <>
          <span className="story-eyebrow">Tag</span>
          <FilterChips
            label="Tag"
            options={tags.map((tag) => ({ value: tag, label: `#${tag}` }))}
            selected={query.get("tag") ? [query.get("tag")!] : []}
            onChange={(next) => setFilter({ tag: next.filter((tag) => tag !== query.get("tag"))[0] ?? null })}
          />
        </>
      )}
    </FilterFlyout>
  );
}

/** How many of the chronicle's filters are set, for the Filters button. */
const filterCount = (query: URLSearchParams) =>
  (query.get("q") ? 1 : 0) + kindsOf(query).length + (query.get("tag") ? 1 : 0);

// ----- The GM -----

/** Everything the GM's Story needs from the shell: the chronicle, the calendar and the writes on them. */
function useGmStory() {
  const shell = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  const records = feeds.campaign.records;
  const calendar = feeds.campaign.calendar;
  const reload = feeds.campaignFeed.reload;
  const [error, setError] = useActionError(feeds.campaignFeed.data);
  const followLink = usePageLinks(feeds.pages, gm.quickCreate);
  const [composer, setComposer] = useState<Readonly<{
    editing: CodexChronicleRecord | null;
    kind: ComposerKind;
  }> | null>(null);
  const tagSuggestions = useMemo(
    () =>
      [...new Set([...feeds.pages.flatMap((page) => page.tags), ...records.flatMap((record) => record.tags)])].sort(),
    [feeds.pages, records]
  );
  const lineOf = (record: StoryRecord) => recordLine(record, feeds.quests, feeds.pages);
  // Before the first read lands there is no calendar to speak of, and saying "no calendar yet" would be wrong.
  const loading = feeds.campaignFeed.loading && !feeds.campaignFeed.data;
  return {
    shell,
    loading,
    gm,
    feeds,
    records,
    calendar,
    reload,
    error,
    setError,
    followLink,
    composer,
    setComposer,
    tagSuggestions,
    lineOf
  };
}

/** The full record in a dialog: what a clock, a day or a phone opens. */
function RecordDialog({
  record,
  onClose,
  renderRecord
}: Readonly<{
  record: CodexChronicleRecord | null;
  onClose: () => void;
  renderRecord: (record: CodexChronicleRecord) => React.ReactNode;
}>) {
  return (
    <Modal
      open={record !== null}
      onClose={onClose}
      size="md"
      title={record ? CHRONICLE_KIND_META[record.kind].label : ""}
    >
      {record && renderRecord(record)}
    </Modal>
  );
}

/** The full record with its actions. `onDone` closes whatever showed it, after Edit or a delete. */
function useRecordCard(story: ReturnType<typeof useGmStory>, onDone?: () => void) {
  const { shell, gm, feeds, records, calendar, setComposer } = story;
  const actions = useChronicleActions(shell.token, calendar, story.reload, (message) => story.setError(message));
  const render = (record: CodexChronicleRecord, focused = false) => (
    <EntryCard
      gmToken={shell.token}
      record={record}
      records={records}
      calendar={calendar}
      pages={feeds.pages}
      quests={feeds.quests}
      focused={focused}
      onOpenPage={(pageId) => shell.go(pagePath(pageId))}
      onOpenMarker={(markerId) => shell.go(atlasPath(null, markerId))}
      onOpenReplay={gm.onOpenReplay}
      onOpenSession={(sessionId) => shell.go(sessionPath(sessionId))}
      onReveal={(revealed) => void actions.reveal(record, revealed)}
      onApplyDowntime={() => void actions.applyDowntime(record)}
      onEdit={() => {
        onDone?.();
        setComposer({ editing: record, kind: "entry" });
      }}
      onRemove={() => void actions.remove(record).then((gone) => gone && onDone?.())}
    />
  );
  return { render, actions };
}

/** The composer, opened from Add to the chronicle, from Log downtime and from Edit. */
function StoryLoading() {
  return (
    <div className="story-loading">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} variant="text" />
      ))}
    </div>
  );
}

function StoryComposer({ story }: Readonly<{ story: ReturnType<typeof useGmStory> }>) {
  const { shell, gm, feeds, calendar, reload, composer, setComposer, tagSuggestions } = story;
  return (
    <EntryComposer
      gmToken={shell.token}
      open={composer !== null}
      editing={composer?.editing ?? null}
      initialKind={composer?.kind ?? "entry"}
      calendar={calendar}
      sessions={feeds.sessions}
      activeSessionId={feeds.activeSessionId}
      pages={feeds.pages}
      actors={gm.actors}
      tagSuggestions={tagSuggestions}
      onClose={() => setComposer(null)}
      onSaved={reload}
      onFollow={story.followLink}
    />
  );
}

/** The Downtime card: days per person, what waits to be confirmed, and Log downtime into the composer. */
function StoryDowntime({ story }: Readonly<{ story: ReturnType<typeof useGmStory> }>) {
  const { shell, gm, feeds, records, calendar, reload, setComposer } = story;
  return (
    <GmDowntime
      gmToken={shell.token}
      records={records}
      calendar={calendar}
      pages={feeds.pages}
      actors={gm.actors}
      onChanged={reload}
      onOpenPage={(pageId) => shell.go(pagePath(pageId))}
      onLog={() => setComposer({ editing: null, kind: "downtime" })}
    />
  );
}

/** The GM's next planned session, for the month's Next card: its number, when, and the clues it plans. */
function useNextSession(sessions: readonly CodexSession[]): NextSessionCard | null {
  return useMemo(() => {
    const planned = sessions
      .filter((session) => session.status === "planned")
      .sort((a, b) => (a.sessionNumber ?? Number.MAX_SAFE_INTEGER) - (b.sessionNumber ?? Number.MAX_SAFE_INTEGER))[0];
    if (!planned) return null;
    const clues = (planned.prep ?? []).flatMap((section) =>
      section.type === "checklist" ? section.items.filter((item) => !item.done).map((item) => item.text) : []
    );
    return {
      title: [`Next · ${sessionTitle(planned)}`, realDateLabel(planned.realDate, true)].filter(Boolean).join(" · "),
      line:
        clues.length > 0
          ? `Planned clues: ${clues.slice(0, 4).join("; ")}.`
          : "Prep only. Nothing is planned to come out yet."
    };
  }, [sessions]);
}

/** The phone's Story for the GM: both dates, the zoomable timeline, and the chronicle's records one tap away. */
function GmPhoneStory({ story }: Readonly<{ story: ReturnType<typeof useGmStory> }>) {
  const { shell, gm, feeds, records, calendar, reload, error, setComposer, lineOf } = story;
  const [opened, setOpened] = useState<string | null>(shell.query.get("entry"));
  const card = useRecordCard(story, () => setOpened(null));
  const zoom = zoomOf(shell.query, "month");
  const next = useNextSession(feeds.sessions);
  const shown = filterRecords(records, shell.query);
  const openedRecord = records.find((record) => record.id === opened) ?? null;
  // An old Downtime address lands here filtered to downtime, so its card leads.
  const downtimeFirst = kindsOf(shell.query).length === 1 && kindsOf(shell.query)[0] === "downtime";
  // No phone bar of its own: the frame's default bar titles Story and keeps Search in reach.
  if (story.loading)
    return (
      <div className="story is-phone">
        <StoryLoading />
      </div>
    );
  return (
    <div className="story is-phone scroll-y">
      <DateBar
        role="gm"
        token={shell.token}
        calendar={calendar}
        gameHours={gm.gameHours}
        gameMinutes={gm.gameMinutes}
        tight
        onChanged={reload}
      />
      <Button variant="secondary" block onClick={() => setComposer({ editing: null, kind: "entry" })}>
        <IconPlus /> Add to the chronicle
      </Button>
      {(error ?? feeds.campaignFeed.error) && <Alert tone="danger">{error ?? feeds.campaignFeed.error}</Alert>}
      {downtimeFirst && <StoryDowntime story={story} />}
      <Timeline
        lineOf={lineOf}
        audience="gm"
        records={shown}
        calendar={calendar}
        playersDate={calendar?.publishedDate ?? null}
        gmDate={calendar?.currentDate ?? null}
        zoom={zoom}
        year={numberOf(shell.query, "y")}
        month={numberOf(shell.query, "m")}
        phone
        nextSession={next}
        selectedId={opened}
        onZoom={(value) => shell.setFilter({ zoom: value })}
        onShow={(year, month, value) =>
          shell.setFilter({ y: String(year), m: month === null ? null : String(month), zoom: value })
        }
        onSelect={(record) => setOpened(record.id)}
      />
      {!downtimeFirst && <StoryDowntime story={story} />}
      <RecordDialog
        record={openedRecord}
        onClose={() => setOpened(null)}
        renderRecord={(record) => card.render(record)}
      />
      <StoryComposer story={story} />
      {card.actions.dialog}
    </div>
  );
}

export function GmStorySection() {
  const story = useGmStory();
  const { shell, gm, feeds, records, calendar, reload, error, setComposer, followLink } = story;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dialogRecord, setDialogRecord] = useState<CodexChronicleRecord | null>(null);
  const card = useRecordCard(story, () => setDialogRecord(null));
  if (shell.phone) return <GmPhoneStory story={story} />;
  const shown = filterRecords(records, shell.query);
  const downtimeFirst = kindsOf(shell.query).length === 1 && kindsOf(shell.query)[0] === "downtime";
  const downtime = <StoryDowntime story={story} />;
  return (
    <div className="story">
      <StoryBar
        view="chronicle"
        onView={(view) => shell.go(VIEW_PATH[view])}
        end={
          <FiltersButton
            open={filtersOpen}
            onToggle={() => setFiltersOpen((open) => !open)}
            controls={FLYOUT_ID}
            count={filterCount(shell.query)}
          />
        }
      />
      {(error ?? feeds.campaignFeed.error) && <Alert tone="danger">{error ?? feeds.campaignFeed.error}</Alert>}
      <div className="story-stage">
        <ChronicleFilters records={records} open={filtersOpen} onClose={() => setFiltersOpen(false)} />
        {story.loading ? (
          <StoryLoading />
        ) : (
          <GmChronicle
            gmToken={shell.token}
            records={shown}
            calendar={calendar}
            sessions={feeds.sessions}
            pages={feeds.pages}
            quests={feeds.quests}
            focusedId={shell.query.get("entry")}
            year={shell.query.get("y")}
            month={shell.query.get("m")}
            onMonthChange={(year, month) => shell.setFilter({ y: String(year), m: String(month) })}
            onOpenSession={(sessionId) => shell.go(sessionPath(sessionId))}
            onFollow={followLink}
            dateBar={
              <>
                {downtimeFirst && downtime}
                <DateBar
                  role="gm"
                  token={shell.token}
                  calendar={calendar}
                  gameHours={gm.gameHours}
                  gameMinutes={gm.gameMinutes}
                  onChanged={reload}
                />
                {!card.actions.warn && (
                  <Button variant="ghost" size="sm" onClick={card.actions.warnAgain}>
                    Warn me again before showing a record
                  </Button>
                )}
              </>
            }
            downtime={downtimeFirst ? null : downtime}
            onAdd={() => setComposer({ editing: null, kind: "entry" })}
            renderRecord={(record) => card.render(record, record.id === shell.query.get("entry"))}
            onOpenRecord={(record) =>
              record.kind === "event" || record.kind === "deadline"
                ? setDialogRecord(record)
                : shell.setFilter({ entry: record.id })
            }
          />
        )}
      </div>
      <RecordDialog
        record={dialogRecord}
        onClose={() => setDialogRecord(null)}
        renderRecord={(record) => card.render(record)}
      />
      <StoryComposer story={story} />
      {card.actions.dialog}
    </div>
  );
}

/** The selected event or record on the timeline's right, with the way to its page. */
function TimelineAside({
  record,
  calendarLabel,
  token,
  audience,
  knownTitles,
  onFollow,
  onOpenPage,
  onClose,
  children
}: Readonly<{
  record: StoryRecord | null;
  calendarLabel: string | null;
  token: string;
  audience: "gm" | "player";
  knownTitles?: ReadonlySet<string>;
  onFollow: (target: string) => void;
  onOpenPage: ((pageId: string) => void) | null;
  onClose: () => void;
  children?: React.ReactNode;
}>) {
  if (!record) return null;
  const meta = CHRONICLE_KIND_META[record.kind];
  return (
    <aside className="story-aside scroll-y" aria-label={record.title ?? meta.label}>
      <div className="story-aside-head">
        <h2 className="story-aside-title">{record.title ?? meta.label}</h2>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      {calendarLabel && <p className="story-hint">{calendarLabel}</p>}
      {children ?? (
        <div className="story-entry-body">
          <CodexMarkdown
            text={record.text}
            token={token}
            onNavigate={onFollow}
            knownTitles={knownTitles}
            audience={audience === "player" ? "player" : undefined}
          />
        </div>
      )}
      <div className="story-row-actions">
        {record.kind === "event" && onOpenPage && (
          <Button variant="secondary" size="sm" onClick={() => onOpenPage(record.id)}>
            Open the page
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </aside>
  );
}

export function GmTimelineSection() {
  const story = useGmStory();
  const { shell, feeds, records, calendar, error, followLink, lineOf } = story;
  const [selected, setSelected] = useState<string | null>(null);
  const card = useRecordCard(story, () => setSelected(null));
  const next = useNextSession(feeds.sessions);
  if (shell.phone) return <GmPhoneStory story={story} />;
  const zoom = zoomOf(shell.query, "ages");
  const record = records.find((each) => each.id === selected) ?? null;
  return (
    <div className="story">
      <StoryBar
        view="timeline"
        onView={(view) => shell.go(VIEW_PATH[view])}
        end={
          <SegmentedControl
            ariaLabel="Zoom"
            value={zoom}
            onChange={(value) => shell.setFilter({ zoom: value })}
            options={TIMELINE_ZOOMS.map((option) => ({ value: option.value, label: option.label }))}
          />
        }
      />
      {(error ?? feeds.campaignFeed.error) && <Alert tone="danger">{error ?? feeds.campaignFeed.error}</Alert>}
      {story.loading ? (
        <StoryLoading />
      ) : (
        <Timeline
          lineOf={lineOf}
          audience="gm"
          records={records}
          calendar={calendar}
          playersDate={calendar?.publishedDate ?? null}
          gmDate={calendar?.currentDate ?? null}
          zoom={zoom}
          year={numberOf(shell.query, "y")}
          month={numberOf(shell.query, "m")}
          phone={false}
          nextSession={next}
          selectedId={selected}
          onZoom={(value) => shell.setFilter({ zoom: value })}
          onShow={(year, month, value) =>
            shell.setFilter({ y: String(year), m: month === null ? null : String(month), zoom: value })
          }
          onSelect={(each) => setSelected(each.id)}
          aside={
            <TimelineAside
              record={record}
              calendarLabel={record?.inWorldLabel ?? null}
              token={shell.token}
              audience="gm"
              onFollow={followLink}
              onOpenPage={(pageId) => shell.go(pagePath(pageId))}
              onClose={() => setSelected(null)}
            >
              {record && record.kind !== "event" ? card.render(record) : undefined}
            </TimelineAside>
          }
        />
      )}
      <StoryComposer story={story} />
      {card.actions.dialog}
    </div>
  );
}

/** The session page's reads that the shell doesn't keep for Sessions: the chronicle and the calendar. */
function useSessionsCampaign(token: string) {
  return useCodexQuery(
    useCallback(async () => {
      const [records, calendar] = await Promise.all([journalApi.chronicle(token), calendarApi.get(token)]);
      return { records, calendar };
    }, [token]),
    { failure: "Couldn't load the chronicle." }
  );
}

export function GmSessionsSection() {
  const shell = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  const campaign = useSessionsCampaign(shell.token);
  const records = useMemo(() => campaign.data?.records ?? [], [campaign.data]);
  const calendar = campaign.data?.calendar ?? null;
  const sessions = feeds.sessions;
  const [filter, setFilter, filtered] = useSessionFilter();
  // A filtered address opens on its filtered list.
  const [filtersOpen, setFiltersOpen] = useState(filtered);
  const [error, setError] = useActionError(feeds.sessionFeed.data);
  const listed = useMemo<(ListedSession & { source: CodexSession })[]>(
    () =>
      sessions.map((session) => ({
        id: session.id,
        sessionNumber: session.sessionNumber,
        realDate: session.realDate,
        recap: session.recapBody,
        tags: session.tags,
        status: session.status,
        shared: session.revealedToPlayers,
        source: session
      })),
    [sessions]
  );
  const sorted = useSortedSessions(listed);
  const selectedId = shell.recordId ?? (shell.phone ? null : defaultSessionId(listed, feeds.activeSessionId));
  const session = sessions.find((each) => each.id === selectedId) ?? null;
  const deadlines = useMemo(
    () =>
      records
        .filter((record) => record.kind === "deadline")
        .map((record) => ({
          id: record.id,
          text: record.title ?? record.text,
          inWorldLabel: record.inWorldLabel,
          fired: record.fired
        })),
    [records]
  );
  const followLink = usePageLinks(feeds.pages, gm.quickCreate);
  const context = useMemo(
    () => ({
      token: shell.token,
      pages: feeds.pages,
      quests: feeds.quests,
      deadlines,
      scenes: gm.scenes,
      onFollow: followLink
    }),
    [shell.token, feeds.pages, feeds.quests, deadlines, gm.scenes, followLink]
  );
  const create = async () => {
    setError(null);
    try {
      const made = await prepSessionApi.create(shell.token, {
        sessionNumber: Math.max(0, ...sessions.map((each) => each.sessionNumber ?? 0)) + 1
      });
      await feeds.sessionFeed.reload();
      shell.go(sessionPath(made.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't make the session.");
    }
  };
  const reload = async () => {
    await Promise.all([feeds.sessionFeed.reload(), campaign.reload()]);
  };
  const page = session && (
    <SessionPage
      key={session.id}
      gmToken={shell.token}
      session={session}
      sessions={sessions}
      isActive={session.id === feeds.activeSessionId}
      records={records}
      calendar={calendar}
      context={context}
      party={gm.party}
      actors={gm.actors}
      autosave={gm.autosave}
      phone={shell.phone}
      onChanged={reload}
      onDeleted={() => {
        void reload();
        shell.go(pathForSection("sessions"));
      }}
      onBack={() => shell.go(pathForSection("sessions"))}
      onOpenTemplate={(templateId) => shell.go(templatePath(templateId))}
    />
  );

  if (shell.phone)
    return (
      <div className="story is-phone">
        {page ?? (
          <div className="scroll-y story-phonelist">
            <CodexPhoneBar
              title="Sessions"
              actions={
                <Button size="sm" onClick={() => void create()}>
                  New session
                </Button>
              }
            />
            {error && <Alert tone="danger">{error}</Alert>}
            <SessionRows sessions={sorted} selectedId={null} gm onPick={(id) => shell.go(sessionPath(id))} />
          </div>
        )}
      </div>
    );

  return (
    <div className="story">
      <StoryBar
        view="sessions"
        onView={(view) => shell.go(VIEW_PATH[view])}
        end={
          <Button variant="secondary" size="sm" onClick={() => void create()}>
            <IconPlus /> New session
          </Button>
        }
      >
        <FiltersButton
          open={filtersOpen}
          onToggle={() => setFiltersOpen((open) => !open)}
          controls="story-sessions"
          count={sessionFilterCount(filter)}
        />
      </StoryBar>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="story-stage">
        <SessionsFlyout
          id="story-sessions"
          open={filtersOpen}
          sessions={listed}
          selectedId={selectedId}
          filter={filter}
          gm
          onFilter={setFilter}
          onPick={(id) => {
            setFiltersOpen(false);
            shell.go(sessionPath(id));
          }}
          onClose={() => setFiltersOpen(false)}
        />
        {page ??
          (feeds.sessionFeed.loading ? (
            <div className="story-loading">
              <Skeleton variant="text" />
            </div>
          ) : (
            <div className="story-empty">
              <h3>No sessions yet</h3>
              <p>
                A session is made from a prep template. Its page holds the prep, and after play the recap players read.
              </p>
              <Button variant="primary" onClick={() => void create()}>
                New session
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}

// ----- Players -----

function usePlayerStory() {
  const shell = useCodexShell();
  const { feeds } = usePlayerCodex();
  const knownTitles = useMemo(() => new Set(feeds.pages.map((page) => page.title.trim().toLowerCase())), [feeds.pages]);
  const follow = (target: string) => {
    const match = feeds.pages.find((page) => page.title.trim().toLowerCase() === target.trim().toLowerCase());
    if (match) shell.go(pagePath(match.id));
  };
  const hasPage = (id: string) => feeds.pages.some((page) => page.id === id);
  const quests = useMemo(
    () => feeds.quests.flatMap((quest) => (quest.title ? [{ id: quest.id, title: quest.title }] : [])),
    [feeds.quests]
  );
  const lineOf = (record: StoryRecord) => recordLine(record, quests, feeds.pages);
  return { shell, feeds, knownTitles, follow, hasPage, quests, lineOf };
}

function PlayerPhoneStory({ story }: Readonly<{ story: ReturnType<typeof usePlayerStory> }>) {
  const { shell, feeds, hasPage, knownTitles, follow, lineOf } = story;
  const [opened, setOpened] = useState<string | null>(null);
  const record = feeds.timeline.find((each) => each.id === opened) ?? null;
  return (
    <div className="story is-phone scroll-y">
      <DateBar role="player" calendar={feeds.calendar} />
      <Timeline
        lineOf={lineOf}
        audience="player"
        records={feeds.timeline}
        calendar={feeds.calendar}
        playersDate={feeds.calendar?.currentDate ?? null}
        zoom={zoomOf(shell.query, "ages")}
        year={numberOf(shell.query, "y")}
        month={numberOf(shell.query, "m")}
        phone
        selectedId={opened}
        onZoom={(value) => shell.setFilter({ zoom: value })}
        onShow={(year, month, value) =>
          shell.setFilter({ y: String(year), m: month === null ? null : String(month), zoom: value })
        }
        onSelect={(each) =>
          each.kind === "event" && hasPage(each.id) ? shell.go(pagePath(each.id)) : setOpened(each.id)
        }
      />
      <PlayerDowntime records={feeds.timeline} pages={feeds.pages} onOpenPage={(id) => shell.go(pagePath(id))} />
      <Modal
        open={record !== null}
        onClose={() => setOpened(null)}
        size="md"
        title={record ? CHRONICLE_KIND_META[record.kind].label : ""}
      >
        {record && (
          <CodexMarkdown
            text={record.text}
            token={shell.token}
            onNavigate={follow}
            knownTitles={knownTitles}
            audience="player"
          />
        )}
      </Modal>
    </div>
  );
}

export function PlayerStorySection() {
  const story = usePlayerStory();
  const { shell, feeds, knownTitles, follow } = story;
  const [filtersOpen, setFiltersOpen] = useState(false);
  if (shell.phone) return <PlayerPhoneStory story={story} />;
  return (
    <div className="story">
      <StoryBar
        view="chronicle"
        onView={(view) => shell.go(VIEW_PATH[view])}
        end={
          <FiltersButton
            open={filtersOpen}
            onToggle={() => setFiltersOpen((open) => !open)}
            controls={FLYOUT_ID}
            count={filterCount(shell.query)}
          />
        }
      />
      <div className="story-stage">
        <ChronicleFilters records={feeds.timeline} open={filtersOpen} onClose={() => setFiltersOpen(false)} />
        <PlayerChronicle
          token={shell.token}
          records={filterRecords(feeds.timeline, shell.query)}
          calendar={feeds.calendar}
          sessions={feeds.sessions}
          pages={feeds.pages}
          quests={story.quests}
          focusedId={shell.query.get("entry")}
          year={shell.query.get("y")}
          month={shell.query.get("m")}
          knownTitles={knownTitles}
          onMonthChange={(year, month) => shell.setFilter({ y: String(year), m: String(month) })}
          onOpenSession={(sessionId) => shell.go(sessionPath(sessionId))}
          onFollow={follow}
          dateBar={<DateBar role="player" calendar={feeds.calendar} />}
          downtime={
            <PlayerDowntime records={feeds.timeline} pages={feeds.pages} onOpenPage={(id) => shell.go(pagePath(id))} />
          }
          onOpenEvent={(pageId) => shell.go(pagePath(pageId))}
        />
      </div>
    </div>
  );
}

export function PlayerTimelineSection() {
  const story = usePlayerStory();
  const { shell, feeds, knownTitles, follow, hasPage, lineOf } = story;
  const [selected, setSelected] = useState<string | null>(null);
  if (shell.phone) return <PlayerPhoneStory story={story} />;
  const zoom = zoomOf(shell.query, "ages");
  const record = feeds.timeline.find((each) => each.id === selected) ?? null;
  return (
    <div className="story">
      <StoryBar
        view="timeline"
        onView={(view) => shell.go(VIEW_PATH[view])}
        end={
          <SegmentedControl
            ariaLabel="Zoom"
            value={zoom}
            onChange={(value) => shell.setFilter({ zoom: value })}
            options={TIMELINE_ZOOMS.map((option) => ({ value: option.value, label: option.label }))}
          />
        }
      />
      <Timeline
        lineOf={lineOf}
        audience="player"
        records={feeds.timeline}
        calendar={feeds.calendar}
        playersDate={feeds.calendar?.currentDate ?? null}
        zoom={zoom}
        year={numberOf(shell.query, "y")}
        month={numberOf(shell.query, "m")}
        phone={false}
        selectedId={selected}
        onZoom={(value) => shell.setFilter({ zoom: value })}
        onShow={(year, month, value) =>
          shell.setFilter({ y: String(year), m: month === null ? null : String(month), zoom: value })
        }
        onSelect={(each) => setSelected(each.id)}
        aside={
          <TimelineAside
            record={record}
            calendarLabel={record?.inWorldLabel ?? null}
            token={shell.token}
            audience="player"
            knownTitles={knownTitles}
            onFollow={follow}
            onOpenPage={record && hasPage(record.id) ? (pageId) => shell.go(pagePath(pageId)) : null}
            onClose={() => setSelected(null)}
          />
        }
      />
    </div>
  );
}

export function PlayerSessionsSection() {
  const { shell, feeds, knownTitles, follow, lineOf } = usePlayerStory();
  const [filter, setFilter, filtered] = useSessionFilter();
  const [filtersOpen, setFiltersOpen] = useState(filtered);
  const reads = useReadRecaps(feeds.sessions);
  const listed = useMemo<ListedSession[]>(
    () =>
      feeds.sessions.map((session) => ({
        id: session.id,
        sessionNumber: session.sessionNumber,
        realDate: session.realDate,
        recap: session.recap,
        tags: session.tags,
        status: "played" as const,
        shared: true
      })),
    [feeds.sessions]
  );
  const selectedId = shell.recordId ?? (shell.phone ? null : defaultSessionId(listed, null));
  const session = feeds.sessions.find((each) => each.id === selectedId) ?? null;
  const open = (id: string) => {
    reads.markRead(id);
    shell.go(sessionPath(id));
  };
  const page = session && (
    <PlayerSessionPage
      token={shell.token}
      session={session}
      records={feeds.timeline}
      calendar={feeds.calendar}
      days={sessionDays(feeds.timeline, session.id, feeds.calendar)}
      knownTitles={knownTitles}
      lineOf={lineOf}
      onFollow={follow}
      phone={shell.phone}
    />
  );
  if (shell.phone)
    return (
      <div className="story is-phone scroll-y">
        {session ? (
          <>
            <CodexPhoneBar title={sessionTitle(session)} onBack={() => shell.go(pathForSection("sessions"))} />
            {page}
          </>
        ) : (
          <>
            <CodexPhoneBar title="Sessions" />
            <RecapCards
              token={shell.token}
              sessions={feeds.sessions}
              unseen={reads.unseen}
              knownTitles={knownTitles}
              onFollow={follow}
              onOpen={open}
            />
          </>
        )}
      </div>
    );
  return (
    <div className="story">
      <StoryBar view="sessions" onView={(view) => shell.go(VIEW_PATH[view])}>
        <FiltersButton
          open={filtersOpen}
          onToggle={() => setFiltersOpen((now) => !now)}
          controls="story-sessions"
          count={sessionFilterCount(filter)}
        />
      </StoryBar>
      <div className="story-stage">
        <SessionsFlyout
          id="story-sessions"
          open={filtersOpen}
          sessions={listed}
          selectedId={selectedId}
          filter={filter}
          gm={false}
          onFilter={setFilter}
          onPick={(id) => {
            setFiltersOpen(false);
            open(id);
          }}
          onClose={() => setFiltersOpen(false)}
        />
        <div className="story-sessionstage scroll-y">
          {page ?? <p className="story-hint">No recaps shared yet. Session recaps your GM shares appear here.</p>}
        </div>
      </div>
    </div>
  );
}
