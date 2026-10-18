import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, IconChevronRight, IconSparkle, Skeleton, cx } from "@vtt/ui";
import type { CodexRecordKind } from "@vtt/domain";
import { sessionApi } from "../api";
import { findApi } from "../api-records";
import type { CodexHome, CodexRevealCheckRow, CodexSearchType } from "../contract";
import { CodexMarkdown } from "../CodexMarkdown";
import { clocksOf, nextSessionCard } from "./rules";
import { deadlineStateLabel } from "../chronicle";
import { entityDef } from "../entities";
import { CodexIcon, EntityIcon } from "../icons";
import { pickNextSession } from "../sessions";
import { atlasPath, journalEntryPath, pathForHit, pathForSection, questPath, searchPath, sessionPath } from "../routes";
import { withQuery } from "../../router";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useGmCodex, usePlayerCodex } from "../shell/context";
import { AudienceChip } from "../shared/WhoSeesIt";
import { DateBar } from "../shared/DateBar";
import { MiniMap } from "../shared/MiniMap";
import { KIND_GROUPS, type KindGroup } from "../page/document";
import { RevealedCount } from "../page/PagesIndex";
import { SEARCH_TYPE_LABEL, modifiedLabel } from "../search/searchParams";
import { useCodexQuery } from "../useCodexQuery";
import "./home.css";

const PAGE_TYPES = new Set<CodexSearchType>(KIND_GROUPS.flatMap((group) => group.types));

/** A card on Home: a plate with its heading, an optional count, and what it holds. */
function Card({
  title,
  icon,
  count,
  gm = false,
  aside,
  children,
  className
}: Readonly<{
  title: string;
  icon: string;
  count?: number;
  gm?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <section className={cx("cx-card", gm && "is-gm", className)} aria-label={title}>
      <div className="cx-card-head">
        <CodexIcon iconId={icon} className="cx-card-icon" />
        <h2 className="cx-card-title">{title}</h2>
        {aside}
        {count !== undefined && <span className="cx-card-count">{count}</span>}
      </div>
      {children}
    </section>
  );
}

/** Where the party is, as a still map at the party's pin, opening the atlas there. */
function PartyCard({
  token,
  party,
  maps,
  height,
  gm,
  go
}: Readonly<{
  token: string;
  party: Readonly<{
    marker: Readonly<{
      id: string;
      mapId: string;
      x: number;
      y: number;
      iconId: string;
      iconColor: string;
      label: string | null;
      revealedToPlayers?: boolean;
    }>;
    mapName: string;
  }> | null;
  maps: ReadonlyArray<Readonly<{ id: string; assetId: string }>>;
  height: number;
  gm: boolean;
  go: (path: string) => void;
}>) {
  const map = party ? maps.find((candidate) => candidate.id === party.marker.mapId) : undefined;
  return (
    <Card
      title="Where the party is"
      icon="pin"
      aside={
        gm && party ? (
          <AudienceChip
            value={
              party.marker.revealedToPlayers
                ? { audience: "everyone", characterIds: [] }
                : { audience: "hidden", characterIds: [] }
            }
            party={[]}
          />
        ) : undefined
      }
    >
      {party && map ? (
        <>
          <button
            type="button"
            className="cx-card-map"
            aria-label={`Open ${party.mapName} at the party`}
            onClick={() => go(atlasPath(party.marker.mapId, party.marker.id))}
          >
            <MiniMap
              token={token}
              assetId={map.assetId}
              pin={{ ...party.marker, isParty: true }}
              height={height}
              span={900}
            />
          </button>
          <div className="cx-card-row">
            <span className="cx-grow">
              {party.marker.label?.trim() ? `${party.marker.label}, ${party.mapName}` : party.mapName}
            </span>
            <Button size="sm" onClick={() => go(atlasPath(party.marker.mapId, party.marker.id))}>
              Open the atlas
            </Button>
          </div>
        </>
      ) : (
        <p className="cx-hint">
          {gm
            ? "No pin marks the party yet. Set the party's position on the atlas."
            : "The party's place isn't on a map you can see yet."}
        </p>
      )}
    </Card>
  );
}

