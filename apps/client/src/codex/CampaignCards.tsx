import { useMemo, useState } from "react";
import { Badge, Button, Checklist, Meter, VisibilityBadge } from "@vtt/ui";
import type { CampaignParty, CampaignQuest, CampaignSession, CampaignStanding } from "./CampaignHome";
import {
  CHRONICLE_KIND_META,
  STANDING_METER_MAX,
  standingLabel,
  standingMeterTone,
  standingMeterValue,
  standingTone,
  standingValueLabel
} from "./chronicle";
import { DashCard } from "./DashCard";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityColor, type EntityType } from "./entities";
import { CodexIcon, EntityIcon } from "./icons";
import { openQuests, questProgress } from "./quests";
import { RecordRow } from "./RecordRow";
import { sessionTitle } from "./sessions";

/** The Home dashboard's richer cards. Role-blind like `CampaignHome`: reveal state shows only when passed. */

/** Where this campaign is right now: the next session for the GM, the latest recap for a player. */
export function SessionCard({
  session,
  showReveal,
  onOpenSession,
  onSeeAll
}: Readonly<{
  session: CampaignSession;
  showReveal: boolean;
  onOpenSession?: (sessionId: string) => void;
  onSeeAll?: () => void;
}>) {
  const revealed = showReveal ? session.revealed : undefined;
  return (
    <DashCard
      title={session.heading ?? (onOpenSession ? "Next session" : "Latest recap")}
      iconId="sessions"
      seeAll={onSeeAll && onOpenSession ? { label: "See all sessions", onClick: onSeeAll } : undefined}
    >
      <nav className="codex-campaign-recent" aria-label={session.heading ?? "Session"}>
        {onOpenSession ? (
          <RecordRow
            iconId="sessions"
            title={sessionTitle(session)}
            revealed={revealed}
            when={session.realDate}
            onClick={() => onOpenSession(session.id)}
          />
        ) : (
          <div className="codex-campaign-sessionrow">
            <CodexIcon iconId="sessions" className="codex-ent-icon codex-campaign-recentglyph" />
            <span className="codex-list-title">{sessionTitle(session)}</span>
            {revealed !== undefined && <VisibilityBadge revealed={revealed} />}
            {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
          </div>
        )}
      </nav>
      {session.recap.trim() && <p className="codex-campaign-sessionrecap">{session.recap}</p>}
    </DashCard>
  );
}

/** Where the party is: only when a pin exists and the reader may see it. */
export function PartyCard({
  party,
  showReveal,
  onOpenParty
}: Readonly<{
  party: CampaignParty;
  showReveal: boolean;
  onOpenParty?: (mapId: string, markerId: string) => void;
}>) {
  return (
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
  );
}

export function QuestsCard({
  quests,
  showReveal,
  onOpenQuest,
  onSeeAll
}: Readonly<{
  quests: readonly CampaignQuest[];
  showReveal: boolean;
  onOpenQuest?: (questId: string) => void;
  onSeeAll?: () => void;
}>) {
  const open = useMemo(() => openQuests(quests), [quests]);
  const shown = open.slice(0, 5);
  return (
    <DashCard
      title="Open quests"
      iconId="quest"
      count={{ shown: shown.length, total: open.length }}
      seeAll={onSeeAll ? { label: "See all quests", onClick: onSeeAll } : undefined}
      empty="No open quests."
    >
      {shown.length > 0 ? (
        <nav className="codex-campaign-recent" aria-label="Open quests">
          {shown.map((quest) => {
            const progress = questProgress(quest.objectives);
            const progressLabel = progress.total > 0 && (
              <span className="codex-campaign-questprogress">{progress.label}</span>
            );
            return (
              <div key={quest.id} className="codex-campaign-quest">
                {onOpenQuest ? (
                  <RecordRow
                    iconId="quest"
                    title={quest.title}
                    revealed={showReveal ? quest.revealed : undefined}
                    onClick={() => onOpenQuest(quest.id)}
                  >
                    {progressLabel}
                  </RecordRow>
                ) : (
                  <div className="codex-campaign-questrow">
                    <CodexIcon iconId="quest" className="codex-ent-icon codex-campaign-recentglyph" />
                    <span className="codex-list-title">{quest.title}</span>
                    {progressLabel}
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
  );
}

/** Bounded to five rows, strongest first; "See all" expands in place because Adjust only exists here. */
export function StandingCard({
  standing,
  showReveal,
  onOpenPage,
  onAdjustStanding
}: Readonly<{
  standing: readonly CampaignStanding[];
  showReveal: boolean;
  onOpenPage: (pageId: string) => void;
  onAdjustStanding?: (factionPageId: string) => void;
}>) {
  const sorted = useMemo(
    () => [...standing].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name)),
    [standing]
  );
  const [wanted, setLimit] = useState(5);
  // Clamped to the live total so a stale expanded limit can't persist.
  const limit = Math.min(wanted, Math.max(sorted.length, 5));
  const shown = sorted.slice(0, limit);
  if (sorted.length === 0) return null;
  return (
    <DashCard
      title="Faction standing"
      iconId={CHRONICLE_KIND_META.standing.iconId}
      count={{ shown: shown.length, total: sorted.length }}
      seeAll={
        sorted.length > shown.length
          ? { label: `See all ${sorted.length} factions`, onClick: () => setLimit(sorted.length) }
          : limit > 5
            ? { label: "Show fewer", onClick: () => setLimit(5) }
            : undefined
      }
    >
      <div className="codex-campaign-standings">
        {shown.map((faction) => (
          <div key={faction.factionPageId} className="codex-campaign-standing">
            <div className="codex-campaign-standingrow">
              <RecordRow
                iconId={CHRONICLE_KIND_META.standing.iconId}
                title={faction.name}
                className="codex-campaign-standingname"
                onClick={() => onOpenPage(faction.factionPageId)}
              />
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
  );
}

export function KindsCard({
  pages,
  onPickType
}: Readonly<{ pages: ReadonlyArray<Readonly<{ entityType: EntityType }>>; onPickType: (type: EntityType) => void }>) {
  const byType = useMemo(() => {
    const counts = {} as Record<EntityType, number>;
    for (const page of pages) counts[page.entityType] = (counts[page.entityType] ?? 0) + 1;
    return counts;
  }, [pages]);
  return (
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
  );
}

/** The empty state links to pages, where tags are added; a populated card is already the full list. */
export function TagsCard({
  tags,
  onPickTag,
  onSeePages
}: Readonly<{
  tags: ReadonlyArray<readonly [tag: string, count: number]>;
  onPickTag: (tag: string) => void;
  onSeePages?: () => void;
}>) {
  return (
    <DashCard
      title="Tags"
      iconId="flag"
      empty="No tags yet. Tags are added on a page while you write it, and every one you use collects here."
      seeAll={tags.length === 0 && onSeePages ? { label: "See all pages", onClick: onSeePages } : undefined}
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
  );
}
