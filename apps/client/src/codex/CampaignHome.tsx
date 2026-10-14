import { useMemo, useState } from "react";
import { Alert, Badge, Button, Checklist, Meter, Skeleton, VisibilityBadge, type ChecklistItem } from "@vtt/ui";
import { CodexIcon, EntityIcon } from "./icons";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityColor, type EntityType } from "./entities";
import { sessionTitle } from "./sessions";
import { openQuests, questProgress } from "./quests";
import {
  CHRONICLE_KIND_META,
  STANDING_METER_MAX,
  deadlineStateLabel,
  deadlineStateTone,
  standingLabel,
  standingMeterTone,
  standingMeterValue,
  standingTone,
  standingValueLabel
} from "./chronicle";
import { DashCard } from "./DashCard";
import type { CodexChronicleKind, CodexQuestStatus } from "./api";

/**
 * Home: every card is a `DashCard` (heading, bounded body, empty state, link to the full section).
 * Presentational and role-blind: both audiences render it, so it never fetches and its prop types cannot
 * carry GM bodies. GM-only cards arrive through capability props the player caller doesn't pass.
 */

/** Satisfied by both the GM and player page summaries. */
type CampaignEntity = Readonly<{
  id: string;
  title: string;
  entityType: EntityType;
  tags: readonly string[];
  updatedAt: string;
  revealedToPlayers?: boolean;
}>;
/** One journal row, flattened by the caller from either projection. `revealed` is GM-only and optional. */
export type CampaignEntry = Readonly<{
  id: string;
  summary: string;
  when: string;
  kind: CodexChronicleKind;
  revealed?: boolean;
}>;
/** `revealedToPlayers` is GM-only and absent from a player's maps. */
export type CampaignMap = Readonly<{ id: string; name: string; revealedToPlayers?: boolean }>;
/**
 * No `prep` field, deliberately: a shared type that could carry `prepBody` would put the GM's plan one
 * spread away from a component players render. The caller computes `heading` ("Next", "This" or "Last session").
 */
export type CampaignSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  realDate: string | null;
  recap: string;
  heading?: string;
  revealed?: boolean;
}>;
/** No `gmBody` or `body`: the type not having them is the guarantee. */
export type CampaignQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  objectives: readonly ChecklistItem[];
  revealed?: boolean;
}>;
/** No `gmText`, for the same reason. */
export type CampaignDeadline = Readonly<{
  id: string;
  summary: string;
  when: string;
  fired: boolean;
  revealed?: boolean;
}>;
/** GM-only by construction: `applied` isn't on the player payload, so a player caller can't build this list. */
export type CampaignDowntime = Readonly<{
  id: string;
  who: string;
  activity: string;
  days: number;
  when: string;
  revealed?: boolean;
}>;
/** `null` covers both "no party pin" and, for a player, "hidden from you". */
export type CampaignParty = Readonly<{
  label: string | null;
  mapId: string;
  mapName: string;
  markerId: string;
  revealed?: boolean;
}>;
/** No `revealedToPlayers` on the shared shape. */
export type CampaignStanding = Readonly<{ factionPageId: string; name: string; value: number; revealed?: boolean }>;

/** Section names for "See all"; the caller owns the addresses. */
export type CampaignSeeAll =
  "pages" | "quests" | "journal" | "deadlines" | "downtime" | "sessions" | "atlas" | "recent";