/** The counts for one kind group, from the home's collections. */
function groupCounts(home: CodexHome | undefined, group: KindGroup) {
  const rows = home?.collections.filter((row) => (group.types as readonly string[]).includes(row.type)) ?? [];
  return {
    revealed: rows.reduce((sum, row) => sum + row.revealed, 0),
    hidden: rows.reduce((sum, row) => sum + row.hidden, 0)
  };
}

function checkLine(row: CodexRevealCheckRow): string {
  if (row.reason === "placeholder") return `Its ${row.fieldKey ?? "field"} field holds a placeholder players read.`;
  if (row.reason === "hidden-pin") return "A hidden pin on a revealed map.";
  const target = row.targetTitle ?? "a record";
  return row.targetKind === "map" ? `${target} is a hidden map it names.` : `It names ${target}, which is Hidden.`;
}

const kindIcon = (kind: CodexRecordKind, type: CodexSearchType) =>
  kind === "page"
    ? entityDef(type as never).icon
    : kind === "marker"
      ? "pin"
      : kind === "map"
        ? "compass"
        : kind === "quest"
          ? "quest"
          : kind === "session"
            ? "sessions"
            : "scroll";

/** The GM's reveal check: revealed records that point at something players can't read. */
function RevealCheck({
  home,
  go,
  short = false
}: Readonly<{ home: CodexHome | undefined; go: (path: string) => void; short?: boolean }>) {
  const check = home?.revealCheck;
  return (
    <Card title="Reveal check" icon="eye" count={check?.total ?? 0} gm>
      <p className="cx-hint">
        {check && check.total > 0
          ? "These revealed records point at something players can't see. Each is safe, since players get plain text there."
          : "Nothing revealed points at something players can't see."}
      </p>
      {!short &&
        check?.rows.slice(0, 8).map((row) => (
          <button
            key={`${row.reason}:${row.kind}:${row.id}:${row.targetId ?? row.fieldKey}`}
            type="button"
            className="cx-checkrow"
            onClick={() => go(pathForHit({ kind: row.kind, id: row.id, mapId: row.mapId }))}
          >
            <CodexIcon iconId={kindIcon(row.kind, "note")} className="codex-ent-icon" />
            <span className="cx-checkrow-text">
              <b>{row.title}</b>
              <span>{checkLine(row)}</span>
            </span>
          </button>
        ))}
      {check && check.total > 8 && !short && (
        <Button size="sm" variant="ghost" onClick={() => go(searchPath({ visibility: "hidden" }))}>
          See every Hidden record
        </Button>
      )}
    </Card>
  );
}

const CHANGE_WORD: Readonly<Record<CodexHome["recent"][number]["change"], string>> = {
  created: "Created",
  edited: "Edited",
  revealed: "Revealed",
  hidden: "Hidden"
};

/**
 * The GM's Home: both dates, the collections with how many are revealed and Hidden, the next session, what changed
 * lately and who sees it, where the party is, and the reveal check.
 */
