import { useMemo } from "react";
import { Alert, Badge, Button, Skeleton, type ChecklistItem } from "@vtt/ui";
import type { CodexChronicleKind, CodexQuestStatus } from "@vtt/domain";
import type { EntityType } from "./entities";
import { CHRONICLE_KIND_META, deadlineStateLabel, deadlineStateTone } from "./chronicle";
import { DashCard } from "./DashCard";
import { KindsCard, PartyCard, QuestsCard, SessionCard, StandingCard, TagsCard } from "./CampaignCards";
import { RecordRow } from "./RecordRow";

/**
 * Home: every card is a `DashCard` (heading, bounded body, empty state, link to the full section).
 * Presentational and role-blind: both audiences render it, so it never fetches and its prop types cannot
 * carry GM bodies. GM-only cards arrive through capability props the player caller doesn't pass.
 */

/**
 * Satisfied by both the GM and player page summaries. `updatedAt` is GM-only and moves on every save;
 * `playerUpdatedAt` moves only for what players can see, and is the only edit time a player receives.
 */
type CampaignEntity = Readonly<{
  id: string;
  title: string;
  entityType: EntityType;
  tags: readonly string[];
  updatedAt?: string;
  playerUpdatedAt: string;
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
 * No `prep` field, deliberately: a shared type that could carry the prep would put the GM's plan one
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
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of pages) for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [pages]);
  // The GM sees their own last saves; a player sees the pages whose shared half changed last.
  const recent = useMemo(() => {
    const changedAt = (page: CampaignEntity) => page.updatedAt ?? page.playerUpdatedAt;
    return [...pages].sort((a, b) => changedAt(b).localeCompare(changedAt(a))).slice(0, 10);
  }, [pages]);
  const revealed = useMemo(() => pages.filter((page) => page.revealedToPlayers).length, [pages]);
  const recentEntries = entries.slice(0, 5);
  const deadlineList = deadlines.slice(0, 5);
  const downtimeList = downtimePending.slice(0, 5);
  /** A row's reveal badge, for the GM only. */
  const shown = (value: boolean | undefined) => (showReveal ? value : undefined);

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
          <FirstPage onCreate={onCreate} />
        ) : (
          <div className="codex-main-empty">
            <h3>Nothing shared yet</h3>
            <p>Pages your GM shares appear here, organized by kind and tag.</p>
          </div>
        )}
      </div>
    );
  }

  // A GM with no pages yet starts with the first one; cards with nothing in them wait until there is something.
  const fresh = showReveal && pages.length === 0;
  return (
    <div className="codex-campaign">
      {error && (
        <Alert tone="danger" title="Couldn't load the campaign">
          {error}
        </Alert>
      )}

      {fresh && <FirstPage onCreate={onCreate} />}

      <div className="codex-campaign-stats" hidden={fresh}>
        <div className="codex-campaign-stat">
          <span className="codex-campaign-statnum">{pages.length}</span>
          <span>{pages.length === 1 ? "page" : "pages"}</span>
        </div>
        {showReveal && (
          <div className="codex-campaign-stat">
            <span className="codex-campaign-statnum">{revealed}</span>
            <span>shown to players</span>
          </div>
        )}
        <div className="codex-campaign-stat">
          <span className="codex-campaign-statnum">{tags.length}</span>
          <span>{tags.length === 1 ? "tag" : "tags"}</span>
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
          <SessionCard
            session={session}
            showReveal={showReveal}
            onOpenSession={onOpenSession}
            onSeeAll={onSeeAll && (() => onSeeAll("sessions"))}
          />
        )}

        {/* 2. Where the party is. The GM's empty state links to the Atlas, where pins are placed. */}
        {party && <PartyCard party={party} showReveal={showReveal} onOpenParty={onOpenParty} />}
        {!party && showReveal && !fresh && (
          <DashCard
            title="Party location"
            iconId="pin"
            empty="No party pin yet. Drop one from a map's pin inspector and the party shows up here."
            seeAll={onSeeAll ? { label: "Open the Atlas", onClick: () => onSeeAll("atlas") } : undefined}
          />
        )}

        {/* 3. Open quests. */}
        {!(fresh && quests.length === 0) && (
          <QuestsCard
            quests={quests}
            showReveal={showReveal}
            onOpenQuest={onOpenQuest}
            onSeeAll={onSeeAll && (() => onSeeAll("quests"))}
          />
        )}

        {/* 4. Deadlines, passed ones kept. */}
        {!(fresh && deadlines.length === 0) && (
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
                  <RecordRow
                    key={deadline.id}
                    iconId={CHRONICLE_KIND_META.deadline.iconId}
                    title={deadline.summary || "Untitled deadline"}
                    revealed={shown(deadline.revealed)}
                    when={deadline.when}
                    whenClassName="codex-campaign-deadlinewhen"
                    onClick={() => onOpenEntry(deadline.id)}
                  >
                    <Badge tone={deadlineStateTone(deadline.fired)}>{deadlineStateLabel(deadline.fired)}</Badge>
                  </RecordRow>
                ))}
              </nav>
            ) : null}
          </DashCard>
        )}

        {/* 5. Downtime awaiting confirmation (GM-only). */}
        {onOpenDowntime && !(fresh && downtimePending.length === 0) && (
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
                  <RecordRow
                    key={row.id}
                    iconId="campfire"
                    title={`${row.who || "Someone"} · ${row.days} ${row.days === 1 ? "day" : "days"}${row.activity ? `: ${row.activity}` : ""}`}
                    revealed={shown(row.revealed)}
                    when={row.when}
                    onClick={() => onOpenEntry(row.id)}
                  />
                ))}
              </nav>
            ) : null}
          </DashCard>
        )}

        {/* 6. Latest journal activity. */}
        {!(fresh && entries.length === 0) && (
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
                    <RecordRow
                      key={entry.id}
                      iconId={meta.iconId}
                      title={entry.summary || "Untitled entry"}
                      revealed={shown(entry.revealed)}
                      when={entry.when}
                      onClick={() => onOpenEntry(entry.id)}
                    >
                      {entry.kind !== "entry" && <Badge tone={meta.tone}>{meta.label}</Badge>}
                    </RecordRow>
                  );
                })}
              </nav>
            ) : null}
          </DashCard>
        )}

        {/* 7. Faction standing, which expands in place (Adjust lives only here). */}
        <StandingCard
          standing={standing}
          showReveal={showReveal}
          onOpenPage={onOpenPage}
          onAdjustStanding={onAdjustStanding}
        />

        {/* 8. By kind. */}
        {!fresh && <KindsCard pages={pages} onPickType={onPickType} />}

        {/* 9. Atlas. */}
        {!(fresh && maps.length === 0) && (
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
                  <RecordRow
                    key={map.id}
                    iconId="compass"
                    title={map.name}
                    revealed={shown(map.revealedToPlayers)}
                    onClick={() => onOpenMap(map.id)}
                  />
                ))}
              </nav>
            ) : null}
          </DashCard>
        )}

        {/* 10. Recently updated. */}
        {!fresh && (
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
                  <RecordRow
                    key={page.id}
                    entityType={page.entityType}
                    title={page.title}
                    revealed={shown(page.revealedToPlayers)}
                    onClick={() => onOpenPage(page.id)}
                  />
                ))}
              </nav>
            ) : null}
          </DashCard>
        )}

        {/* 11. Tags. */}
        {!fresh && (
          <TagsCard
            tags={tags}
            gm={showReveal}
            onPickTag={onPickTag}
            onSeePages={onSeeAll && (() => onSeeAll("recent"))}
          />
        )}
      </div>
    </div>
  );
}

/** The GM's first step in an empty Codex: what a page is, and the button that makes one. */
function FirstPage({ onCreate }: Readonly<{ onCreate?: () => void }>) {
  return (
    <section className="codex-main-empty codex-first-page" aria-labelledby="codex-first-page">
      <h3 id="codex-first-page">Make your first page</h3>
      <p>
        A page holds one person, place, faction or thing in your world. It has notes the players can read once you show
        it, and notes only you see.
      </p>
      {onCreate && (
        <Button variant="primary" onClick={onCreate}>
          New page
        </Button>
      )}
    </section>
  );
}