export function CampaignHome({
  pages,
  entries = [],
  maps = [],
  today = null,
  session = null,
  quests = [],
  deadlines = [],
  standing = [],
  downtimePending = [],
  party = null,
  onPickType,
  onPickTag,
  onOpenPage,
  onOpenEntry,
  onOpenMap,
  onOpenSession,
  onOpenQuest,
  onAdjustStanding,
  onOpenDowntime,
  onOpenParty,
  onSeeAll,
  onCreate,
  showReveal = true,
  loading = false,
  error = null
}: Readonly<{
  pages: readonly CampaignEntity[];
  entries?: readonly CampaignEntry[];
  maps?: readonly CampaignMap[];
  today?: string | null;
  session?: CampaignSession | null;
  quests?: readonly CampaignQuest[];
  deadlines?: readonly CampaignDeadline[];
  standing?: readonly CampaignStanding[];
  /** GM-only: downtime not yet confirmed. */
  downtimePending?: readonly CampaignDowntime[];
  /** Where the party pin is, or null. */
  party?: CampaignParty | null;
  onPickType: (type: EntityType) => void;
  onPickTag: (tag: string) => void;
  onOpenPage: (pageId: string) => void;
  onOpenEntry: (entryId: string) => void;
  onOpenMap: (mapId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenQuest?: (questId: string) => void;
  onAdjustStanding?: (factionPageId: string) => void;
  onOpenDowntime?: () => void;
  onOpenParty?: (mapId: string, markerId: string) => void;
  onSeeAll?: (section: CampaignSeeAll) => void;
  onCreate?: () => void;
  showReveal?: boolean;
  loading?: boolean;
  error?: string | null;
}>) {
  const byType = useMemo(() => {
    const counts = {} as Record<EntityType, number>;
    for (const page of pages) counts[page.entityType] = (counts[page.entityType] ?? 0) + 1;
    return counts;
  }, [pages]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of pages) for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [pages]);
  const recent = useMemo(() => [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10), [pages]);
  const revealed = useMemo(() => pages.filter((page) => page.revealedToPlayers).length, [pages]);
  const recentEntries = useMemo(() => entries.slice(0, 5), [entries]);
  const openQuestList = useMemo(() => openQuests(quests).slice(0, 5), [quests]);
  const deadlineList = useMemo(() => deadlines.slice(0, 5), [deadlines]);
  const downtimeList = useMemo(() => downtimePending.slice(0, 5), [downtimePending]);
  /** Bounded to five rows, strongest first; "See all" expands in place because Adjust only exists here. */
  const standingSorted = useMemo(
    () => [...standing].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name)),
    [standing]
  );
  const [standingLimit, setStandingLimit] = useStandingLimit(standingSorted.length);
  const standingList = standingSorted.slice(0, standingLimit);

  const nothingYet =
    pages.length === 0 &&
    entries.length === 0 &&
    maps.length === 0 &&
    !session &&
    quests.length === 0 &&
    deadlines.length === 0 &&
    standing.length === 0;
  if (loading && nothingYet)
    return (
      <div className="codex-main-loading">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="text" />
        ))}
      </div>
    );
  if (nothingYet) {
    return (
      <div className="codex-campaign">
        {error && (
          <Alert tone="danger" title="Couldn't load the campaign">
            {error}
          </Alert>
        )}
        {showReveal ? (
          <div className="codex-main-empty">
            <h3>No pages yet</h3>
            <p>Create characters, locations, factions and more. They are organized here by kind and tag.</p>
            {onCreate && (
              <Button variant="primary" onClick={onCreate}>
                New page
              </Button>
            )}
          </div>
        ) : (
          <div className="codex-main-empty">
            <h3>Nothing shared yet</h3>
            <p>Pages your GM shares appear here, organized by kind and tag.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="codex-campaign">
      {error && (
        <Alert tone="danger" title="Couldn't load the campaign">
          {error}
        </Alert>
      )}

      <div className="codex-campaign-stats">
        <div className="codex-campaign-stat">
          <span className="codex-campaign-statnum">{pages.length}</span>
          <span>pages</span>
        </div>
        {showReveal && (
          <div className="codex-campaign-stat">
            <span className="codex-campaign-statnum">{revealed}</span>
            <span>shown to players</span>
          </div>
        )}
        <div className="codex-campaign-stat">
          <span className="codex-campaign-statnum">{tags.length}</span>
          <span>tags</span>
        </div>
        <div className="codex-campaign-stat">
          <span className="codex-campaign-statnum">{maps.length}</span>
          <span>{maps.length === 1 ? "map" : "maps"}</span>
        </div>
        <div className="codex-campaign-stat">
          <span className="codex-campaign-statnum">{entries.length}</span>
          <span>journal {entries.length === 1 ? "entry" : "entries"}</span>
        </div>
        {/* Two-clock vocabulary: the GM sees their own prep clock, a player sees the published date. */}
        {today && (
          <div className="codex-campaign-today">
            <span className="codex-now-chip">
              {showReveal ? "Your date" : "Today"}: {today}
            </span>
          </div>
        )}
      </div>

      <div className="codex-dashgrid">
        {/* 1. Where this campaign is right now. */}
        {session && (
          <DashCard
            title={session.heading ?? (onOpenSession ? "Next session" : "Latest recap")}
            iconId="sessions"
            seeAll={
              onSeeAll && onOpenSession ? { label: "See all sessions", onClick: () => onSeeAll("sessions") } : undefined
            }
          >
            <nav className="codex-campaign-recent" aria-label={session.heading ?? "Session"}>
              {onOpenSession ? (
                <button type="button" className="codex-campaign-recentitem" onClick={() => onOpenSession(session.id)}>
                  <CodexIcon iconId="sessions" className="codex-ent-icon codex-campaign-recentglyph" />
                  <span className="codex-list-title">{sessionTitle(session)}</span>
                  {/* Every row naming a record states its reveal state; player callers omit the field. */}
                  {showReveal && session.revealed !== undefined && <VisibilityBadge revealed={session.revealed} />}
                  {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
                </button>
              ) : (
                <div className="codex-campaign-sessionrow">
                  <CodexIcon iconId="sessions" className="codex-ent-icon codex-campaign-recentglyph" />
                  <span className="codex-list-title">{sessionTitle(session)}</span>
                  {showReveal && session.revealed !== undefined && <VisibilityBadge revealed={session.revealed} />}
                  {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
                </div>
              )}
            </nav>
            {session.recap.trim() && <p className="codex-campaign-sessionrecap">{session.recap}</p>}
          </DashCard>
        )}

        {/* 2. Where the party is: only when a pin exists and the reader may see it. */}
        {party && (
          <DashCard title="Party location" iconId="pin">
            <p className="codex-campaign-partyline">
              The party is at <strong>{party.label?.trim() || "an unlabelled pin"}</strong> on{" "}
              <strong>{party.mapName}</strong>.
            </p>
            {/* The pin's own state; the map's switch lives in the Atlas with it. */}
            {showReveal && party.revealed !== undefined && (
              <p className="codex-campaign-partyreveal">
                <VisibilityBadge revealed={party.revealed} />
              </p>
            )}
            {onOpenParty && (
              <Button variant="secondary" size="sm" onClick={() => onOpenParty(party.mapId, party.markerId)}>
                Show the pin
              </Button>
            )}
          </DashCard>
        )}
        {!party && showReveal && (
          /* The empty state links to the Atlas, where pins are placed. */
          <DashCard
            title="Party location"
            iconId="pin"
            empty="No party pin yet. Drop one from a map's pin inspector and the party shows up here."
            seeAll={onSeeAll ? { label: "Open the Atlas", onClick: () => onSeeAll("atlas") } : undefined}
          />
        )}

        {/* 3. Open quests. */}
        <DashCard
          title="Open quests"
          iconId="quest"
          count={{ shown: openQuestList.length, total: openQuests(quests).length }}
          seeAll={onSeeAll ? { label: "See all quests", onClick: () => onSeeAll("quests") } : undefined}
          empty="No open quests."
        >
          {openQuestList.length > 0 ? (
            <nav className="codex-campaign-recent" aria-label="Open quests">
              {openQuestList.map((quest) => {
                const progress = questProgress(quest.objectives);
                return (
                  <div key={quest.id} className="codex-campaign-quest">
                    {onOpenQuest ? (
                      <button type="button" className="codex-campaign-recentitem" onClick={() => onOpenQuest(quest.id)}>
                        <CodexIcon iconId="quest" className="codex-ent-icon codex-campaign-recentglyph" />
                        <span className="codex-list-title">{quest.title}</span>
                        {progress.total > 0 && <span className="codex-campaign-questprogress">{progress.label}</span>}
                        {showReveal && quest.revealed !== undefined && <VisibilityBadge revealed={quest.revealed} />}
                      </button>
                    ) : (
                      <div className="codex-campaign-questrow">
                        <CodexIcon iconId="quest" className="codex-ent-icon codex-campaign-recentglyph" />
                        <span className="codex-list-title">{quest.title}</span>
                        {progress.total > 0 && <span className="codex-campaign-questprogress">{progress.label}</span>}
                      </div>
                    )}
                    {/* Read-only for both audiences: no `onChange`, no checkbox. */}
                    {quest.objectives.length > 0 && (
                      <Checklist
                        items={quest.objectives}
                        ariaLabel={`Objectives for ${quest.title}`}
                        className="codex-campaign-questlist"
                      />
                    )}
                  </div>
                );
              })}
            </nav>
          ) : null}
        </DashCard>

        {/* 4. Deadlines, passed ones kept. */}
        <DashCard
          title="Deadlines"
          iconId={CHRONICLE_KIND_META.deadline.iconId}
          count={{ shown: deadlineList.length, total: deadlines.length }}
          seeAll={onSeeAll ? { label: "See all deadlines", onClick: () => onSeeAll("deadlines") } : undefined}
          empty="No deadlines yet."
        >
          {deadlineList.length > 0 ? (
            <nav className="codex-campaign-recent" aria-label="Deadlines">
              {deadlineList.map((deadline) => (
                <button
                  key={deadline.id}
                  type="button"
                  className="codex-campaign-recentitem"
                  onClick={() => onOpenEntry(deadline.id)}
                >
                  <CodexIcon
                    iconId={CHRONICLE_KIND_META.deadline.iconId}
                    className="codex-ent-icon codex-campaign-recentglyph"
                  />
                  <span className="codex-list-title">{deadline.summary || "Untitled deadline"}</span>
                  <Badge tone={deadlineStateTone(deadline.fired)}>{deadlineStateLabel(deadline.fired)}</Badge>
                  {showReveal && deadline.revealed !== undefined && <VisibilityBadge revealed={deadline.revealed} />}
                  {deadline.when && <span className="codex-campaign-deadlinewhen">{deadline.when}</span>}
                </button>
              ))}
            </nav>
          ) : null}
        </DashCard>

        {/* 5. Downtime awaiting confirmation (GM-only). */}
        {onOpenDowntime && (
          <DashCard
            title="Downtime pending"
            iconId="campfire"
            count={{ shown: downtimeList.length, total: downtimePending.length }}
            seeAll={{ label: "Open the tracker", onClick: onOpenDowntime }}
            empty="No downtime waiting for confirmation."
          >
            {downtimeList.length > 0 ? (
              <nav className="codex-campaign-recent" aria-label="Downtime pending">
                {downtimeList.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="codex-campaign-recentitem"
                    onClick={() => onOpenEntry(row.id)}
                  >
                    <CodexIcon iconId="campfire" className="codex-ent-icon codex-campaign-recentglyph" />
                    <span className="codex-list-title">
                      {row.who || "Someone"} · {row.days} {row.days === 1 ? "day" : "days"}
                      {row.activity ? `: ${row.activity}` : ""}
                    </span>
                    {showReveal && row.revealed !== undefined && <VisibilityBadge revealed={row.revealed} />}
                    {row.when && <span className="codex-campaign-recentwhen">{row.when}</span>}
                  </button>
                ))}
              </nav>
            ) : null}
          </DashCard>
        )}

        {/* 6. Latest journal activity. */}
        <DashCard
          title="Latest journal activity"
          iconId="book"
          count={{ shown: recentEntries.length, total: entries.length }}
          seeAll={onSeeAll ? { label: "Open the Journal", onClick: () => onSeeAll("journal") } : undefined}
          empty="No journal entries yet."
        >
          {recentEntries.length > 0 ? (
            <nav className="codex-campaign-recent" aria-label="Latest journal activity">
              {recentEntries.map((entry) => {
                const meta = CHRONICLE_KIND_META[entry.kind];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="codex-campaign-recentitem"
                    onClick={() => onOpenEntry(entry.id)}
                  >
                    <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-campaign-recentglyph" />
                    <span className="codex-list-title">{entry.summary || "Untitled entry"}</span>
                    {entry.kind !== "entry" && <Badge tone={meta.tone}>{meta.label}</Badge>}
                    {showReveal && entry.revealed !== undefined && <VisibilityBadge revealed={entry.revealed} />}
                    {entry.when && <span className="codex-campaign-recentwhen">{entry.when}</span>}
                  </button>
                );
              })}
            </nav>
          ) : null}
        </DashCard>

        {/* 7. Faction standing, expanding in place (Adjust lives only here). */}
        {standingSorted.length > 0 && (
          <DashCard
            title="Faction standing"
            iconId={CHRONICLE_KIND_META.standing.iconId}
            count={{ shown: standingList.length, total: standingSorted.length }}
            seeAll={
              standingSorted.length > standingList.length
                ? {
                    label: `See all ${standingSorted.length} factions`,
                    onClick: () => setStandingLimit(standingSorted.length)
                  }
                : standingLimit > 5
                  ? { label: "Show fewer", onClick: () => setStandingLimit(5) }
                  : undefined
            }
          >
            <div className="codex-campaign-standings">
              {standingList.map((faction) => (
                <div key={faction.factionPageId} className="codex-campaign-standing">
                  <div className="codex-campaign-standingrow">
                    <button
                      type="button"
                      className="codex-campaign-recentitem codex-campaign-standingname"
                      onClick={() => onOpenPage(faction.factionPageId)}
                    >
                      <CodexIcon
                        iconId={CHRONICLE_KIND_META.standing.iconId}
                        className="codex-ent-icon codex-campaign-recentglyph"
                      />
                      <span className="codex-list-title">{faction.name}</span>
                    </button>
                    <Badge tone={standingTone(faction.value)}>{standingLabel(faction.value)}</Badge>
                    <span className="codex-campaign-standingvalue">{standingValueLabel(faction.value)}</span>
                    {showReveal && faction.revealed !== undefined && <VisibilityBadge revealed={faction.revealed} />}
                    {/* Default-size Button (no ::after): this row wraps and an overhang would hit the next faction's control. */}
                    {onAdjustStanding && (
                      <Button variant="ghost" onClick={() => onAdjustStanding(faction.factionPageId)}>
                        Adjust
                      </Button>
                    )}
                  </div>
                  {/* Hidden from AT: the word and signed number carry the meaning, and the bar would announce shifted values. */}
                  <div className="codex-campaign-standingmeter" aria-hidden="true">
                    <Meter
                      value={standingMeterValue(faction.value)}
                      max={STANDING_METER_MAX}
                      tone={standingMeterTone(faction.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </DashCard>
        )}

        {/* 8. By kind. */}
        <DashCard title="By kind" iconId="scroll" empty="No pages yet.">
          {Object.keys(byType).length > 0 ? (
            <div className="codex-campaign-types">
              {ENTITY_TYPE_LIST.filter((type) => byType[type]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="codex-campaign-typecard"
                  style={{ borderLeftColor: entityColor(type) }}
                  onClick={() => onPickType(type)}
                >
                  <span
                    className="codex-campaign-typeicon"
                    style={{ background: `color-mix(in srgb, ${entityColor(type)} 22%, transparent)` }}
                    aria-hidden="true"
                  >
                    <EntityIcon type={type} className="codex-campaign-typeglyph" />
                  </span>
                  <span className="codex-campaign-typelabel">{ENTITY_DEFS[type].label}</span>
                  <span className="codex-campaign-typecount" style={{ color: entityColor(type) }}>
                    {byType[type]}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </DashCard>

        {/* 9. Atlas. */}
        <DashCard
          title="Atlas"
          iconId="compass"
          count={{ shown: Math.min(maps.length, 5), total: maps.length }}
          seeAll={onSeeAll ? { label: "Open the Atlas", onClick: () => onSeeAll("atlas") } : undefined}
          empty="No maps yet."
        >
          {maps.length > 0 ? (
            <nav className="codex-campaign-recent" aria-label="Maps in the atlas">
              {maps.slice(0, 5).map((map) => (
                <button
                  key={map.id}
                  type="button"
                  className="codex-campaign-recentitem"
                  onClick={() => onOpenMap(map.id)}
                >
                  <CodexIcon iconId="compass" className="codex-ent-icon codex-campaign-recentglyph" />
                  <span className="codex-list-title">{map.name}</span>
                  {showReveal && map.revealedToPlayers !== undefined && (
                    <VisibilityBadge revealed={map.revealedToPlayers} />
                  )}
                </button>
              ))}
            </nav>
          ) : null}
        </DashCard>

        {/* 10. Recently updated. */}
        <DashCard
          title="Recently updated"
          iconId="scroll"
          count={{ shown: recent.length, total: pages.length }}
          seeAll={onSeeAll ? { label: "See all pages", onClick: () => onSeeAll("recent") } : undefined}
          empty="No pages yet."
        >
          {recent.length > 0 ? (
            <nav className="codex-campaign-recent" aria-label="Recently updated pages">
              {recent.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className="codex-campaign-recentitem"
                  onClick={() => onOpenPage(page.id)}
                >
                  <EntityIcon type={page.entityType} className="codex-campaign-recentglyph" />
                  <span className="codex-list-title">{page.title}</span>
                  {showReveal && page.revealedToPlayers !== undefined && (
                    <VisibilityBadge revealed={page.revealedToPlayers} />
                  )}
                </button>
              ))}
            </nav>
          ) : null}
        </DashCard>

        {/* 11. Tags. The empty state links to pages, where tags are added; a populated card is already the full list. */}
        <DashCard
          title="Tags"
          iconId="flag"
          empty="No tags yet. Tags are added on a page while you write it, and every one you use collects here."
          seeAll={
            tags.length === 0 && onSeeAll ? { label: "See all pages", onClick: () => onSeeAll("recent") } : undefined
          }
        >
          {tags.length > 0 ? (
            <div className="codex-campaign-tags">
              {tags.map(([tag, count]) => (
                <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => onPickTag(tag)}>
                  {tag}
                  <span className="codex-tag-count">{count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </DashCard>
      </div>
    </div>
  );
}

/** Five rows by default, expanded in place. Clamped to the live total so a stale expanded limit can't persist. */
function useStandingLimit(total: number): [number, (next: number) => void] {
  const [limit, setLimit] = useState(5);
  return [Math.min(limit, Math.max(total, 5)), setLimit];
}