export function GmHome() {
  const { token, go, phone } = useCodexShell();
  const gm = useGmCodex();
  const { feeds, party } = gm;
  const read = useCodexQuery(
    useCallback(() => findApi.home(token), [token]),
    { failure: "Couldn't load Home." }
  );
  const home = read.data;
  const calendar = feeds.campaign.calendar;
  const next = nextSessionCard(feeds.sessions, feeds.activeSessionId);
  const pages = home?.collections.filter((row) => PAGE_TYPES.has(row.type)) ?? [];
  const pageRevealed = pages.reduce((sum, row) => sum + row.revealed, 0);
  const pageHidden = pages.reduce((sum, row) => sum + row.hidden, 0);
  const [starting, setStarting] = useState(false);
  const start = async (id: string) => {
    setStarting(true);
    try {
      await sessionApi.activate(token, id);
      await feeds.sessionFeed.reload();
    } catch (cause) {
      gm.reportError(cause instanceof Error ? cause.message : "Couldn't start that session.");
    } finally {
      setStarting(false);
    }
  };
  const hiddenSearch = (group?: KindGroup) =>
    go(searchPath({ visibility: "hidden", types: (group?.types ?? [...PAGE_TYPES]).join(",") }));
  const dateBar = (
    <DateBar
      calendar={calendar}
      role="gm"
      token={token}
      tight={phone}
      onPublished={() => void feeds.campaignFeed.reload()}
    />
  );
  const firstPage = home && pageRevealed + pageHidden === 0 && (
    <Card title="Make your first page" icon="scroll">
      <p className="cx-hint">Pages hold the people and places of your world. Players see none of it until you reveal it.</p>
      <div className="cx-card-row">
        <Button size="sm" variant="primary" onClick={() => gm.quickCreate({})}>
          New page
        </Button>
      </div>
    </Card>
  );
  const sessionLine = next && (
    <span className="cx-hint">
      {next.realDate ? `${next.realDate} · ` : ""}
      {next.heading === "Next session" ? "Planned" : next.heading}
    </span>
  );

  if (phone)
    return (
      <div className="cx-home is-phone scroll-y">
        <CodexPhoneBar title="Codex" />
        <div className="cx-home-col">
          {dateBar}
          {read.error && <Alert tone="danger">{read.error}</Alert>}
          {firstPage}
          <span className="cx-count">
            {pageRevealed + pageHidden} pages:{" "}
            <RevealedCount revealed={pageRevealed} hidden={pageHidden} onHidden={() => hiddenSearch()} />
          </span>
          <div className="cx-index-groups">
            {KIND_GROUPS.map((group) => {
              const counts = groupCounts(home, group);
              return (
                <button
                  key={group.id}
                  type="button"
                  className="cx-grouprow"
                  onClick={() => go(withQuery(pathForSection("pages"), { group: group.id }))}
                >
                  <CodexIcon iconId={group.iconId} className="cx-grouprow-icon" />
                  <span className="cx-grouprow-text">
                    <span className="cx-grouprow-title">{group.label}</span>
                    <RevealedCount revealed={counts.revealed} hidden={counts.hidden} />
                  </span>
                  <IconChevronRight className="cx-grouprow-chev" />
                </button>
              );
            })}
            {next && (
              <button type="button" className="cx-grouprow" onClick={() => go(sessionPath(next.id))}>
                <CodexIcon iconId="sessions" className="cx-grouprow-icon" />
                <span className="cx-grouprow-text">
                  <span className="cx-grouprow-title">Session {next.sessionNumber ?? ""}</span>
                  {sessionLine}
                </span>
                <IconChevronRight className="cx-grouprow-chev" />
              </button>
            )}
          </div>
          <RevealCheck home={home} go={go} short />
        </div>
      </div>
    );

  return (
    <div className="cx-home scroll-y">
      <div className="cx-home-grid">
        <div className="cx-home-col">
          {dateBar}
          <div className="cx-home-titlerow">
            <h1 className="cx-page-title">Codex</h1>
            <span className="cx-count">
              {pageRevealed + pageHidden} pages:{" "}
              <RevealedCount revealed={pageRevealed} hidden={pageHidden} onHidden={() => hiddenSearch()} />
            </span>
          </div>
          {read.error && <Alert tone="danger">{read.error}</Alert>}
          {firstPage}
          <div className="cx-home-tiles">
            {KIND_GROUPS.map((group) => {
              const counts = groupCounts(home, group);
              return (
                <Card
                  key={group.id}
                  title={group.label}
                  icon={group.iconId}
                  count={read.loading && !home ? undefined : counts.revealed + counts.hidden}
                  className="cx-tile"
                >
                  <button
                    type="button"
                    className="cx-tile-open"
                    onClick={() => go(withQuery(pathForSection("pages"), { group: group.id }))}
                  >
                    <span className="nh-sr-only">Open {group.label}</span>
                  </button>
                  <RevealedCount
                    revealed={counts.revealed}
                    hidden={counts.hidden}
                    onHidden={() => hiddenSearch(group)}
                  />
                </Card>
              );
            })}
            <Card
              title={
                next
                  ? `${next.heading === "Next session" ? "Next" : next.heading} · Session ${next.sessionNumber ?? ""}`
                  : "Sessions"
              }
              icon="sessions"
              gm
              className="cx-tile"
            >
              {next ? (
                <>
                  {sessionLine}
                  <div className="cx-card-row">
                    <Button size="sm" onClick={() => go(sessionPath(next.id))}>
                      Open prep
                    </Button>
                    {next.heading === "Next session" && (
                      <Button size="sm" disabled={starting} onClick={() => void start(next.id)}>
                        Start session {next.sessionNumber ?? ""}
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="cx-hint">No session yet. Make one from New.</p>
              )}
            </Card>
          </div>
          <Card title="Recently changed" icon="hourglass">
            {read.loading && !home ? (
              <Skeleton variant="text" />
            ) : home && home.recent.length > 0 ? (
              <table className="cx-table">
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col">Change</th>
                    <th scope="col">Who sees it</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {home.recent.map((row) => (
                    <tr key={`${row.kind}:${row.id}`} className="cx-row" onClick={() => go(pathForHit(row))}>
                      <td>
                        <button type="button" className="cx-rowlink" onClick={() => go(pathForHit(row))}>
                          {row.kind === "page" ? (
                            <EntityIcon type={row.type as never} />
                          ) : (
                            <CodexIcon iconId={kindIcon(row.kind, row.type)} className="codex-ent-icon" />
                          )}
                          {row.title.trim() || SEARCH_TYPE_LABEL[row.type]}
                        </button>
                      </td>
                      <td>{CHANGE_WORD[row.change]}</td>
                      <td>
                        <AudienceChip
                          value={{ audience: row.audience, characterIds: row.characterIds }}
                          party={party}
                        />
                      </td>
                      <td className="cx-col-date">{modifiedLabel(row.changedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="cx-hint">Nothing has changed yet.</p>
            )}
          </Card>
        </div>
        <div className="cx-home-col">
          <PartyCard token={token} party={feeds.campaign.party} maps={feeds.campaign.maps} height={230} gm go={go} />
          <RevealCheck home={home} go={go} />
        </div>
      </div>
    </div>
  );
}

const VISIT_KEY = "codex-last-visit";

/** When this device last opened Home, read once on arrival and moved to now, so "since your last visit" is real. */
function useLastVisit(embedded: boolean): string | null {
  const [since] = useState(() => {
    try {
      return localStorage.getItem(VISIT_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (embedded) return;
    try {
      localStorage.setItem(VISIT_KEY, new Date().toISOString());
    } catch {
      /* private mode: everything reads as new */
    }
  }, [embedded]);
  return since;
}

const NEW_WORD = { new: "New", updated: "Changed" } as const;

/**
 * A player's Home over their own reads: today's date, the latest recap, what is new since their last visit, where
 * the party is, the open quests and the clocks they know.
 */
export function PlayerHome() {
  const { token, go, phone, embedded } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const since = useLastVisit(embedded);
  const read = useCodexQuery(
    useCallback(() => findApi.homeForPlayer(token, since), [token, since]),
    {
      failure: "Couldn't load what is new."
    }
  );
  const recap = pickNextSession(feeds.sessions);
  const clocks = useMemo(() => clocksOf(feeds.timeline), [feeds.timeline]);
  const newSince = read.data?.newSince ?? [];
  const recapCard = recap && (
    <Card
      title="Latest recap"
      icon="sessions"
      aside={<span className="cx-hint">Session {recap.sessionNumber ?? ""}</span>}
    >
      <div className="cx-card-text">
        <CodexMarkdown text={recap.recap} token={token} audience="player" />
      </div>
      <Button size="sm" variant="ghost" onClick={() => go(sessionPath(recap.id))}>
        Open the session
      </Button>
    </Card>
  );
  const dateBar = <DateBar calendar={feeds.calendar} role="player" token={token} tight={phone} />;

  if (phone)
    return (
      <div className="cx-home is-phone scroll-y">
        <CodexPhoneBar title="Codex" />
        <div className="cx-home-col">
          {dateBar}
          <div className="cx-index-groups">
            {KIND_GROUPS.map((group) => {
              const count = feeds.pages.filter((page) => group.types.includes(page.entityType)).length;
              const fresh = newSince.filter(
                (row) => row.kind === "page" && (group.types as readonly string[]).includes(row.type)
              ).length;
              return (
                <button
                  key={group.id}
                  type="button"
                  className="cx-grouprow"
                  onClick={() => go(withQuery(pathForSection("pages"), { group: group.id }))}
                >
                  <CodexIcon iconId={group.iconId} className="cx-grouprow-icon" />
                  <span className="cx-grouprow-title cx-grow">{group.label}</span>
                  {fresh > 0 && (
                    <span className="cx-newchip">
                      <IconSparkle /> {fresh} new
                    </span>
                  )}
                  <span className="cx-grouprow-count">{count}</span>
                  <IconChevronRight className="cx-grouprow-chev" />
                </button>
              );
            })}
          </div>
          {recapCard}
        </div>
      </div>
    );

  const openQuests = feeds.quests.filter((quest) => quest.status === "active" || quest.status === "not-started");
  return (
    <div className="cx-home scroll-y">
      <div className="cx-home-grid is-player">
        <div className="cx-home-col">
          {dateBar}
          {recapCard}
          <Card title="New since your last visit" icon="star">
            {read.error ? (
              <Alert tone="danger">{read.error}</Alert>
            ) : newSince.length === 0 ? (
              <p className="cx-hint">Nothing new since your last visit.</p>
            ) : (
              <table className="cx-table">
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col">What</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {newSince.map((row) => (
                    <tr key={`${row.kind}:${row.id}`} className="cx-row" onClick={() => go(pathForHit(row))}>
                      <td>
                        <button type="button" className="cx-rowlink" onClick={() => go(pathForHit(row))}>
                          {row.kind === "page" ? (
                            <EntityIcon type={row.type as never} />
                          ) : (
                            <CodexIcon iconId={kindIcon(row.kind, row.type)} className="codex-ent-icon" />
                          )}
                          {row.title.trim() || SEARCH_TYPE_LABEL[row.type]}
                        </button>
                      </td>
                      <td>{NEW_WORD[row.change]}</td>
                      <td className="cx-col-date">{modifiedLabel(row.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div className="cx-home-col">
          <PartyCard token={token} party={feeds.party} maps={feeds.maps} height={200} gm={false} go={go} />
          <Card title="Open quests" icon="quest">
            {openQuests.length === 0 ? (
              <p className="cx-hint">No open quests.</p>
            ) : (
              openQuests.map((quest) => {
                const done = quest.objectives.filter((objective) => objective.done).length;
                return (
                  <button key={quest.id} type="button" className="cx-checkrow" onClick={() => go(questPath(quest.id))}>
                    <CodexIcon iconId="quest" className="codex-ent-icon" />
                    <span className="cx-checkrow-text">
                      <b>{quest.title}</b>
                      <span className="cx-progress" aria-label={`${done} of ${quest.objectives.length} done`}>
                        {quest.objectives.map((objective, index) => (
                          <i key={index} className={objective.done ? "is-on" : undefined} />
                        ))}
                        <span>
                          {quest.status === "not-started"
                            ? "Not started"
                            : `${done} of ${quest.objectives.length} done`}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </Card>
          <Card title="Clocks" icon="hourglass">
            {clocks.length === 0 ? (
              <p className="cx-hint">No clock is running.</p>
            ) : (
              clocks.map((clock) => (
                <button
                  key={clock.id}
                  type="button"
                  className="cx-checkrow"
                  onClick={() => go(journalEntryPath(clock.id))}
                >
                  <CodexIcon iconId="hourglass" className="codex-ent-icon" />
                  <span className="cx-checkrow-text">
                    <b>{clock.summary}</b>
                    <span>
                      {deadlineStateLabel(clock.fired)} · {clock.when}
                    </span>
                  </span>
                </button>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
